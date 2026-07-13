import { describe, expect, it, vi } from "vitest";
import type { NotificationRepository } from "../../src/repositories/contracts.js";
import {
  NotificationInstallationService,
  notificationInstallationHash,
} from "../../src/notifications/installation-service.js";

const NOW = new Date("2026-07-12T00:00:00.000Z");

describe("NotificationInstallationService", () => {
  it("hashes installation/token server-side and returns no identifiers", async () => {
    const repository = fakeRepository();
    const service = new NotificationInstallationService(repository, {
      now: () => NOW,
    });
    const input = {
      deviceId: "stable-notification-device-1234",
      fcmToken: "fcm-token-at-least-sixteen-characters",
      platform: "android" as const,
      locale: "ko-KR",
      appVersion: "1.0.0",
      buildNumber: "1",
    };

    const response = await service.register("user-a", input);

    expect(response).toEqual({ registered: true });
    expect(JSON.stringify(response)).not.toMatch(/user-a|token|device/i);
    expect(repository.upsertNotificationInstallation).toHaveBeenCalledWith(
      expect.objectContaining({
        maxInstallationsPerAccount: 10,
        installation: expect.objectContaining({
          installationHash: notificationInstallationHash(input.deviceId),
          uid: "user-a",
          fcmToken: input.fcmToken,
          fcmTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          deckReadyEnabled: true,
          expiresAt: "2026-08-16T00:00:00.000Z",
        }),
      })
    );
  });

  it("unregisters by stable installation hash and keeps the response opaque", async () => {
    const repository = fakeRepository();
    const service = new NotificationInstallationService(repository, {
      now: () => NOW,
    });

    await expect(
      service.unregister("user-a", {
        deviceId: "stable-notification-device-1234",
      })
    ).resolves.toEqual({ unregistered: true });
    expect(repository.unregisterNotificationInstallation).toHaveBeenCalledWith(
      "user-a",
      notificationInstallationHash("stable-notification-device-1234")
    );
  });
});

function fakeRepository(): NotificationRepository {
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
  };
}
