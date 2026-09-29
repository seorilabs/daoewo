import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readJson } from "../src/io.mjs";
import { dedupeCards, normalizeCards } from "../src/normalize.mjs";
import { approveRecord, chunkApprovedRecord, publishApprovedRecord, runToHumanApproval } from "../src/pipeline.mjs";
import { CATALOG_PATH } from "../src/paths.mjs";
import { OfflineFixtureGenerator } from "../src/providers/offline-fixture.mjs";
import { findVerbatimOverlap, runCopyrightQa, runFactualQa, runSafetyQa } from "../src/qa.mjs";
import { HUMAN_REVIEW_CONFIRMATION } from "../src/state-machine.mjs";
import { assertCards, validateCard } from "../src/validation.mjs";

async function fixtureRecord(deckId) {
  const catalog = await readJson(CATALOG_PATH);
  const deck = catalog.decks.find((item) => item.id === deckId);
  return runToHumanApproval({ deck, generator: new OfflineFixtureGenerator() });
}

test("generic Card 정규화 결과가 스키마 규칙을 통과한다", () => {
  const cards = normalizeCards("sample-deck", [
    { front: "  HTTP   상태 코드 ", back: "  응답 결과를 분류한다. ", tags: ["HTTP", "http"], sourceRefs: ["spec-v1"] },
  ]);
  assert.doesNotThrow(() => assertCards(cards));
  assert.equal(cards[0].front, "HTTP 상태 코드");
  assert.deepEqual(cards[0].tags, ["HTTP"]);
  assert.match(cards[0].id, /^sample-deck\.[a-f0-9]{16}$/);
  assert.ok(validateCard({ ...cards[0], unexpected: true }).some((error) => error.includes("허용하지 않는")));
});

test("dedupe는 공백·문장부호·대소문자 차이의 동일 카드를 제거하고 front 충돌을 보고한다", () => {
  const cards = normalizeCards("sample-deck", [
    { front: "HTTP", back: "Protocol", tags: [], sourceRefs: ["s"] },
    { front: " http! ", back: " protocol ", tags: [], sourceRefs: ["s"] },
    { front: "HTTP", back: "다른 설명", tags: [], sourceRefs: ["s"] },
  ]);
  const result = dedupeCards(cards);
  assert.equal(result.removed.length, 1);
  assert.equal(result.conflicts.length, 1);
});

test("금칙표현 QA는 합격 보장과 공식 제휴 오인을 막는다", () => {
  const base = { id: "deck.card", deckId: "deck-id", index: 0, front: "질문", tags: [], difficulty: 2, sourceRefs: ["s"] };
  assert.throws(() => runSafetyQa([{ ...base, back: "이 덱이면 100% 합격합니다." }]), /guaranteed-outcome/);
  assert.throws(() => runSafetyQa([{ ...base, back: "출제기관 공식 인증 자료" }]), /false-official-claim/);
  assert.doesNotThrow(() => runSafetyQa([{ ...base, back: "학습 범위를 요약한 자체 작성 카드다." }]));
});

test("원문복제 휴리스틱은 80자 이상 연속 복제를 차단한다", () => {
  const copied = "이 문장은 저작권이 있는 교재 원문을 흉내 낸 테스트 문자열이며 충분히 길게 반복되어 연속 복제 탐지기가 실제 배포 전에 해당 카드를 차단하는지 확인하기 위한 내용입니다. 여기에 탐지 길이를 넘기기 위한 문장을 더합니다.";
  assert.ok(findVerbatimOverlap(copied, `앞부분 ${copied} 뒷부분`) !== null);
  const card = { id: "deck.card", back: copied };
  assert.throws(() => runCopyrightQa([card], [{ id: "book", text: `앞부분 ${copied} 뒷부분`, allowVerbatim: false }]), /possible-source-copy/);
  assert.doesNotThrow(() => runCopyrightQa([card], [{ id: "licensed", text: copied, allowVerbatim: true }]));
});

