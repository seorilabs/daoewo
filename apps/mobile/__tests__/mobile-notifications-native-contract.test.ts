import {readFileSync} from 'node:fs';
import {join} from 'node:path';

const iosNotificationsSource = readFileSync(
  join(__dirname, '..', 'ios', 'Daoewo', 'RCTNativeDaoewoNotifications.mm'),
  'utf8',
);
const androidNotificationsSource = readFileSync(
  join(
    __dirname,
    '..',
    'android',
    'app',
    'src',
    'main',
    'java',
    'com',
    'seorilabs',
    'daoewo',
    'NativeDaoewoNotificationsModule.kt',
  ),
  'utf8',
);
const notificationsSpecSource = readFileSync(
  join(__dirname, '..', 'specs', 'NativeDaoewoNotifications.ts'),
  'utf8',
);

describe('iOS local notification native contract', () => {
  it('매일 현지 09시 calendar trigger를 timezone 고정 없이 반복한다', () => {
    const dailyHelper = sourceFunction('DaoewoDailyReminderRequest');

    expect(dailyHelper).toContain('components.hour = 9;');
    expect(dailyHelper).toContain('components.minute = 0;');
    expect(dailyHelper).toContain('repeats:YES');
    expect(dailyHelper).not.toContain('components.timeZone');
  });

  it('복습은 timezone을 포함한 단발 calendar trigger로 예약한다', () => {
    const reviewHelper = sourceFunction('DaoewoReviewReminderRequest');

    expect(reviewHelper).toContain('components.timeZone = calendar.timeZone;');
    expect(reviewHelper).toContain('repeats:NO');
  });

  it('예약 실패 시 기존 pending request를 복원한다', () => {
    expect(iosNotificationsSource).toContain(
      'NSArray<UNNotificationRequest *> *previousRequests',
    );
    expect(iosNotificationsSource).toContain(
      '[self restoreRequests:previousRequests',
    );
  });

  it('typed TurboModule 권한 경계는 양 플랫폼에서 boolean만 반환한다', () => {
    expect(notificationsSpecSource).toContain(
      'requestPermission(): Promise<boolean>;',
    );
    expect(iosNotificationsSource).toContain(
      'getNotificationSettingsWithCompletionHandler',
    );
    expect(iosNotificationsSource).toContain('resolve(@YES);');
    expect(iosNotificationsSource).toContain('resolve(@NO);');
    expect(androidNotificationsSource).toContain(
      'override fun requestPermission(promise: Promise)',
    );
    expect(androidNotificationsSource).toContain('promise.resolve(granted)');
  });
});

function sourceFunction(name: string): string {
  const start = iosNotificationsSource.indexOf(`static UNNotificationRequest *${name}`);
  const next = iosNotificationsSource.indexOf(
    'static UNNotificationRequest *',
    start + 1,
  );
  expect(start).toBeGreaterThanOrEqual(0);
  return iosNotificationsSource.slice(start, next < 0 ? undefined : next);
}
