import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const defaults = JSON.parse(
  readFileSync("apps/mobile/src/adapters/remote-config-defaults.json", "utf8")
);
const firebaseConfig = JSON.parse(
  readFileSync("firebase/firebase.json", "utf8")
);
const template = JSON.parse(
  readFileSync("firebase/remoteconfig.template.json", "utf8")
);

const expectedTypes = Object.freeze({
  mobile_catalog_cache_ttl_minutes: "NUMBER",
  mobile_deck_updates_push_enabled: "BOOLEAN",
});

test("Remote Config 배포 템플릿과 모바일 local defaults가 일치한다", () => {
  assert.equal(
    firebaseConfig.remoteconfig?.template,
    "remoteconfig.template.json"
  );
  assert.deepEqual(
    Object.keys(template.parameters).sort(),
    Object.keys(defaults).sort()
  );

  for (const [key, value] of Object.entries(defaults)) {
    const parameter = template.parameters[key];
    assert.ok(parameter, `${key} parameter가 필요합니다.`);
    assert.equal(parameter.defaultValue?.value, String(value));
    assert.equal(parameter.valueType, expectedTypes[key]);
    assert.equal(typeof parameter.description, "string");
    assert.ok(parameter.description.trim().length > 0);
  }
});

test("Remote Config key는 비보안 UI/cache allowlist로 제한한다", () => {
  const forbiddenAuthorityPattern =
    /(entitlement|receipt|app.?check|subscription|purchase|free.?limit|pro.?limit)/i;

  for (const key of Object.keys(template.parameters)) {
    assert.doesNotMatch(key, forbiddenAuthorityPattern);
  }

  assert.deepEqual(template.conditions, []);
  assert.deepEqual(template.parameterGroups, {});
});
