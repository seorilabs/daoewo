import type { Spec as NativeDaoewoNotificationsModule } from '../specs/NativeDaoewoNotifications';
import {
  createMobileNotificationsAdapter,
  nextReviewEpochMs,
  NO_REVIEW_NOTIFICATION_EPOCH_MS,
  requestMobileNotificationPermission,
} from '../src/mobile-notifications';

function createModule(): jest.Mocked<NativeDaoewoNotificationsModule> {
  return {
    requestPermission: jest.fn().mockResolvedValue(true),
    applyPreferences: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
  };
}

describe('mobile notifications adapter', () => {
  it('덱 준비 push도 app-local native 권한 경계를 재사용한다', async () => {
    const nativeModule = createModule();

    await expect(
      requestMobileNotificationPermission(nativeModule),
    ).resolves.toBe(true);
    await expect(requestMobileNotificationPermission(null)).resolves.toBe(
      false,
    );
    expect(nativeModule.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('daily와 가장 빠른 review 시각을 native Promise 계약으로 전달한다', async () => {
    const nativeModule = createModule();
    const notifications = createMobileNotificationsAdapter(nativeModule);

    await expect(
      notifications.applyPreferences({
        dailyReminder: true,
        reviewReminder: true,
        nextReviewAt: '2026-07-13T12:34:56.000Z',
      }),
    ).resolves.toBeUndefined();

    expect(notifications.availability).toBe('available');
    expect(nativeModule.applyPreferences).toHaveBeenCalledWith(
      true,
      true,
      Date.parse('2026-07-13T12:34:56.000Z'),
    );
  });

  it('review가 꺼졌거나 일정이 없으면 one-shot을 해제하는 sentinel을 전달한다', () => {
    expect(
      nextReviewEpochMs({
        dailyReminder: true,
        reviewReminder: false,
        nextReviewAt: 'invalid-but-disabled',
      }),
    ).toBe(NO_REVIEW_NOTIFICATION_EPOCH_MS);
    expect(
      nextReviewEpochMs({
        dailyReminder: false,
        reviewReminder: true,
        nextReviewAt: null,
      }),
    ).toBe(NO_REVIEW_NOTIFICATION_EPOCH_MS);
  });

  it('잘못된 review 시각은 native 호출 전에 거부한다', async () => {
    const nativeModule = createModule();
    const notifications = createMobileNotificationsAdapter(nativeModule);

    await expect(
      notifications.applyPreferences({
        dailyReminder: false,
        reviewReminder: true,
        nextReviewAt: 'not-a-date',
      }),
    ).rejects.toThrow('올바르지');
    expect(nativeModule.applyPreferences).not.toHaveBeenCalled();
  });

  it('module 부재는 unsupported로 노출하고 clear는 안전하게 끝낸다', async () => {
    const notifications = createMobileNotificationsAdapter(null);

    expect(notifications.availability).toBe('unsupported');
    await expect(
      notifications.applyPreferences({
        dailyReminder: true,
        reviewReminder: false,
        nextReviewAt: null,
      }),
    ).rejects.toThrow('알림');
    await expect(notifications.clear()).resolves.toBeUndefined();
  });

  it('clear와 native 오류를 Promise로 전달한다', async () => {
    const nativeModule = createModule();
    const notifications = createMobileNotificationsAdapter(nativeModule);
    nativeModule.applyPreferences.mockRejectedValueOnce(
      new Error('permission denied'),
    );

    await expect(
      notifications.applyPreferences({
        dailyReminder: true,
        reviewReminder: false,
        nextReviewAt: null,
      }),
    ).rejects.toThrow('permission denied');
    await expect(notifications.clear()).resolves.toBeUndefined();
    expect(nativeModule.clear).toHaveBeenCalledTimes(1);
  });
});
