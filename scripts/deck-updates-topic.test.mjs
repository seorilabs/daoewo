import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const clientSource = readFileSync(
  "apps/mobile/src/adapters/firebase-messaging.ts",
  "utf8"
);
const serverSource = readFileSync(
  "functions/src/notifications/firebase-messaging-sender.ts",
  "utf8"
);

test("신규 덱 알림도 account-scoped opt-in installation multicast만 사용한다", () => {
  assert.doesNotMatch(clientSource, /subscribeToTopic|unsubscribeFromTopic/);
  assert.doesNotMatch(serverSource, /\btopic\s*:/);
  assert.match(serverSource, /tokens:\s*targets\.map/);
});

test("foreground handler는 서버의 두 고정 message kind만 허용한다", () => {
  for (const kind of ["deck-ready", "catalog-published"]) {
    assert.match(clientSource, new RegExp(`kind !== ['\"]${kind}['\"]`));
    assert.match(serverSource, new RegExp(`kind: ['\"]${kind}['\"]`));
  }
});
