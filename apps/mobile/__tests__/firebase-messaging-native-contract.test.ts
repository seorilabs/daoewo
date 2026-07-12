import {readFileSync} from 'node:fs';
import {join} from 'node:path';

const mobileRoot = join(__dirname, '..');
const readMobileFile = (...segments: readonly string[]) =>
  readFileSync(join(mobileRoot, ...segments), 'utf8');

describe('Firebase Messaging native platform contract', () => {
  it('iOS Push와 Background Modes capability를 source control에 고정한다', () => {
    const project = readMobileFile(
      'ios',
      'Daoewo.xcodeproj',
      'project.pbxproj',
    );
    const entitlements = readMobileFile(
      'ios',
      'Daoewo',
      'Daoewo.entitlements',
    );
    const infoPlist = readMobileFile('ios', 'Daoewo', 'Info.plist');

    expect(project).toContain('com.apple.Push = {');
    expect(project).toContain('com.apple.BackgroundModes = {');
    expect(project).toContain('APS_ENVIRONMENT = development;');
    expect(project).toContain('APS_ENVIRONMENT = production;');
    expect(entitlements).toContain('<key>aps-environment</key>');
    expect(entitlements).toContain('<string>$(APS_ENVIRONMENT)</string>');
    expect(infoPlist).toContain('<key>UIBackgroundModes</key>');
    expect(infoPlist).toContain('<string>fetch</string>');
    expect(infoPlist).toContain('<string>remote-notification</string>');
  });

  it('FCM 등록은 opt-in 전 자동 시작하지 않는다', () => {
    const firebaseConfig = JSON.parse(
      readMobileFile('firebase.json'),
    ) as FirebaseJson;

    expect(firebaseConfig['react-native'].messaging_auto_init_enabled).toBe(
      false,
    );
    expect(
      firebaseConfig['react-native']
        .messaging_ios_auto_register_for_remote_messages,
    ).toBe(false);
  });

  it('Android 표시 알림은 앱 소유 channel과 generic icon을 사용한다', () => {
    const firebaseConfig = JSON.parse(
      readMobileFile('firebase.json'),
    ) as FirebaseJson;
    const manifest = readMobileFile(
      'android',
      'app',
      'src',
      'main',
      'AndroidManifest.xml',
    );
    const application = readMobileFile(
      'android',
      'app',
      'src',
      'main',
      'java',
      'com',
      'seorilabs',
      'daoewo',
      'MainApplication.kt',
    );

    expect(manifest).toContain('android.permission.POST_NOTIFICATIONS');
    expect(manifest).toContain(
      'com.google.firebase.messaging.default_notification_icon',
    );
    expect(manifest).toContain('@drawable/ic_notification');
    expect(
      firebaseConfig['react-native']
        .messaging_android_notification_channel_id,
    ).toBe('daoewo_reminders');
    expect(
      firebaseConfig['react-native'].messaging_android_notification_color,
    ).toBe('@color/daoewo_indigo');
    expect(application).toContain(
      'DaoewoNotificationScheduler.ensureChannel(this)',
    );
  });

  it('client messaging adapter는 raw token이나 UID를 console에 기록하지 않는다', () => {
    const adapter = readMobileFile(
      'src',
      'adapters',
      'firebase-messaging.ts',
    );

    expect(adapter).not.toMatch(/\bconsole\.(?:log|info|debug|warn|error)\s*\(/);
  });

  it('native 권한·등록 경계는 token이나 사용자 데이터를 받거나 기록하지 않는다', () => {
    const nativeSources = [
      readMobileFile(
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
      readMobileFile(
        'ios',
        'Daoewo',
        'RCTNativeDaoewoNotifications.mm',
      ),
      readMobileFile('ios', 'Daoewo', 'AppDelegate.swift'),
    ].join('\n');

    expect(nativeSources).not.toMatch(/\b(?:fcmToken|rawToken|userId|uid)\b/);
    expect(nativeSources).not.toMatch(/\b(?:Log\.|NSLog\s*\()/);
  });
});

interface FirebaseJson {
  readonly 'react-native': {
    readonly messaging_auto_init_enabled: boolean;
    readonly messaging_ios_auto_register_for_remote_messages: boolean;
    readonly messaging_android_notification_channel_id: string;
    readonly messaging_android_notification_color: string;
  };
}
