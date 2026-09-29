import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { readJson } from "../src/io.mjs";
import { runToHumanApproval } from "../src/pipeline.mjs";
import { CATALOG_PATH } from "../src/paths.mjs";
import {
  VOCAB_SWIPE_COMMIT,
  VOCAB_SWIPE_COMMITTED_AT,
  VOCAB_SWIPE_DECK_IDS,
  VOCAB_SWIPE_INPUT_FILES,
  VocabSwipeSnapshotGenerator,
  parseExportedDataLiteral,
} from "../src/providers/vocab-swipe.mjs";

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function exported(name, value, prefix = "") {
  return Buffer.from(`${prefix}export const ${name}: unknown = ${JSON.stringify(value)};\n`, "utf8");
}

function jlptLevel(prefix, count, overrides = new Map()) {
  const words = Array.from({ length: count }, (_, index) => overrides.get(index) ?? `${prefix}-${String(index + 1).padStart(4, "0")}`);
  return {
    words,
    rows: words.map((word, index) => [word, `${prefix}-reading-${index + 1}`, `${prefix} english ${index + 1}`, "JLPT"]),
    enrichment: Object.fromEntries(words.map((word, index) => [word, {
      meaningKo: `${prefix} 뜻 ${index + 1}`,
      example: `${word} 예문입니다.`,
      exampleMeaning: `${word} 예문 번역입니다.`,
      ...(index % 2 === 0 ? { studyTip: `${word} 학습 팁` } : {}),
    }])),
  };
}

function syntheticSnapshot() {
  const toeicRows = Array.from({ length: 1_250 }, (_, index) => {
    const rank = index + 1;
    return [`word-${String(rank).padStart(4, "0")}`, rank, 60, 100];
  });
  const toeicGlosses = Object.fromEntries(toeicRows.map(([word], index) => [word, `뜻 ${index + 1}`]));
  const toeicEnrichment = Object.fromEntries(toeicRows.map(([word], index) => [word, {
    partOfSpeech: "noun",
    example: `${word} appears in this original example.`,
    exampleMeaning: `${word} 자체 예문 번역 ${index + 1}`,
  }]));

  const n5 = jlptLevel("n5", 525, new Map([[0, "会う"], [239, "石鹸"]]));
  const n3 = jlptLevel("n3", 1_462, new Map([[100, "故郷"]]));
  const n2 = jlptLevel("n2", 1_227, new Map([[200, "故郷"]]));
  const jlptWords = {
    "jlpt-n5": [...n5.rows, n5.rows[0], ["N5 enrichment 없음", "よみ", "missing", "JLPT"]],
    "jlpt-n3": [...n3.rows, n3.rows[0]],
    "jlpt-n2": [...n2.rows, n2.rows[0]],
  };
  const jlptEnrichment = {
    "jlpt-n5": n5.enrichment,
    "jlpt-n3": n3.enrichment,
    "jlpt-n2": n2.enrichment,
  };

  const fileBytes = {
    toeicWords: exported("BUNDLED_TOEIC_WORDS", toeicRows),
    toeicGlosses: exported("BUNDLED_TOEIC_KOREAN_GLOSSES", toeicGlosses),
    toeicEnrichment: exported(
      "BUNDLED_TOEIC_SELF_AUTHORED_ENRICHMENT",
      toeicEnrichment,
      "export const BUNDLED_TOEIC_SELF_AUTHORED_ENRICHMENT_REVISION = 'test-v1';\n",
    ),
    jlptWords: exported("BUNDLED_JLPT_WORDS_BY_LEVEL", jlptWords),
    jlptEnrichment: exported("JLPT_KOREAN_ENRICHMENT", jlptEnrichment),
  };
  const inputFiles = Object.fromEntries(Object.entries(VOCAB_SWIPE_INPUT_FILES).map(([key, spec]) => [key, {
    ...spec,
    sha256: digest(fileBytes[key]),
  }]));
  return { fileBytes, inputFiles };
}

class MemorySnapshotReader {
  constructor(fileBytes) {
    this.fileBytes = fileBytes;
    this.verifyCalls = 0;
    this.pathToKey = new Map(Object.entries(VOCAB_SWIPE_INPUT_FILES).map(([key, spec]) => [spec.path, key]));
  }

  async verifyCommit(commit, committedAt) {
    assert.equal(commit, VOCAB_SWIPE_COMMIT);
    assert.equal(committedAt, VOCAB_SWIPE_COMMITTED_AT);
    this.verifyCalls += 1;
  }

