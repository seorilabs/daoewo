import { describe, expect, it, vi } from "vitest";
import { BackendError } from "../../src/errors.js";
import type {
  CatalogNotificationEventRepository,
  NotificationRepository,
} from "../../src/repositories/contracts.js";
import {
  CatalogPublishedNotificationRetryError,
  CatalogPublishedNotificationService,
  catalogPublishedNotificationEventId,
  catalogPublicationState,
  isCatalogPublicationInputError,
} from "../../src/notifications/catalog-published.js";
import { NotificationMessagingRetryError } from "../../src/notifications/firebase-messaging-sender.js";
import { sha256 } from "../../src/utils/hash.js";

const NOW = new Date("2026-07-13T00:00:00.000Z");
const LEASE_ID = "catalog-notification-lease-a";
const TARGET = {
  installationHash: "installation-a",
  fcmToken: "token-that-is-long-enough",
  platform: "android" as const,
  locale: "ko-KR",
};

describe("CatalogPublishedNotificationService", () => {
  it("claims and completes one non-published to published transition", async () => {
    const harness = createHarness();
    const eventId = catalogPublishedNotificationEventId("deck_ko_basic", 2);

    await expect(
      harness.service.send({
        deckId: "deck_ko_basic",
        before: { status: "draft", version: 1, publishedAt: null },
        after: { status: "published", version: 2, publishedAt: NOW },
      })
    ).resolves.toEqual({ sent: true, eventId });

    expect(harness.events.claimCatalogNotificationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId,
        leaseId: LEASE_ID,
        now: NOW,
        maxAttempts: 8,
      })
    );
    expect(harness.sender.sendCatalogPublished).toHaveBeenCalledWith(
      { eventId },
      [TARGET]
    );
    expect(
      harness.events.completeCatalogNotificationEvent
    ).toHaveBeenCalledWith({
      eventId,
      leaseId: LEASE_ID,
      status: "delivered",
      now: NOW,
    });
  });

  it("deduplicates an already terminal event before Messaging", async () => {
    const harness = createHarness({ claimed: false });
    const eventId = catalogPublishedNotificationEventId("deck-new", 1);

    await expect(
      harness.service.send({
        deckId: "deck-new",
        before: catalogPublicationState(undefined),
        after: {
          status: "published",
          version: 1,
          publishedAt: NOW.toISOString(),
        },
      })
    ).resolves.toEqual({ sent: false, eventId });
    expect(harness.sender.sendCatalogPublished).not.toHaveBeenCalled();
  });

  it("records a transient provider failure as retryable without raw data", async () => {
    const harness = createHarness({
      sendFailure: new NotificationMessagingRetryError(),
    });
    const eventId = catalogPublishedNotificationEventId("deck-new", 1);

    await expect(
      harness.service.send({
        deckId: "deck-new",
        before: catalogPublicationState(undefined),
        after: { status: "published", version: 1, publishedAt: NOW },
      })
    ).rejects.toBeInstanceOf(NotificationMessagingRetryError);
    expect(
      harness.events.completeCatalogNotificationEvent
    ).toHaveBeenCalledWith({
      eventId,
      leaseId: LEASE_ID,
      status: "failed",
      now: NOW,
    });
  });

  it("invalidates only the exact token snapshot rejected by Messaging", async () => {
    const harness = createHarness({
      sendResult: {
        deliveredCount: 0,
        invalidInstallationHashes: [TARGET.installationHash],
        transientFailureCount: 0,
        permanentFailureCount: 0,
      },
    });

    await expect(
      harness.service.send({
        deckId: "deck-new",
        before: catalogPublicationState(undefined),
        after: { status: "published", version: 1, publishedAt: NOW },
      })
    ).resolves.toMatchObject({ sent: false });
    expect(
      harness.notifications.deleteCatalogNotificationInstallations
    ).toHaveBeenCalledWith([
      {
        installationHash: TARGET.installationHash,
        fcmTokenHash: sha256(TARGET.fcmToken),
      },
    ]);
  });

  it("turns an active durable lease into an Eventarc retry", async () => {
    const harness = createHarness({
      claimFailure: new BackendError("aborted", "active", {
        kind: "catalog-notification-lease-active",
      }),
    });

    await expect(
      harness.service.send({
        deckId: "deck-new",
        before: catalogPublicationState(undefined),
        after: { status: "published", version: 1, publishedAt: NOW },
      })
    ).rejects.toBeInstanceOf(CatalogPublishedNotificationRetryError);
    expect(harness.sender.sendCatalogPublished).not.toHaveBeenCalled();
  });

  it.each([
    ["draft", "draft", null],
    ["published", "published", "2026-07-12T00:00:00.000Z"],
    ["published", "archived", "2026-07-12T00:00:00.000Z"],
    ["archived", "published", "2026-07-12T00:00:00.000Z"],
  ])("ignores the %s to %s transition", async (before, after, publishedAt) => {
    const harness = createHarness();

    await expect(
      harness.service.send({
        deckId: "deck-a",
        before: { status: before, version: 1, publishedAt },
        after: { status: after, version: 2, publishedAt: null },
      })
    ).resolves.toEqual({ sent: false, eventId: null });
    expect(harness.events.claimCatalogNotificationEvent).not.toHaveBeenCalled();
  });

  it("rejects malformed published state before invoking the repository", async () => {
    const harness = createHarness();
    const failure = await harness.service
      .send({
        deckId: "../unsafe",
        before: { status: "draft", version: 1, publishedAt: null },
        after: { status: "published", version: 0, publishedAt: null },
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(BackendError);
    expect(isCatalogPublicationInputError(failure)).toBe(true);
    expect(harness.events.claimCatalogNotificationEvent).not.toHaveBeenCalled();
  });

  it("accepts Firestore Timestamp-like dates without retaining deck metadata", () => {
    expect(
      catalogPublicationState({
        status: "published",
        version: 1,
        publishedAt: { toDate: () => NOW },
        title: "must-not-be-retained",
      })
    ).toEqual({
      status: "published",
      version: 1,
      publishedAt: { toDate: expect.any(Function) },
    });
  });
});

function createHarness(input?: {
  readonly claimed?: boolean;
  readonly claimFailure?: Error;
  readonly sendFailure?: Error;
  readonly sendResult?: {
    readonly deliveredCount: number;
    readonly invalidInstallationHashes: readonly string[];
    readonly transientFailureCount: number;
    readonly permanentFailureCount: number;
  };
}) {
  const events: CatalogNotificationEventRepository = {
    claimCatalogNotificationEvent: vi.fn(async () => {
      if (input?.claimFailure !== undefined) throw input.claimFailure;
      return input?.claimed ?? true;
    }),
    completeCatalogNotificationEvent: vi.fn(async () => undefined),
  };
  const notifications = {
    listCatalogNotificationInstallations: vi.fn(async () => [TARGET]),
    deleteCatalogNotificationInstallations: vi.fn(async () => undefined),
  } as unknown as NotificationRepository;
  const sender = {
    sendCatalogPublished: vi.fn(async () => {
      if (input?.sendFailure !== undefined) throw input.sendFailure;
      return (
        input?.sendResult ?? {
          deliveredCount: 1,
          invalidInstallationHashes: [],
          transientFailureCount: 0,
          permanentFailureCount: 0,
        }
      );
    }),
  };
  return {
    events,
    notifications,
    sender,
    service: new CatalogPublishedNotificationService(
      events,
      notifications,
      sender,
      { now: () => NOW },
      () => LEASE_ID
    ),
  };
}
