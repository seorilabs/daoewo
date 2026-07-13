import type { Clock } from "../domain/types.js";
import type { NotificationRepository } from "../repositories/contracts.js";
import { sha256 } from "../utils/hash.js";
import { addHours } from "../utils/time.js";
import type {
  RegisterNotificationInstallationInput,
  UnregisterNotificationInstallationInput,
} from "./types.js";
import {
  MAX_NOTIFICATION_INSTALLATIONS_PER_ACCOUNT,
  NOTIFICATION_INSTALLATION_TTL_HOURS,
} from "./policy.js";

export class NotificationInstallationService {
  constructor(
    private readonly repository: NotificationRepository,
    private readonly clock: Clock,
  ) {}

  async register(
    uid: string,
    input: RegisterNotificationInstallationInput,
  ): Promise<{ readonly registered: true }> {
    const now = this.clock.now();
    const installationHash = notificationInstallationHash(input.deviceId);
    await this.repository.upsertNotificationInstallation({
      installation: {
        installationHash,
        uid,
        appId: "daoewo",
        fcmToken: input.fcmToken,
        fcmTokenHash: sha256(input.fcmToken),
        platform: input.platform,
        deckReadyEnabled: true,
        locale: input.locale,
        appVersion: input.appVersion,
        buildNumber: input.buildNumber,
        createdAt: now.toISOString(),
        tokenUpdatedAt: now.toISOString(),
        lastSeenAt: now.toISOString(),
        updatedAt: now.toISOString(),
        expiresAt: addHours(now, NOTIFICATION_INSTALLATION_TTL_HOURS).toISOString(),
      },
      maxInstallationsPerAccount: MAX_NOTIFICATION_INSTALLATIONS_PER_ACCOUNT,
    });
    return { registered: true };
  }

  async unregister(
    uid: string,
    input: UnregisterNotificationInstallationInput,
  ): Promise<{ readonly unregistered: true }> {
    await this.repository.unregisterNotificationInstallation(
      uid,
      notificationInstallationHash(input.deviceId),
    );
    // 다른 계정 binding 존재 여부를 응답으로 노출하지 않는다.
    return { unregistered: true };
  }
}

export function notificationInstallationHash(deviceId: string): string {
  return sha256(`daoewo:${deviceId}`);
}
