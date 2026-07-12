import { sha256 } from "../utils/hash.js";
import type {
  NotificationDeliveryTarget,
  NotificationInstallationInvalidation,
} from "./types.js";

/** 계정 병합과 일반 등록이 함께 지켜야 하는 notification installation 상한이다. */
export const MAX_NOTIFICATION_INSTALLATIONS_PER_ACCOUNT = 10;

/** 마지막 정상 등록 후 installation을 보존하는 시간이다. */
export const NOTIFICATION_INSTALLATION_TTL_HOURS = 35 * 24;

/** Messaging 응답이 가리킨 조회 시점 token만 안전하게 무효화한다. */
export function notificationInstallationInvalidations(
  targets: readonly NotificationDeliveryTarget[],
  invalidInstallationHashes: readonly string[]
): NotificationInstallationInvalidation[] {
  const invalidHashes = new Set(invalidInstallationHashes);
  return targets
    .filter((target) => invalidHashes.has(target.installationHash))
    .map((target) => ({
      installationHash: target.installationHash,
      fcmTokenHash: sha256(target.fcmToken),
    }));
}
