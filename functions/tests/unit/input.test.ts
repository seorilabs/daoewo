import { describe, expect, it } from "vitest";
import { createInitialCardProgress } from "@daoewo/product-core";
import {
  parseCompleteDeckRequest,
  parseDeleteAccount,
  parseProgressBatch,
  parsePushLearningBackup,
  parseRegisterNotificationInstallation,
  parseReceipt,
  parseUnregisterNotificationInstallation,
} from "../../src/input.js";

describe("operator deck request input", () => {
  it("admits only bounded request and deck IDs", () => {
    expect(
      parseCompleteDeckRequest({
        requestId: "request-a",
        readyDeckId: "published-deck",
        readyRevision: 999,
        readyAt: "forged",
        status: "ready",
        operatorClaim: true,
      }),
    ).toEqual({
      requestId: "request-a",
      readyDeckId: "published-deck",
    });

    for (const input of [
      { requestId: "request/a", readyDeckId: "published-deck" },
      { requestId: "request-a", readyDeckId: "../private" },
      { requestId: "", readyDeckId: "published-deck" },
    ]) {
      expect(() => parseCompleteDeckRequest(input)).toThrowError(
        expect.objectContaining({ code: "invalid-argument" }),
      );
    }
  });
});

describe("receipt input", () => {
  it("accepts AppsInToss pending orders with orderId and sku only", () => {
    expect(
      parseReceipt({
        platform: "apps-in-toss",
        orderId: "pending-order-id",
        sku: "daoewo.pro.monthly",
      }),
    ).toEqual({
      platform: "apps-in-toss",
      productId: "daoewo.pro.monthly",
      orderId: "pending-order-id",
      sku: "daoewo.pro.monthly",
    });
  });

  it("still rejects an AppsInToss client claim without orderId", () => {
    expect(() =>
      parseReceipt({
        platform: "apps-in-toss",
        sku: "daoewo.pro.monthly",
        processProductGrant: true,
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid-argument" }));
  });
});

describe("account deletion input", () => {
  it("requires an explicit destructive confirmation", () => {
    expect(parseDeleteAccount({ confirmation: "DELETE" })).toBeUndefined();
    expect(() => parseDeleteAccount({ confirmation: "delete" })).toThrowError(
      expect.objectContaining({ code: "invalid-argument" }),
    );
  });
});

describe("notification installation input", () => {
  it("accepts a bounded mobile registration without admitting extra fields", () => {
    expect(
      parseRegisterNotificationInstallation({
        deviceId: "stable-notification-device-1234",
        fcmToken: "fcm-token-at-least-sixteen-characters",
        platform: "ios",
        locale: "ko-KR",
        appVersion: "1.2.3",
        buildNumber: "42",
        uid: "forged-user",
        topic: "private topic",
      }),
    ).toEqual({
      deviceId: "stable-notification-device-1234",
      fcmToken: "fcm-token-at-least-sixteen-characters",
      platform: "ios",
      locale: "ko-KR",
      appVersion: "1.2.3",
      buildNumber: "42",
    });
    expect(
      parseUnregisterNotificationInstallation({
        deviceId: "stable-notification-device-1234",
        uid: "forged-user",
      }),
    ).toEqual({ deviceId: "stable-notification-device-1234" });
  });

  it("rejects unsupported platforms, short tokens, malformed locales, and free-form versions", () => {
    const valid = {
      deviceId: "stable-notification-device-1234",
      fcmToken: "fcm-token-at-least-sixteen-characters",
      platform: "android",
      locale: "ko-KR",
      appVersion: "1.2.3",
      buildNumber: "42",
    };
    for (const invalid of [
      { ...valid, platform: "web" },
      { ...valid, fcmToken: "short" },
      { ...valid, locale: "not a locale" },
      { ...valid, appVersion: "user@example.com" },
      { ...valid, buildNumber: "token=secret" },
    ]) {
      expect(() => parseRegisterNotificationInstallation(invalid)).toThrowError(
        expect.objectContaining({ code: "invalid-argument" }),
      );
    }
  });
});

describe("learning backup input", () => {
  it("accepts bounded metadata-only Free progress and session snapshots", () => {
    const parsed = parsePushLearningBackup(validLearningBackup());

    expect(parsed.baseRevision).toBe(2);
    expect(parsed.snapshot.freeDecks[0]?.progresses[0]).toMatchObject({
      cardIndex: 0,
      state: { cardId: "free-card.1", deckId: "free-deck" },
    });
    expect(JSON.stringify(parsed)).not.toContain("private card body");
  });

  it("rejects duplicate card identities and malformed timestamps", () => {
    const duplicate = validLearningBackup();
    duplicate.snapshot.freeDecks[0]!.progresses.push(
      duplicate.snapshot.freeDecks[0]!.progresses[0]!,
    );
    expect(() => parsePushLearningBackup(duplicate)).toThrowError(
      expect.objectContaining({ code: "invalid-argument" }),
    );

    const malformed = validLearningBackup();
    malformed.snapshot.freeDecks[0]!.progresses[0]!.state.updatedAt = "later";
    expect(() => parsePushLearningBackup(malformed)).toThrowError(
      expect.objectContaining({ code: "invalid-argument" }),
    );
  });

  it("rejects oversized assignment payloads before service validation", () => {
    const oversized = validLearningBackup();
    const goal = oversized.snapshot.freeDecks[0]!.goal! as {
      assignments: Record<string, string[]>;
    };
    goal.assignments = Object.fromEntries(
      Array.from({ length: 2_001 }, (_, index) => [
        new Date(Date.UTC(2020, 0, index + 1)).toISOString().slice(0, 10),
        [`free-card.${index}`],
      ]),
    );

    expect(() => parsePushLearningBackup(oversized)).toThrowError(
      expect.objectContaining({ code: "invalid-argument" }),
    );
  });

  it("does not admit card bodies or device identity into the parsed snapshot", () => {
    const input = validLearningBackup() as ReturnType<typeof validLearningBackup> & {
      snapshot: ReturnType<typeof validLearningBackup>["snapshot"] & {
        cardSnapshots?: unknown;
        deviceHash?: string;
      };
    };
    input.snapshot.cardSnapshots = [{ front: "private card body" }];
    input.snapshot.deviceHash = "raw-device-hash";

    const parsed = parsePushLearningBackup(input);
    expect(parsed.snapshot).not.toHaveProperty("cardSnapshots");
    expect(parsed.snapshot).not.toHaveProperty("deviceHash");
  });
});

describe("progress input", () => {
  it("accepts content-pipeline dotted hash card IDs", () => {
    expect(
      parseProgressBatch({
        batchId: "batch_dotted_1234",
        windowId: "window_dotted_1234",
        deviceId: "stable-device-id-1234",
        answers: [{ cardId: "deck-id.a1b2c3", rating: "easy" }],
      }).answers[0]?.cardId,
    ).toBe("deck-id.a1b2c3");
  });
});

function validLearningBackup() {
  const progress = createInitialCardProgress(
    "free-card.1",
    "free-deck",
    new Date("2026-07-12T03:00:00.000Z"),
  );
  return {
    deviceId: "stable-device-id-1234",
    baseRevision: 2,
    mutationId: "sync_mutation_1234",
    snapshot: {
      version: 1,
      freeDecks: [
        {
          deckId: "free-deck",
          deckVersion: 1,
          active: true,
          goal: {
            key: "free-deck",
            deckId: "free-deck",
            mode: "daily-count",
            startDate: "2026-07-12",
            totalCount: 1,
            days: 1,
            dailyCount: 1,
            assignments: { "2026-07-12": ["free-card.1"] },
          },
          progresses: [{ cardIndex: 0, state: { ...progress } }],
        },
      ],
      sessions: [
        {
          id: "session:1",
          deckId: "free-deck",
          date: "2026-07-12",
          target: 1,
          completed: 1,
          known: 1,
          unknown: 0,
          reviewCount: 0,
          elapsedMs: 1_000,
          completedAt: "2026-07-12T03:01:00.000Z",
        },
      ],
    },
  };
}