  async readFile(commit, filePath) {
    assert.equal(commit, VOCAB_SWIPE_COMMIT);
    return this.fileBytes[this.pathToKey.get(filePath)];
  }
}

async function catalogDecks() {
  const catalog = await readJson(CATALOG_PATH);
  return new Map(catalog.decks.map((deck) => [deck.id, deck]));
}

test("data literal parser는 이름 prefix가 있는 export와 실제 대상을 구분한다", () => {
  const source = `export const SAMPLE_REVISION = 'v1';\nexport const SAMPLE: Record<string, string> = { answer: 'ok' };`;
  assert.deepEqual(parseExportedDataLiteral(source, "SAMPLE"), { answer: "ok" });
});

test("pinned snapshot provider는 4덱 수량·순서·필드·故郷 중복 경계를 결정적으로 만든다", async () => {
  const { fileBytes, inputFiles } = syntheticSnapshot();
  const reader = new MemorySnapshotReader(fileBytes);
  const generator = new VocabSwipeSnapshotGenerator({ reader, inputFiles });
  const decks = await catalogDecks();
  const expectedCounts = {
    "english-essential-intro": 600,
    "english-toeic-advanced": 1_250,
    "japanese-jlpt-n5-preview": 240,
    "japanese-jlpt-n3-n2": 2_688,
  };
  const records = new Map();

  for (const deckId of VOCAB_SWIPE_DECK_IDS) {
    const record = await runToHumanApproval({
      deck: decks.get(deckId),
      generator,
    });
    records.set(deckId, record);
    assert.equal(record.cards.length, expectedCounts[deckId]);
    assert.equal(record.workflow.state, "awaiting-human-approval");
    assert.equal(record.deck.status, "awaiting-human-approval");
    assert.equal(record.deck.reviewer.status, "pending");
    assert.equal(record.fixtureOnly, false);
    assert.equal(record.dedupe.removed.length, 0);
    assert.ok(record.sourceRegistry.some((source) => source.id === "vocab-swipe-pinned-repository" && source.commit === VOCAB_SWIPE_COMMIT));
    for (const source of record.sourceRegistry.filter((entry) => entry.kind === "git-blob")) {
      assert.match(source.sha256, /^sha256:[a-f0-9]{64}$/);
      assert.ok(source.licenses.length > 0);
      assert.match(source.revision, new RegExp(VOCAB_SWIPE_COMMIT));
    }
  }

  assert.equal(reader.verifyCalls, 1, "한 batch의 동일 snapshot은 한 번만 검증한다.");
  const intro = records.get("english-essential-intro");
  const advanced = records.get("english-toeic-advanced");
  assert.equal(intro.cards[0].front, "word-0001");
  assert.equal(intro.cards.at(-1).front, "word-0600");
  assert.equal(intro.cards.at(-1).difficulty, 3);
  assert.equal(advanced.cards.at(-1).front, "word-1250");
  assert.equal(advanced.cards.at(-1).difficulty, 5);
  assert.deepEqual(
    intro.cards.map((card) => [card.front, card.back]),
    advanced.cards.slice(0, 600).map((card) => [card.front, card.back]),
  );
  assert.notEqual(intro.cards[0].id, advanced.cards[0].id, "deckId가 다르면 중복 어휘도 별도 안정 ID를 갖는다.");

  const n5 = records.get("japanese-jlpt-n5-preview");
  assert.equal(n5.cards[0].front, "会う");
  assert.equal(n5.cards.at(-1).front, "石鹸");
  const n3n2 = records.get("japanese-jlpt-n3-n2");
  assert.equal(n3n2.cards.filter((card) => card.front === "故郷").length, 1);
  assert.ok(n3n2.cards.find((card) => card.front === "故郷").tags.includes("N3"));

  const second = await runToHumanApproval({
    deck: decks.get("english-essential-intro"),
    generator,
  });
  assert.equal(second.deck.provenance.inputDigest, intro.deck.provenance.inputDigest);
  assert.deepEqual(second.cards, intro.cards);
});

test("입력 blob SHA-256이 다르면 snapshot import를 즉시 거부한다", async () => {
  const { fileBytes, inputFiles } = syntheticSnapshot();
  const corrupted = { ...fileBytes, toeicWords: Buffer.concat([fileBytes.toeicWords, Buffer.from("// changed\n")]) };
  const generator = new VocabSwipeSnapshotGenerator({ reader: new MemorySnapshotReader(corrupted), inputFiles });
  const decks = await catalogDecks();
  await assert.rejects(() => generator.generate({ deck: decks.get("english-essential-intro") }), /SHA-256 불일치/);
});
