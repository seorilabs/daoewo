import type {
  ReceiptClaimResolution,
  VerifiedStoreNotificationEnvelope,
} from "./types.js";

export interface ReconciliationWindow {
  readonly key: string;
  readonly startTime: Date;
  readonly endTime: Date;
  readonly pageToken: string | null;
}

export interface ReconciliationCursorRepository {
  acquireWindow(input: {
    key: string;
    now: Date;
    lookbackMs: number;
    overlapMs: number;
    staleWindowGraceMs: number;
  }): Promise<ReconciliationWindow>;
  advanceWindow(input: {
    window: ReconciliationWindow;
    nextPageToken: string | null;
    now: Date;
  }): Promise<void>;
  restartWindow(input: {
    window: ReconciliationWindow;
    now: Date;
  }): Promise<void>;
}

/** Vendor pagination token이 만료되거나 무효화됐음을 raw 응답 없이 전달한다. */
export class ReconciliationPageTokenError extends Error {
  constructor() {
    super("Store reconciliation pagination token is no longer valid.");
    this.name = "ReconciliationPageTokenError";
  }
}

export interface StoreReconciliationSource {
  readonly key: string;
  readonly lookbackMs: number;
  readonly overlapMs: number;
  /** 요청 lookback과 vendor 최대 lookback 사이의 복구 여유다. */
  readonly staleWindowGraceMs: number;
  listPage(input: {
    startTime: Date;
    endTime: Date;
    pageToken: string | null;
  }): Promise<{
    envelopes: readonly VerifiedStoreNotificationEnvelope[];
    nextPageToken: string | null;
  }>;
}

export interface StoreNotificationClaimReader {
  resolveReceiptClaim(fingerprint: string): Promise<ReceiptClaimResolution>;
}

export interface StoreNotificationProcessor {
  process(
    notification: Extract<
      VerifiedStoreNotificationEnvelope,
      { kind: "subscription" }
    >["notification"],
  ): Promise<unknown>;
}

/**
 * history/voided pull은 이미 권한을 부여한 claim만 복구 대상으로 삼는다. claim이
 * 없으면 이후 direct verification이 store 현재 상태를 다시 조회하므로, 과거 raw
 * token/JWS를 queue나 cursor에 저장하지 않는다.
 */
export class StoreReconciliationService {
  constructor(
    private readonly cursors: ReconciliationCursorRepository,
    private readonly claims: StoreNotificationClaimReader,
    private readonly notifications: StoreNotificationProcessor,
    private readonly clock: { now(): Date },
    private readonly maxPagesPerRun = 20,
  ) {}

  async run(source: StoreReconciliationSource): Promise<{
    pages: number;
    scanned: number;
    processed: number;
    skippedWithoutClaim: number;
    complete: boolean;
  }> {
    let window = await this.cursors.acquireWindow({
      key: source.key,
      now: this.clock.now(),
      lookbackMs: source.lookbackMs,
      overlapMs: source.overlapMs,
      staleWindowGraceMs: source.staleWindowGraceMs,
    });
    let pages = 0;
    let scanned = 0;
    let processed = 0;
    let skippedWithoutClaim = 0;

    while (pages < this.maxPagesPerRun) {
      let page: Awaited<ReturnType<StoreReconciliationSource["listPage"]>>;
      try {
        page = await source.listPage({
          startTime: window.startTime,
          endTime: window.endTime,
          pageToken: window.pageToken,
        });
      } catch (error) {
        if (
          error instanceof ReconciliationPageTokenError &&
          window.pageToken !== null
        ) {
          // 같은 고정 window의 첫 페이지부터 idempotent하게 다시 읽는다. reset
          // commit 뒤 오류를 다시 던져 scheduler retry가 즉시 새 token chain을 연다.
          await this.cursors.restartWindow({
            window,
            now: this.clock.now(),
          });
        }
        throw error;
      }
      for (const envelope of page.envelopes) {
        scanned += 1;
        if (envelope.kind !== "subscription") continue;
        const claim = await this.claims.resolveReceiptClaim(
          envelope.notification.receiptFingerprint,
        );
        if (claim.kind !== "claimed") {
          skippedWithoutClaim += 1;
          continue;
        }
        await this.notifications.process(envelope.notification);
        processed += 1;
      }
      await this.cursors.advanceWindow({
        window,
        nextPageToken: page.nextPageToken,
        now: this.clock.now(),
      });
      pages += 1;
      if (page.nextPageToken === null) {
        return {
          pages,
          scanned,
          processed,
          skippedWithoutClaim,
          complete: true,
        };
      }
      window = { ...window, pageToken: page.nextPageToken };
    }

    return {
      pages,
      scanned,
      processed,
      skippedWithoutClaim,
      complete: false,
    };
  }
}
