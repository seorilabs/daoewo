import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveVersion } from './resolve-release-version.mjs';

test('SemVer tag를 Android와 Apple 버전으로 동일하게 변환한다', () => {
  assert.deepEqual(resolveVersion('v1.2.3'), {
    tag: 'v1.2.3',
    version: '1.2.3',
    version_name: '1.2.3',
    android_version_code: '1002003',
    apple_marketing_version: '1.2.3',
    apple_build_number: '1002003',
    release_name: 'v1.2.3',
  });
});

test('잘못된 태그와 0 build number를 거부한다', () => {
  assert.throws(() => resolveVersion('1.2.3'));
  assert.throws(() => resolveVersion('v0.0.0'));
});
