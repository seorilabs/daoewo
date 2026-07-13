import { randomUUID } from "node:crypto";
import type { Clock } from "../domain/types.js";
import { BackendError, assertBackend } from "../errors.js";
import type {
  AccountAccessRepository,
  NotificationRepository,
} from "../repositories/contracts.js";
import { sha256 } from "../utils/hash.js";
import { addHours } from "../utils/time.js";
import type { DeckReadyNotificationSender } from "./firebase-messaging-sender.js";
import { NotificationMessagingRetryError } from "./firebase-messaging-sender.js";
import type {
  DeckReadyCompletionReason,
  DeckReadyNotificationOutbox,
  NotificationOutboxStatus,
  NotificationSendResult,
} from "./types.js";
import { notificationInstallationInvalidations } from "./policy.js";

export const NOTIFICATION_OUTBOX_TTL_HOURS = 30 * 24;
export const NOTIFICATION_OUTBOX_LEASE_MINUTES = 5;
export const MAX_NOTIFICATION_DELIVERY_ATTEMPTS = 8;

export interface DeckRequestNotificationState {
  readonly status: unknown;
  readonly readyDeckId?: unknown;
  readonly readyRevision?: unknown;
  readonly readyAt?: unknown;
}

export class DeckReadyNotificationRetryError extends Error {
  constructor(
    readonly safeCode:
      | "messaging-transient"
      | "delivery-contention" = "messaging-transient",
  ) {
    super("Deck-ready notification delivery should be retried.");
    this.name = "DeckReadyNotificationRetryError";
  }
}

export class DeckReadyNotificationService {
  constructor(
    private readonly repository: NotificationRepository,
    private readonly accounts: AccountAccessRepository,
    private readonly sender: DeckReadyNotificationSender,
    private readonly clock: Clock,
    private readonly createLeaseId: () => string = randomUUID
  ) {}

