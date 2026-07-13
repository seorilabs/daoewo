import { describe, expect, it, vi } from "vitest";
import {
  ReconciliationPageTokenError,
  StoreReconciliationService,
  type ReconciliationCursorRepository,
  type ReconciliationWindow,
  type StoreReconciliationSource,
} from "../../src/store-notifications/reconciliation.js";
import type {
  VerifiedStoreNotificationEnvelope,
} from "../../src/store-notifications/types.js";

const NOW = new Date("2026-07-12T03:00:00.000Z");

describe("StoreReconciliationService", () => {
  it("pages deterministically, processes existing claims, and skips unowned history", async () => {
    const cursor = new FakeCursor();
    const process = vi.fn(async () => undefined);
    const source = pageSource([
      [subscription("claimed", "event-1"), subscription("missing", "event-2")],
      [{ kind: "test", platform: "app-store", eventId: "test-1" }],
    ]);
    const service = new StoreReconciliationService(
      cursor,
      {
        async resolveReceiptClaim(fingerprint) {
          return fingerprint === "claimed"
            ? {
                kind: "claimed" as const,
                fingerprint,
                uid: "user-a",
                platform: "app-store" as const,
                productId: "daoewo.pro.monthly",
                originalTransactionId: "original-a",
              }
            : { kind: "missing" as const, fingerprint };
        },
      },
      { process },
      { now: () => new Date(NOW) },
    );

    await expect(service.run(source)).resolves.toEqual({
      pages: 2,
      scanned: 3,
      processed: 1,
      skippedWithoutClaim: 1,
      complete: true,
    });
    expect(process).toHaveBeenCalledTimes(1);
    expect(cursor.advances.map((item) => item.nextPageToken)).toEqual([
      "page-2",
      null,
    ]);
  });

  it("does not advance a page when authoritative processing fails", async () => {
    const cursor = new FakeCursor();
    const service = new StoreReconciliationService(
      cursor,
      {
        async resolveReceiptClaim(fingerprint) {
          return {
            kind: "claimed" as const,
            fingerprint,
            uid: "user-a",
            platform: "app-store" as const,
            productId: "daoewo.pro.monthly",
            originalTransactionId: "original-a",
          };
        },
      },
      { async process() { throw new Error("store unavailable"); } },
      { now: () => new Date(NOW) },
    );

    await expect(
      service.run(pageSource([[subscription("claimed", "event-1")]])),
    ).rejects.toThrow("store unavailable");
    expect(cursor.advances).toHaveLength(0);
  });

  it("persists the next token and yields after the per-run page cap", async () => {
    const cursor = new FakeCursor();
    const service = new StoreReconciliationService(
      cursor,
      { async resolveReceiptClaim(fingerprint) { return { kind: "missing", fingerprint }; } },
      { async process() {} },
      { now: () => new Date(NOW) },
      1,
    );

    await expect(
      service.run(pageSource([[subscription("missing", "event-1")], []])),
    ).resolves.toMatchObject({ pages: 1, complete: false });
    expect(cursor.advances[0]?.nextPageToken).toBe("page-2");
  });

  it("atomically resets an expired vendor page token before retrying", async () => {
    const cursor = new FakeCursor("expired-page-token");
    const service = new StoreReconciliationService(
      cursor,
      { async resolveReceiptClaim(fingerprint) { return { kind: "missing", fingerprint }; } },
      { async process() {} },
      { now: () => new Date(NOW) },
    );
    const source: StoreReconciliationSource = {
      key: "app-store-production-history",
      lookbackMs: 24 * 60 * 60 * 1_000,
      overlapMs: 60 * 60 * 1_000,
      staleWindowGraceMs: 60 * 60 * 1_000,
      async listPage() {
        throw new ReconciliationPageTokenError();
      },
    };

    await expect(service.run(source)).rejects.toBeInstanceOf(
      ReconciliationPageTokenError,
    );
    expect(cursor.restarts).toHaveLength(1);
    expect(cursor.restarts[0]?.window.pageToken).toBe("expired-page-token");
    expect(cursor.advances).toHaveLength(0);
  });
});

class FakeCursor implements ReconciliationCursorRepository {
  readonly advances: Array<{
    window: ReconciliationWindow;
    nextPageToken: string | null;
    now: Date;
  }> = [];
  readonly restarts: Array<{ window: ReconciliationWindow; now: Date }> = [];

  constructor(private readonly initialPageToken: string | null = null) {}

  async acquireWindow(input: { key: string }): Promise<ReconciliationWindow> {
    return {
      key: input.key,
      startTime: new Date("2026-07-11T03:00:00.000Z"),
      endTime: new Date(NOW),
      pageToken: this.initialPageToken,
    };
  }

  async advanceWindow(input: {
    window: ReconciliationWindow;
    nextPageToken: string | null;
    now: Date;
  }): Promise<void> {
    this.advances.push(input);
  }

  async restartWindow(input: {
    window: ReconciliationWindow;
    now: Date;
  }): Promise<void> {
    this.restarts.push(input);
  }
}

function pageSource(
  pages: readonly (readonly VerifiedStoreNotificationEnvelope[])[],
): StoreReconciliationSource {
  return {
    key: "app-store-production-history",
    lookbackMs: 24 * 60 * 60 * 1_000,
    overlapMs: 60 * 60 * 1_000,
    staleWindowGraceMs: 60 * 60 * 1_000,
    async listPage({ pageToken }) {
      const index = pageToken === null ? 0 : Number(pageToken.slice("page-".length)) - 1;
      return {
        envelopes: pages[index] ?? [],
        nextPageToken: index + 1 < pages.length ? `page-${index + 2}` : null,
      };
    },
  };
}

function subscription(
  fingerprint: string,
  eventId: string,
): VerifiedStoreNotificationEnvelope {
  return {
    kind: "subscription",
    notification: {
      platform: "app-store",
      eventType: "subscription.status_changed",
      notificationType: "DID_RENEW",
      environment: "production",
      transactionId: "transaction-a",
      productId: "daoewo.pro.monthly",
      originalTransactionId: "original-a",
      receiptFingerprint: fingerprint,
      cursor: { eventId, occurredAt: NOW.toISOString() },
    },
  };
}
