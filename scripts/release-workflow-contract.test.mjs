import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const workflows = readdirSync(new URL('../.github/workflows/', import.meta.url))
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .map((name) => ({
    name,
    text: readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8'),
  }));

test('중앙 caller는 불변 SHA만 사용하고 secret 상속을 금지한다', () => {
  for (const workflow of workflows) {
    assert.doesNotMatch(workflow.text, /secrets:\s*inherit/, workflow.name);
    assert.doesNotMatch(workflow.text, /\bversion_(?:name|code|script)\s*:/, workflow.name);
    for (const match of workflow.text.matchAll(/uses:\s*seorilabs\/\.github\/[^@\s]+@([^\s#]+)/g)) {
      assert.match(match[1], /^[0-9a-f]{40}$/, `${workflow.name}: ${match[0]}`);
    }
    for (const match of workflow.text.matchAll(/uses:\s*([^\s#]+)/g)) {
      if (match[1].startsWith('./')) continue;
      assert.match(match[1], /^[^@\s]+@[0-9a-f]{40}$/, `${workflow.name}: ${match[0]}`);
    }
  }
});

test('AIT와 Google Play caller는 허용된 secret만 이름으로 전달한다', () => {
  const ait = workflows.find(({ name }) => name === 'deploy-apps-in-toss.yml')?.text ?? '';
  const play = workflows.find(({ name }) => name === 'deploy-google-play.yml')?.text ?? '';
  assert.match(ait, /APPS_IN_TOSS_API_KEY: \$\{\{ secrets\.APPS_IN_TOSS_API_KEY \}\}/);
  assert.match(play, /GOOGLE_PLAY_UPLOAD_KEYSTORE_BASE64: \$\{\{ secrets\.GOOGLE_PLAY_UPLOAD_KEYSTORE_BASE64 \}\}/);
  assert.match(play, /GOOGLE_PLAY_UPLOAD_KEYSTORE_PASSWORD: \$\{\{ secrets\.GOOGLE_PLAY_UPLOAD_KEYSTORE_PASSWORD \}\}/);
  assert.match(play, /GOOGLE_PLAY_UPLOAD_KEY_PASSWORD: \$\{\{ secrets\.GOOGLE_PLAY_UPLOAD_KEY_PASSWORD \}\}/);
});

test('로컬 버전 resolver를 제거하고 Xcode Cloud가 중앙 helper를 checksum 검증한다', () => {
  assert.equal(existsSync(new URL('./resolve-release-version.mjs', import.meta.url)), false);
  const script = readFileSync(
    new URL('../apps/mobile/ios/ci_scripts/ci_pre_xcodebuild.sh', import.meta.url),
    'utf8',
  );
  assert.match(script, /AUTHORITY_SHA="[0-9a-f]{40}"/);
  assert.match(script, /APPLIER_SHA256="[0-9a-f]{64}"/);
  assert.match(script, /AUTHORITY_SHA256="[0-9a-f]{64}"/);
  assert.match(script, /CI_TAG/);
  assert.match(script, /shasum -a 256 -c/);
  assert.match(script, /apps\/mobile\/ios\/Daoewo\/Info\.plist/);
});

test('마켓 config JSON은 버전 원장이 아니다', () => {
  for (const path of [
    '../play-store/google-play.config.json',
    '../app-store/app-store.config.json',
    '../apps-in-toss/apps-in-toss.config.json',
  ]) {
    const config = JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
    assert.equal(Object.hasOwn(config.release ?? {}, 'version'), false, path);
    assert.equal(Object.hasOwn(config.release ?? {}, 'versionName'), false, path);
    assert.equal(Object.hasOwn(config.release ?? {}, 'versionCode'), false, path);
  }
});
