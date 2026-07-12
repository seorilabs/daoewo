import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

const script = resolve('scripts/restore-mobile-firebase-config.mjs');
const projectId = 'daoewo-test-123';
const android = {
  project_info: {project_id: projectId},
  client: [
    {
      client_info: {
        mobilesdk_app_id: '1:123:android:daoewo',
        android_client_info: {package_name: 'com.seorilabs.daoewo'},
      },
      api_key: [{current_key: 'test-android-api-key'}],
    },
  ],
};
const ios = `<?xml version="1.0"?><plist><dict>
<key>BUNDLE_ID</key><string>com.seorilabs.daoewo</string>
<key>PROJECT_ID</key><string>${projectId}</string>
<key>REVERSED_CLIENT_ID</key><string>com.googleusercontent.apps.daoewo-test</string>
<key>GOOGLE_APP_ID</key><string>1:123:ios:daoewo</string>
<key>API_KEY</key><string>test-ios-api-key</string>
</dict></plist>`;
const info = `<?xml version="1.0"?><plist><dict>
<!-- DAOEWO_FIREBASE_URL_SCHEME_BEGIN -->
<!-- DAOEWO_FIREBASE_URL_SCHEME_END -->
</dict></plist>`;

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'daoewo-mobile-firebase-'));
  const infoPath = join(root, 'apps/mobile/ios/Daoewo/Info.plist');
  mkdirSync(dirname(infoPath), {recursive: true});
  writeFileSync(infoPath, info);
  return root;
}

function run(root, expectedProjectId) {
  return spawnSync(process.execPath, [script, '--all', '--require'], {
    cwd: root,
    env: {
      ...process.env,
      FIREBASE_PROJECT_ID: expectedProjectId,
      FIREBASE_ANDROID_GOOGLE_SERVICES_JSON_BASE64: Buffer.from(
        JSON.stringify(android),
      ).toString('base64'),
      FIREBASE_IOS_GOOGLE_SERVICE_INFO_PLIST_BASE64:
        Buffer.from(ios).toString('base64'),
    },
    encoding: 'utf8',
  });
}

test('동일 Firebase project의 Android/iOS 설정만 복원한다', () => {
  const root = fixtureRoot();
  try {
    const result = run(root, projectId);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      JSON.parse(
        readFileSync(
          join(root, 'apps/mobile/android/app/google-services.json'),
          'utf8',
        ),
      ).project_info.project_id,
      projectId,
    );
    assert.match(
      readFileSync(join(root, 'apps/mobile/ios/Daoewo/Info.plist'), 'utf8'),
      /com\.googleusercontent\.apps\.daoewo-test/,
    );
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('다른 Firebase project의 native 설정을 거부한다', () => {
  const root = fixtureRoot();
  try {
    const result = run(root, 'daoewo-other-456');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /project_id does not match/);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