  async enqueue(input: {
    readonly requestId: string;
    readonly before: DeckRequestNotificationState;
    readonly after: DeckRequestNotificationState;
  }): Promise<{ readonly created: boolean; readonly eventId: string | null }> {
    if (input.before.status !== "queued" || input.after.status !== "ready") {
      return { created: false, eventId: null };
    }
    const readyDeckId = requiredSafeId(input.after.readyDeckId, "readyDeckId");
    const readyRevision = requiredPositiveInteger(
      input.after.readyRevision,
      "readyRevision"
    );
    assertValidTimestamp(input.after.readyAt, "readyAt");
    const eventId = deckReadyNotificationEventId(
      input.requestId,
      readyRevision
    );
    const now = this.clock.now().toISOString();
    const outbox: DeckReadyNotificationOutbox = {
      id: eventId,
      schemaVersion: 1,
      kind: "deck-ready",
      requestId: input.requestId,
      requestRevision: readyRevision,
      status: "pending",
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    // readyDeckId는 권위 request 문서에서 처리 시 다시 읽는다. outbox에는 수신자/자유 입력을 넣지 않는다.
    void readyDeckId;
    return {
      created: await this.repository.createDeckReadyNotificationOutbox(outbox),
      eventId,
    };
  }

  async process(eventId: string): Promise<{
    readonly outcome: "ignored" | NotificationOutboxStatus;
  }> {
    const now = this.clock.now();
    const leaseId = this.createLeaseId();
    let outbox: DeckReadyNotificationOutbox | null;
    try {
      outbox = await this.repository.recordNotificationOutboxAttempt({
        eventId,
        leaseId,
        now,
        leaseUntil: new Date(
          now.getTime() + NOTIFICATION_OUTBOX_LEASE_MINUTES * 60 * 1_000
        ),
      });
    } catch (error) {
      if (
        error instanceof BackendError &&
        error.details?.kind === "notification-outbox-lease-active"
      ) {
        // 기존 worker가 실패해도 Eventarc가 lease 만료 뒤 다시 전달하도록 ACK하지 않는다.
        throw new DeckReadyNotificationRetryError("delivery-contention");
      }
      throw error;
    }
    if (outbox === null || outbox.status !== "pending") {
      return { outcome: "ignored" };
    }
    if (outbox.attemptCount > MAX_NOTIFICATION_DELIVERY_ATTEMPTS) {
      await this.complete(
        outbox,
        leaseId,
        "dead-letter",
        "retry-limit",
        emptyResult(),
        now
      );
      return { outcome: "dead-letter" };
    }

    const target = await this.repository.resolveDeckReadyNotificationTarget(
      outbox.requestId,
      outbox.requestRevision
    );
    if (target === null) {
      await this.complete(
        outbox,
        leaseId,
        "skipped",
        "invalid-request-state",
        emptyResult(),
        now
      );
      return { outcome: "skipped" };
    }

    try {
      await this.accounts.assertAccountActive(target.uid);
    } catch (error) {
      if (isUnavailableAccount(error)) {
        await this.complete(
          outbox,
          leaseId,
          "skipped",
          "account-unavailable",
          emptyResult(),
          now
        );
        return { outcome: "skipped" };
      }
      if (await this.retryOrDeadLetter(outbox, leaseId, now)) {
        throw new DeckReadyNotificationRetryError();
      }
      return { outcome: "dead-letter" };
    }

    const installations =
      await this.repository.listDeckReadyNotificationInstallations(
        target.uid,
        now
      );
    if (installations.length === 0) {
      await this.complete(
        outbox,
        leaseId,
        "skipped",
        "no-installations",
        emptyResult(),
        now
      );
      return { outcome: "skipped" };
    }

    let result: NotificationSendResult;
    try {
      result = await this.sender.sendDeckReady(
        {
          eventId: outbox.id,
        },
        installations
      );
    } catch (error) {
      if (!(error instanceof NotificationMessagingRetryError)) {
        // Provider/SDK 원본 오류를 trigger에 전달하지 않는다.
      }
      if (await this.retryOrDeadLetter(outbox, leaseId, now)) {
        throw new DeckReadyNotificationRetryError();
      }
      return { outcome: "dead-letter" };
    }

    await this.repository.deleteNotificationInstallations(
      target.uid,
      notificationInstallationInvalidations(
        installations,
        result.invalidInstallationHashes
      )
    );
    if (result.transientFailureCount > 0) {
      if (await this.retryOrDeadLetter(outbox, leaseId, now)) {
        throw new DeckReadyNotificationRetryError();
      }
      return { outcome: "dead-letter" };
    }
    if (result.deliveredCount > 0) {
      await this.complete(
        outbox,
        leaseId,
        "delivered",
        "delivered",
        result,
        now
      );
      return { outcome: "delivered" };
    }
    const reason: DeckReadyCompletionReason =
      result.invalidInstallationHashes.length > 0
        ? "invalid-installations"
        : "permanent-messaging-failure";
    const status: Exclude<NotificationOutboxStatus, "pending"> =
      reason === "invalid-installations" ? "skipped" : "dead-letter";
    await this.complete(outbox, leaseId, status, reason, result, now);
    return { outcome: status };
  }

  private async retryOrDeadLetter(
    outbox: DeckReadyNotificationOutbox,
    leaseId: string,
    now: Date
  ): Promise<boolean> {
    if (outbox.attemptCount >= MAX_NOTIFICATION_DELIVERY_ATTEMPTS) {
      await this.complete(
        outbox,
        leaseId,
        "dead-letter",
        "retry-limit",
        emptyResult(),
        now
      );
      return false;
    }
    await this.repository.recordNotificationOutboxRetry({
      eventId: outbox.id,
      leaseId,
      now,
    });
    return true;
  }

  private complete(
    outbox: DeckReadyNotificationOutbox,
    leaseId: string,
    status: Exclude<NotificationOutboxStatus, "pending">,
    reason: DeckReadyCompletionReason,
    result: NotificationSendResult,
    now: Date
  ): Promise<void> {
    return this.repository.completeNotificationOutbox({
      eventId: outbox.id,
      leaseId,
      status,
      reason,
      deliveredCount: result.deliveredCount,
      invalidatedCount: result.invalidInstallationHashes.length,
      permanentFailureCount: result.permanentFailureCount,
      now,
      expiresAt: addHours(now, NOTIFICATION_OUTBOX_TTL_HOURS),
    });
  }
}

export function deckReadyNotificationEventId(
  requestId: string,
  readyRevision: number
): string {
  return sha256(`deck-ready:${requestId}:${readyRevision}`);
}

export function deckRequestNotificationState(
  value: Readonly<Record<string, unknown>> | undefined
): DeckRequestNotificationState {
  return value === undefined
    ? { status: undefined }
    : {
        status: value.status,
        readyDeckId: value.readyDeckId,
        readyRevision: value.readyRevision,
        readyAt: value.readyAt,
      };
}

function requiredSafeId(value: unknown, name: string): string {
  assertBackend(
    typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value),
    "failed-precondition",
    `${name} is invalid.`,
    { kind: "deck-ready-state-invalid" }
  );
  return value;
}

function requiredPositiveInteger(value: unknown, name: string): number {
  assertBackend(
    typeof value === "number" && Number.isSafeInteger(value) && value > 0,
    "failed-precondition",
    `${name} is invalid.`,
    { kind: "deck-ready-state-invalid" }
  );
  return value;
}

function assertValidTimestamp(value: unknown, name: string): void {
  const milliseconds =
    value instanceof Date
      ? value.getTime()
      : typeof value === "string"
      ? Date.parse(value)
      : isTimestampLike(value)
      ? value.toMillis()
      : Number.NaN;
  assertBackend(
    Number.isFinite(milliseconds),
    "failed-precondition",
    `${name} is invalid.`,
    { kind: "deck-ready-state-invalid" }
  );
}

function isTimestampLike(value: unknown): value is { toMillis(): number } {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { toMillis?: unknown }).toMillis === "function"
  );
}

function isUnavailableAccount(error: unknown): boolean {
  return (
    error instanceof BackendError &&
    error.code === "failed-precondition" &&
    (error.details?.kind === "account-deleting" ||
      error.details?.kind === "account-merged")
  );
}

function emptyResult(): NotificationSendResult {
  return {
    deliveredCount: 0,
    invalidInstallationHashes: [],
    transientFailureCount: 0,
    permanentFailureCount: 0,
  };
}