test("사실 QA는 revision이 고정된 sourceRef와 placeholder 부재를 요구한다", () => {
  const card = { id: "deck.card", front: "질문", back: "답", sourceRefs: ["source-v1"] };
  assert.doesNotThrow(() => runFactualQa([card], [{ id: "source-v1", uri: "urn:test", revision: "v1" }]));
  assert.throws(() => runFactualQa([{ ...card, back: "확정 필요" }], [{ id: "source-v1", uri: "urn:test", revision: "v1" }]), /unresolved-placeholder/);
  assert.throws(() => runFactualQa([card], []), /unknown-source-ref/);
});

test("P1 offline fixture 2개는 QA 후 사람 승인 대기에서 멈추고 published가 아니다", async () => {
  const history = await fixtureRecord("korean-history-cert-core");
  const itcs = await fixtureRecord("it-cs-interview-terms");
  for (const record of [history, itcs]) {
    assert.equal(record.workflow.state, "awaiting-human-approval");
    assert.equal(record.deck.status, "awaiting-human-approval");
    assert.equal(record.deck.reviewer.status, "pending");
    assert.notEqual(record.deck.status, "published");
    assert.equal(record.qa.safety.passed && record.qa.copyright.passed && record.qa.factual.passed, true);
  }
  assert.equal(history.cards.length, 5);
  assert.equal(itcs.cards.length, 5);
  assert.equal(itcs.dedupe.removed.length, 1);
});

test("사람 확인 토큰·검수자·근거 없이는 approve와 chunk/publish를 할 수 없다", async () => {
  const record = await fixtureRecord("it-cs-interview-terms");
  assert.throws(
    () => approveRecord(
      { ...record, dedupe: { ...record.dedupe, conflicts: [{ leftId: "left", rightId: "right" }] } },
      { reviewer: "검수자", evidence: "review://ticket/1", confirmation: HUMAN_REVIEW_CONFIRMATION },
    ),
    /충돌 카드 1건/,
  );
  assert.throws(() => approveRecord(record, { reviewer: "검수자", evidence: "review://ticket/1", confirmation: "AUTO" }), /확인 토큰/);
  assert.throws(() => chunkApprovedRecord(record), /사람 승인/);
  const output = await mkdtemp(path.join(tmpdir(), "daoewo-publish-refusal-"));
  await assert.rejects(() => publishApprovedRecord(record, output), /사람 승인/);

  const approvedFixture = approveRecord(record, {
    reviewer: "테스트 검수자",
    evidence: "test-evidence://content-review/fixture-only",
    confirmation: HUMAN_REVIEW_CONFIRMATION,
  });
  await assert.rejects(() => publishApprovedRecord(approvedFixture, output), /offline fixture/);
});

test("명시적 사람 승인 상태만 200장 불변 청크와 불변 배포 경로로 전이한다", async () => {
  const record = await fixtureRecord("it-cs-interview-terms");
  const approved = approveRecord(record, {
    reviewer: "테스트 검수자",
    evidence: "test-evidence://content-review/fixture-only",
    confirmation: HUMAN_REVIEW_CONFIRMATION,
    reviewedAt: "2026-07-12T12:00:00.000Z",
  });
  approved.fixtureOnly = false; // 실제 배포 경로 단위 테스트용 synthetic record. fixture 파일 자체는 계속 배포 금지다.
  approved.cards = Array.from({ length: 401 }, (_, index) => ({
    ...approved.cards[index % approved.cards.length],
    id: `${approved.deck.id}.${String(index).padStart(4, "0")}`,
    index,
  }));
  const chunked = chunkApprovedRecord(approved);
  assert.deepEqual(chunked.chunks.map((chunk) => chunk.cards.length), [200, 200, 1]);
  assert.equal(chunked.record.workflow.state, "chunked");

  const output = await mkdtemp(path.join(tmpdir(), "daoewo-publish-test-"));
  const published = await publishApprovedRecord(approved, output);
  assert.equal(published.record.workflow.state, "published");
  const manifest = JSON.parse(await readFile(path.join(published.target, "manifest.json"), "utf8"));
  assert.equal(manifest.chunkCount, 3);
  await assert.rejects(() => publishApprovedRecord(approved, output), /이미 존재/);
});
