import type { Messaging, MulticastMessage } from "firebase-admin/messaging";
import { describe, expect, it, vi } from "vitest";
import {
  FirebaseMessagingSender,
  NotificationMessagingRetryError,
} from "../../src/notifications/firebase-messaging-sender.js";

describe("FirebaseMessagingSender", () => {
  it("sends only the fixed deck-ready payload and classifies provider results", async () => {
    const sendEachForMulticast = vi.fn(async (_message: MulticastMessage) => ({
      successCount: 1,
      failureCount: 3,
      responses: [
        { success: true },
        {
          success: false,
          error: { code: "messaging/registration-token-not-registered" },
        },
        { success: false, error: { code: "messaging/invalid-argument" } },
        { success: false, error: { code: "messaging/internal-error" } },
      ],
    }));
    const sender = new FirebaseMessagingSender({
      sendEachForMulticast,
    } as unknown as Pick<Messaging, "sendEachForMulticast">);

    await expect(
      sender.sendDeckReady(
        {
          eventId: "event-a",
        },
        [
          deliveryTarget("installation-1", "token-1"),
          deliveryTarget("installation-2", "token-2"),
          deliveryTarget("installation-3", "token-3"),
          deliveryTarget("installation-4", "token-4"),
        ]
      )
    ).resolves.toEqual({
      deliveredCount: 1,
      invalidInstallationHashes: ["installation-2"],
      transientFailureCount: 1,
      permanentFailureCount: 1,
    });

    const sent = sendEachForMulticast.mock.calls[0]?.[0];
    expect(sent).toEqual(
      expect.objectContaining({
        tokens: ["token-1", "token-2", "token-3", "token-4"],
        notification: {
          title: "다외워",
          body: "요청한 덱이 준비됐어요.",
        },
        data: {
          kind: "deck-ready",
        },
      })
    );
    expect(JSON.stringify(sent)).not.toMatch(/uid|topic|note/);
  });

  it("replaces provider exceptions with a token-free retry error", async () => {
    const rawToken = "secret-token-that-must-not-escape";
    const sendEachForMulticast = vi.fn(async () => {
      throw new Error(`provider failed for ${rawToken}`);
    });
    const sender = new FirebaseMessagingSender({
      sendEachForMulticast,
    } as unknown as Pick<Messaging, "sendEachForMulticast">);

    const failure = await sender
      .sendDeckReady(
        {
          eventId: "event-a",
        },
        [deliveryTarget("installation-1", rawToken)]
      )
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(NotificationMessagingRetryError);
    expect(String(failure)).not.toContain(rawToken);
  });

  it("sends a fixed catalog publication payload only to opted-in installations", async () => {
    const sendEachForMulticast = vi.fn(async (_message: MulticastMessage) => ({
      successCount: 2,
      failureCount: 0,
      responses: [{ success: true }, { success: true }],
    }));
    const sender = new FirebaseMessagingSender({
      sendEachForMulticast,
    } as unknown as Pick<Messaging, "sendEachForMulticast">);

    await expect(
      sender.sendCatalogPublished({ eventId: "opaque-event-hash" }, [
        deliveryTarget("installation-1", "token-1"),
        deliveryTarget("installation-2", "token-2"),
      ])
    ).resolves.toMatchObject({ deliveredCount: 2 });

    expect(sendEachForMulticast).toHaveBeenCalledWith({
      tokens: ["token-1", "token-2"],
      notification: {
        title: "다외워",
        body: "새로운 덱이 공개됐어요.",
      },
      data: { kind: "catalog-published" },
      android: {
        collapseKey: "opaque-event-hash",
        notification: { tag: "opaque-event-hash" },
      },
      apns: {
        headers: { "apns-collapse-id": "opaque-event-hash" },
        payload: { aps: { threadId: "deck-updates" } },
      },
    });
  });

  it("sanitizes catalog multicast provider failures", async () => {
    const rawSecret = "server-secret-must-not-escape";
    const sender = new FirebaseMessagingSender({
      sendEachForMulticast: vi.fn(async () => {
        throw new Error(rawSecret);
      }),
    } as unknown as Pick<Messaging, "sendEachForMulticast">);

    const failure = await sender
      .sendCatalogPublished({ eventId: "opaque-event-hash" }, [
        deliveryTarget("installation-1", "token-1"),
      ])
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(NotificationMessagingRetryError);
    expect(String(failure)).not.toContain(rawSecret);
  });
});

function deliveryTarget(installationHash: string, fcmToken: string) {
  return {
    installationHash,
    fcmToken,
    platform: "android" as const,
    locale: "ko-KR",
  };
}
