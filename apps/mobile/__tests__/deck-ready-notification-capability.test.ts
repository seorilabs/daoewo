import { resolveDeckReadyNotificationAvailability } from '../src/deck-ready-notification-capability';

describe('덱 준비 알림 Remote Config capability', () => {
  it('Remote Config 판정 전에는 available을 노출하지 않는다', () => {
    expect(
      resolveDeckReadyNotificationAvailability({
        remoteConfigResolved: false,
        pushEnabled: true,
      }),
    ).toBe('resolving');
  });

  it('판정 뒤 true만 available이고 false/default는 disabled-by-config다', () => {
    expect(
      resolveDeckReadyNotificationAvailability({
        remoteConfigResolved: true,
        pushEnabled: true,
      }),
    ).toBe('available');
    expect(
      resolveDeckReadyNotificationAvailability({
        remoteConfigResolved: true,
        pushEnabled: false,
      }),
    ).toBe('disabled-by-config');
  });
});
