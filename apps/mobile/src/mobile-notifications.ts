import type {
  DaoewoNotificationPreferences,
  DaoewoNotifications,
} from '@daoewo/product-ui';

import NativeDaoewoNotifications, {
  type Spec as NativeDaoewoNotificationsModule,
} from '../specs/NativeDaoewoNotifications';

export const NO_REVIEW_NOTIFICATION_EPOCH_MS = -1;

export async function requestMobileNotificationPermission(
  nativeModule: NativeDaoewoNotificationsModule | null = NativeDaoewoNotifications,
): Promise<boolean> {
  return nativeModule === null ? false : nativeModule.requestPermission();
}

export function createMobileNotificationsAdapter(
  nativeModule: NativeDaoewoNotificationsModule | null = NativeDaoewoNotifications,
): DaoewoNotifications {
  return {
    availability: nativeModule === null ? 'unsupported' : 'available',
    async applyPreferences(preferences) {
      if (nativeModule === null) {
        throw new Error('이 기기에서 알림을 예약할 수 없어요.');
      }
      await nativeModule.applyPreferences(
        preferences.dailyReminder,
        preferences.reviewReminder,
        nextReviewEpochMs(preferences),
      );
    },
    async clear() {
      if (nativeModule !== null) {
        await nativeModule.clear();
      }
    },
  };
}

export function nextReviewEpochMs(
  preferences: DaoewoNotificationPreferences,
): number {
  if (!preferences.reviewReminder || preferences.nextReviewAt === null) {
    return NO_REVIEW_NOTIFICATION_EPOCH_MS;
  }
  const epochMs = Date.parse(preferences.nextReviewAt);
  if (!Number.isFinite(epochMs)) {
    throw new Error('복습 알림 시각이 올바르지 않아요.');
  }
  return epochMs;
}
