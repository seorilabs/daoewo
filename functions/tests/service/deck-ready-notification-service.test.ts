import { describe, expect, it, vi } from "vitest";
import { BackendError } from "../../src/errors.js";
import type {
  AccountAccessRepository,
  NotificationRepository,
} from "../../src/repositories/contracts.js";
import {
  DeckReadyNotificationRetryError,
  DeckReadyNotificationService,
  NOTIFICATION_OUTBOX_LEASE_MINUTES,
  deckReadyNotificationEventId,
  deckRequestNotificationState,
} from "../../src/notifications/deck-ready-outbox.js";
import type { DeckReadyNotificationSender } from "../../src/notifications/firebase-messaging-sender.js";
import type { DeckReadyNotificationOutbox } from "../../src/notifications/types.js";
import { sha256 } from "../../src/utils/hash.js";

const NOW = new Date("2026-07-12T00:00:00.000Z");
const EVENT_ID = deckReadyNotificationEventId("request-a", 2);
const LEASE_ID = "notification-outbox-lease-a";

describe("DeckReadyNotificationService", () => {
  it("creates one deterministic outbox without UID, token, topic, or note", async () => {
    let captured: DeckReadyNotificationOutbox | null = null;
    const repository = fakeRepository({
      createDeckReadyNotificationOutbox: vi.fn(async (outbox) => {
        captured = outbox;
        return true;
      }),
    });
    const service = createService(repository);
    const before = deckRequestNotificationState({
      status: "queued",
      uid: "private-user",
      topic: "private topic",
      note: "private note",
    });
    const after = deckRequestNotificationState({
      status: "ready",
      readyDeckId: "deck-a",
      readyRevision: 2,
      readyAt: "2026-07-12T00:00:00.000Z",
      uid: "private-user",
      fcmToken: "raw-token",
      topic: "private topic",
      note: "private note",
    });

    await expect(
      service.enqueue({ requestId: "request-a", before, after })
    ).resolves.toEqual({ created: true, eventId: EVENT_ID });
    expect(JSON.stringify(captured)).not.toMatch(
      /private-user|raw-token|private topic|private note/
    );

    await expect(
      service.enqueue({ requestId: "request-a", before: after, after })
    ).resolves.toEqual({ created: false, eventId: null });
  });

  it("resolves the current owner at send time and completes with safe counts", async () => {
    const outbox = pendingOutbox(1);
    const completeNotificationOutbox = vi.fn(async () => undefined);
    const repository = fakeRepository({
      recordNotificationOutboxAttempt: vi.fn(async () => outbox),
      resolveDeckReadyNotificationTarget: vi.fn(async () => ({
        uid: "private-user",
        readyDeckId: "deck-a",
      })),
      listDeckReadyNotificationInstallations: vi.fn(async () => [
        {
          installationHash: "installation-a",
          fcmToken: "raw-fcm-token",
          platform: "android" as const,
          locale: "ko-KR",
        },
      ]),
      completeNotificationOutbox,
    });
    const sender: DeckReadyNotificationSender = {
      sendDeckReady: vi.fn(async () => ({
        deliveredCount: 1,
        invalidInstallationHashes: [],
        transientFailureCount: 0,
        permanentFailureCount: 0,
      })),
    };
    const service = createService(repository, undefined, sender);

    await expect(service.process(EVENT_ID)).resolves.toEqual({
      outcome: "delivered",
    });
    expect(repository.recordNotificationOutboxAttempt).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      leaseId: LEASE_ID,
      now: NOW,
      leaseUntil: new Date(
        NOW.getTime() + NOTIFICATION_OUTBOX_LEASE_MINUTES * 60 * 1_000
      ),
    });
    expect(completeNotificationOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: EVENT_ID,
        leaseId: LEASE_ID,
        status: "delivered",
        reason: "delivered",
        deliveredCount: 1,
      })
    );
    expect(JSON.stringify(completeNotificationOutbox.mock.calls)).not.toMatch(
      /private-user|raw-fcm-token/
    );
  });

  it("skips a deleting account before reading installations or sending", async () => {
    const listDeckReadyNotificationInstallations = vi.fn(async () => []);
    const sender: DeckReadyNotificationSender = {
      sendDeckReady: vi.fn(async () => {
        throw new Error("must not send");
      }),
    };
    const repository = fakeRepository({
      recordNotificationOutboxAttempt: vi.fn(async () => pendingOutbox(1)),
      resolveDeckReadyNotificationTarget: vi.fn(async () => ({
        uid: "deleting-user",
        readyDeckId: "deck-a",
      })),
      listDeckReadyNotificationInstallations,
    });
    const accounts: AccountAccessRepository = {
      async assertAccountActive() {
        throw new BackendError("failed-precondition", "deleting", {
          kind: "account-deleting",
        });
      },
      async mergeAnonymousAccount() {
        throw new Error("unused");
      },
    };
    const service = createService(repository, accounts, sender);

    await expect(service.process(EVENT_ID)).resolves.toEqual({
      outcome: "skipped",
    });
    expect(listDeckReadyNotificationInstallations).not.toHaveBeenCalled();
    expect(sender.sendDeckReady).not.toHaveBeenCalled();
  });

  it("deletes invalid installations and retries only with a sanitized error", async () => {
    const deleteNotificationInstallations = vi.fn(async () => undefined);
    const recordNotificationOutboxRetry = vi.fn(async () => undefined);
    const repository = fakeRepository({
      recordNotificationOutboxAttempt: vi.fn(async () => pendingOutbox(1)),
      resolveDeckReadyNotificationTarget: vi.fn(async () => ({
        uid: "private-user",
        readyDeckId: "deck-a",
      })),
      listDeckReadyNotificationInstallations: vi.fn(async () => [
        {
          installationHash: "invalid-installation",
          fcmToken: "raw-fcm-token",
          platform: "ios" as const,
          locale: "ko-KR",
        },
      ]),
      deleteNotificationInstallations,
      recordNotificationOutboxRetry,
    });
    const sender: DeckReadyNotificationSender = {
      sendDeckReady: vi.fn(async () => ({
        deliveredCount: 0,
        invalidInstallationHashes: ["invalid-installation"],
        transientFailureCount: 1,
        permanentFailureCount: 0,
      })),
    };
    const service = createService(repository, undefined, sender);

    const failure = await service
      .process(EVENT_ID)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DeckReadyNotificationRetryError);
    expect(String(failure)).not.toMatch(/private-user|raw-fcm-token/);
    expect(deleteNotificationInstallations).toHaveBeenCalledWith(
      "private-user",
      [
        {
          installationHash: "invalid-installation",
          fcmTokenHash: sha256("raw-fcm-token"),
        },
      ]
    );
    expect(recordNotificationOutboxRetry).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      leaseId: LEASE_ID,
      now: NOW,
    });
  });

  it("retries a concurrent invocation so a crashed lease owner cannot lose the event", async () => {
    let activeLease: string | null = null;
    let attemptCount = 0;
    const sendStarted = deferred<void>();
    const releaseSend = deferred<void>();
    const recordNotificationOutboxAttempt = vi.fn(async (input) => {
      if (activeLease !== null) {
        throw new BackendError("aborted", "active lease", {
          kind: "notification-outbox-lease-active",
        });
      }
      activeLease = input.leaseId;
      attemptCount += 1;
      return pendingOutbox(attemptCount);
    });
    const completeNotificationOutbox = vi.fn(async (input) => {
      if (activeLease === input.leaseId) activeLease = null;
    });
    const repository = fakeRepository({
      recordNotificationOutboxAttempt,
      resolveDeckReadyNotificationTarget: vi.fn(async () => ({
        uid: "private-user",
        readyDeckId: "deck-a",
      })),
      listDeckReadyNotificationInstallations: vi.fn(async () => [
        {
          installationHash: "installation-a",
          fcmToken: "raw-fcm-token",
          platform: "android" as const,
          locale: "ko-KR",
        },
      ]),
      completeNotificationOutbox,
    });
    const sender: DeckReadyNotificationSender = {
      sendDeckReady: vi.fn(async () => {
        sendStarted.resolve();
        await releaseSend.promise;
        return {
          deliveredCount: 1,
          invalidInstallationHashes: [],
          transientFailureCount: 0,
          permanentFailureCount: 0,
        };
      }),
    };
    let leaseSequence = 0;
    const service = new DeckReadyNotificationService(
      repository,
      {
        async assertAccountActive() {},
        async mergeAnonymousAccount() {
          throw new Error("unused");
        },
      },
      sender,
      { now: () => NOW },
      () => `notification-outbox-lease-${++leaseSequence}`
    );

    const first = service.process(EVENT_ID);
    await sendStarted.promise;
    await expect(service.process(EVENT_ID)).rejects.toMatchObject({
      safeCode: "delivery-contention",
    });
    expect(sender.sendDeckReady).toHaveBeenCalledTimes(1);
    releaseSend.resolve();
    await expect(first).resolves.toEqual({ outcome: "delivered" });
    expect(attemptCount).toBe(1);
    expect(activeLease).toBeNull();
  });
});

