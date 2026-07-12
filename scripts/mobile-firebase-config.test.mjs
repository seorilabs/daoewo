import assert from 'node:assert/strict';
import test from 'node:test';

import {
  injectIosGoogleUrlScheme,
  readPlistString,
} from './mobile-firebase-config.mjs';

const markers = `<?xml version="1.0"?><plist><dict>
<!-- DAOEWO_FIREBASE_URL_SCHEME_BEGIN -->
<!-- DAOEWO_FIREBASE_URL_SCHEME_END -->
</dict></plist>`;

test('Google plist 문자열을 공백과 무관하게 읽는다', () => {
  assert.equal(
    readPlistString(
      '<dict><key> BUNDLE_ID </key>\n<string> com.seorilabs.daoewo </string></dict>',
      'BUNDLE_ID',
    ),
    'com.seorilabs.daoewo',
  );
});

test('iOS reversed client URL scheme 주입은 멱등적이다', () => {
  const first = injectIosGoogleUrlScheme(
    markers,
    'com.googleusercontent.apps.daoewo-test',
  );
  const second = injectIosGoogleUrlScheme(
    first,
    'com.googleusercontent.apps.daoewo-test',
  );
  assert.equal(second, first);
  assert.equal(
    first.match(/com\.googleusercontent\.apps\.daoewo-test/g)?.length,
    1,
  );
  assert.equal(first.match(/CFBundleURLTypes/g)?.length, 1);
});

test('잘못된 scheme과 marker 누락을 거부한다', () => {
  assert.throws(
    () => injectIosGoogleUrlScheme(markers, 'https://example.com'),
    /형식/,
  );
  assert.throws(
    () =>
      injectIosGoogleUrlScheme(
        '<plist><dict></dict></plist>',
        'com.googleusercontent.apps.daoewo-test',
      ),
    /marker/,
  );
});
