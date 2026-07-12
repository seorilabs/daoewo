import assert from "node:assert/strict";
import test from "node:test";
import { prioritizeBacklog } from "../src/backlog.mjs";
import { readJson } from "../src/io.mjs";
import { BACKLOG_PATH, CARD_SCHEMA_PATH, CATALOG_PATH, CATALOG_SCHEMA_PATH } from "../src/paths.mjs";
import { assertBacklog, assertCatalog, assertSchemas } from "../src/validation.mjs";

test("v1 manifest는 14덱, Free 6/Pro 8, P1 7/P2 5/P3 2를 강제한다", async () => {
  const catalog = await readJson(CATALOG_PATH);
  assert.doesNotThrow(() => assertCatalog(catalog));
  assert.equal(catalog.decks.length, 14);
  assert.equal(catalog.decks.filter((deck) => deck.tier === "free").length, 6);
  assert.equal(catalog.decks.filter((deck) => deck.tier === "pro").length, 8);
  assert.deepEqual(
    Object.fromEntries(["P1", "P2", "P3"].map((priority) => [priority, catalog.decks.filter((deck) => deck.priority === priority).length])),
    { P1: 7, P2: 5, P3: 2 },
  );
  assert.ok(catalog.decks.every((deck) => deck.chunkSize === 200));
  assert.ok(catalog.decks.every((deck) => deck.status !== "published" && deck.reviewer.status === "pending"));
});

test("외부 import source는 실제 commit과 revision pin이 없으면 거부한다", async () => {
  const catalog = await readJson(CATALOG_PATH);
  const imported = catalog.decks.filter((deck) => deck.source.external);
  assert.ok(imported.length > 0);
  assert.ok(imported.every((deck) => /^[a-f0-9]{40}$/.test(deck.source.commit) && deck.source.revision.length > 0));

  const broken = structuredClone(catalog);
  broken.decks.find((deck) => deck.source.external).source.commit = null;
  assert.throws(() => assertCatalog(broken), /commit pin/);
});

test("라이선스는 상업 이용 확인·attribution·ShareAlike 배포 고지를 요구한다", async () => {
  const catalog = await readJson(CATALOG_PATH);

  const commercialUseUnknown = structuredClone(catalog);
  commercialUseUnknown.decks[0].license.components[0].commercialUse = false;
  assert.throws(() => assertCatalog(commercialUseUnknown), /상업 이용 가능 확인/);

  const missingAttribution = structuredClone(catalog);
  missingAttribution.decks[0].license.components[0].attribution = "";
  assert.throws(() => assertCatalog(missingAttribution), /불완전/);

  const missingShareAlikeNotice = structuredClone(catalog);
  missingShareAlikeNotice.decks[0].license.distributionNotice = "출처만 표시한다.";
  assert.throws(() => assertCatalog(missingShareAlikeNotice), /ShareAlike/);
});

test("사람 승인 정보가 없는 published manifest를 거부한다", async () => {
  const catalog = await readJson(CATALOG_PATH);
  const broken = structuredClone(catalog);
  broken.decks[0].status = "published";
  broken.decks[0].provenance.inputDigest = `sha256:${"a".repeat(64)}`;
  assert.throws(() => assertCatalog(broken), /사람 승인/);
});

test("JSON Schema 산출물은 Card sourceRefs와 200장/14덱 불변식을 선언한다", async () => {
  const [cardSchema, catalogSchema] = await Promise.all([readJson(CARD_SCHEMA_PATH), readJson(CATALOG_SCHEMA_PATH)]);
  assert.doesNotThrow(() => assertSchemas(cardSchema, catalogSchema));
});

test("priority backlog는 요청·검색미스·트렌드·운영 입력을 집계하고 Pro 요청을 가산한다", async () => {
  const backlog = await readJson(BACKLOG_PATH);
  assert.doesNotThrow(() => assertBacklog(backlog));
  assert.deepEqual(new Set(backlog.signals.map((signal) => signal.source)), new Set(["deck-request", "search-miss", "trend", "operator"]));
  const ranked = prioritizeBacklog(backlog);
  assert.equal(ranked[0].topicKey, "sql-interview-core");
  assert.ok(ranked[0].sourceBreakdown["deck-request"] > ranked[0].sourceBreakdown["search-miss"]);
});