function createService(
  repository: NotificationRepository,
  accounts: AccountAccessRepository = {
    async assertAccountActive() {},
    async mergeAnonymousAccount() {
      throw new Error("unused");
    },
  },
  sender: DeckReadyNotificationSender = {
    async sendDeckReady() {
      return {
        deliveredCount: 0,
        invalidInstallationHashes: [],
        transientFailureCount: 0,
        permanentFailureCount: 0,
      };
    },
  }
) {
  return new DeckReadyNotificationService(
    repository,
    accounts,
    sender,
    {
      now: () => NOW,
    },
    () => LEASE_ID
  );
}

function deferred<T>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function pendingOutbox(attemptCount: number): DeckReadyNotificationOutbox {
  return {
    id: EVENT_ID,
    schemaVersion: 1,
    kind: "deck-ready",
    requestId: "request-a",
    requestRevision: 2,
    status: "pending",
    attemptCount,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
}

function fakeRepository(
  overrides: Partial<NotificationRepository> = {}
): NotificationRepository {
  return {
    upsertNotificationInstallation: vi.fn(async () => undefined),
    unregisterNotificationInstallation: vi.fn(async () => undefined),
    listDeckReadyNotificationInstallations: vi.fn(async () => []),
    listCatalogNotificationInstallations: vi.fn(async () => []),
    deleteNotificationInstallations: vi.fn(async () => undefined),
    deleteCatalogNotificationInstallations: vi.fn(async () => undefined),
    createDeckReadyNotificationOutbox: vi.fn(async () => true),
    recordNotificationOutboxAttempt: vi.fn(async () => null),
    recordNotificationOutboxRetry: vi.fn(async () => undefined),
    completeNotificationOutbox: vi.fn(async () => undefined),
    resolveDeckReadyNotificationTarget: vi.fn(async () => null),
    ...overrides,
  };
}
