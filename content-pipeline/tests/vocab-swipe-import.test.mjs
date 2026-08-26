import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCommitPin,
  buildSourceRegistry,
  buildToeicCards,
  difficultyForRank,
  frequencyBandLabel,
  resolveExample,
  SOURCE_REF,
  TOEIC_DECK_RANGES,
  TOEIC_SOURCE_FILES,
  TOEIC_TOTAL_ROWS,
  VocabSwipeToeicImporter,
} from "../src/providers/vocab-swipe-import.mjs";

const COMMIT = "e1ba2d5503d1f90ee9d6995c80070b0e2e3152e6";

const deck = {
  id: "english-essential-intro",
  contentStrategy: "vocab-swipe-import",
  source: { commit: COMMIT, revision: "rev-1" },
};

/** rank 1~300은 TSL 정의·품사·예문이 있고 301행부터는 자체 보강만 있는 실제 자산 모양을 흉내낸다. */
function buildDataset(overrides = {}) {
  const words = [];
  const glosses = {};
  const enrichment = {};
  for (let rank = 1; rank <= TOEIC_TOTAL_ROWS; rank += 1) {
    const word = `word${rank}`;
    const enriched = rank <= 300;
    words.push([
      word,
      rank,
      50,
      100,
      enriched ? `definition ${rank}` : undefined,
      enriched ? "noun" : undefined,
      enriched ? `generated example ${rank}` : undefined,
      enriched && rank % 2 === 0 ? "wordnet-3.0" : enriched ? "self-authored" : undefined,
    ]);
    glosses[word] = `뜻 ${rank}`;
    enrichment[word] = enriched
      ? { exampleMeaning: `번역 ${rank}` }
      : { partOfSpeech: "verb", example: `self example ${rank}`, exampleMeaning: `번역 ${rank}` };
  }
  return { words, glosses, enrichment, ...overrides };
}

test("입문·심화 rank 구간은 겹치지 않고 TSL 전체 목록을 덮는다", () => {
  const intro = TOEIC_DECK_RANGES["english-essential-intro"];
  const advanced = TOEIC_DECK_RANGES["english-toeic-advanced"];
  assert.equal(intro.fromRank, 1);
  assert.equal(advanced.fromRank, intro.toRank + 1);
  assert.equal(advanced.toRank, TOEIC_TOTAL_ROWS);
});

test("입문 덱은 TSL 정의가 있는 상위 구간만 카드로 만든다", () => {
  const cards = buildToeicCards({ deck, dataset: buildDataset(), range: TOEIC_DECK_RANGES["english-essential-intro"] });

  assert.equal(cards.length, 300);
  assert.equal(cards[0].front, "word1");
  assert.equal(cards[0].back, "뜻 1");
  assert.equal(cards[0].hint, "definition 1");
  assert.equal(cards[0].exampleMeaning, "번역 1");
  assert.deepEqual(cards[0].tags, ["명사", "빈출 1~250위"]);
  assert.equal(cards.at(-1).front, "word300");
});

test("심화 덱은 자체 보강 품사·예문으로 나머지 구간을 채운다", () => {
  const cards = buildToeicCards({ deck, dataset: buildDataset(), range: TOEIC_DECK_RANGES["english-toeic-advanced"] });

  assert.equal(cards.length, 950);
  assert.equal(cards[0].front, "word301");
  assert.equal(cards[0].example, "self example 301");
  assert.equal(cards[0].hint, undefined);
  assert.deepEqual(cards[0].tags, ["동사", "빈출 251~500위"]);
});

test("카드 sourceRefs는 실제로 쓴 라이선스 성분만 가리킨다", () => {
  const cards = buildToeicCards({ deck, dataset: buildDataset(), range: TOEIC_DECK_RANGES["english-essential-intro"] });

  const wordnetCard = cards.find((card) => card.front === "word2");
  const selfAuthoredCard = cards.find((card) => card.front === "word1");

  for (const card of cards) {
    assert.ok(card.sourceRefs.includes(SOURCE_REF.tslHeadword));
    assert.ok(card.sourceRefs.includes(SOURCE_REF.koreanGloss));
    assert.ok(card.sourceRefs.includes(SOURCE_REF.selfAuthoredEnrichment));
    assert.ok(card.sourceRefs.includes(SOURCE_REF.tslDefinition));
  }
  assert.ok(wordnetCard.sourceRefs.includes(SOURCE_REF.wordnetExample));
  assert.ok(!selfAuthoredCard.sourceRefs.includes(SOURCE_REF.wordnetExample));

  const advanced = buildToeicCards({ deck, dataset: buildDataset(), range: TOEIC_DECK_RANGES["english-toeic-advanced"] });
  for (const card of advanced) {
    assert.ok(!card.sourceRefs.includes(SOURCE_REF.tslDefinition));
    assert.ok(!card.sourceRefs.includes(SOURCE_REF.wordnetExample));
  }
});

test("자체 보강이 예문을 덮어쓰면 출처는 WordNet이 아니라 자체 작성이다", () => {
  assert.deepEqual(resolveExample("wordnet sentence", "wordnet-3.0", "our own sentence"), {
    example: "our own sentence",
    exampleSource: "self-authored",
  });
  assert.deepEqual(resolveExample("wordnet sentence", "wordnet-3.0", undefined), {
    example: "wordnet sentence",
    exampleSource: "wordnet-3.0",
  });
  assert.deepEqual(resolveExample("", undefined, undefined), { example: null, exampleSource: null });
  assert.throws(() => resolveExample("sentence", "unknown-corpus", undefined), /알 수 없는 예문 출처/);
});

test("자체 보강이 예문을 덮어쓴 카드는 WordNet 성분을 표시하지 않는다", () => {
  const dataset = buildDataset();
  dataset.enrichment.word2 = { exampleMeaning: "번역 2", example: "자체 작성 예문" };
  const cards = buildToeicCards({ deck, dataset, range: TOEIC_DECK_RANGES["english-essential-intro"] });
  const card = cards.find((candidate) => candidate.front === "word2");

  assert.equal(card.example, "자체 작성 예문");
  assert.ok(!card.sourceRefs.includes(SOURCE_REF.wordnetExample));
});

test("난이도와 빈출 구간은 rank에서 결정적으로 나온다", () => {
  assert.equal(difficultyForRank(1), 1);
  assert.equal(difficultyForRank(250), 1);
  assert.equal(difficultyForRank(251), 2);
  assert.equal(difficultyForRank(1250), 5);
  assert.equal(frequencyBandLabel(1), "빈출 1~250위");
  assert.equal(frequencyBandLabel(1250), "빈출 1001~1250위");
});

test("빠진 뜻·보강·예문은 조용히 넘어가지 않고 실패한다", () => {
  const range = TOEIC_DECK_RANGES["english-essential-intro"];

  const withoutGloss = buildDataset();
  delete withoutGloss.glosses.word5;
  assert.throws(() => buildToeicCards({ deck, dataset: withoutGloss, range }), /word5의 한국어 뜻/);

  const withoutEnrichment = buildDataset();
  delete withoutEnrichment.enrichment.word5;
  assert.throws(() => buildToeicCards({ deck, dataset: withoutEnrichment, range }), /자체 보강 항목이 없다/);

  const withoutExample = buildDataset();
  withoutExample.words[4] = ["word5", 5, 50, 100, "definition 5", "noun", undefined, undefined];
  assert.throws(() => buildToeicCards({ deck, dataset: withoutExample, range }), /예문이 없다/);

  const withoutPartOfSpeech = buildDataset();
  withoutPartOfSpeech.enrichment.word400 = { exampleMeaning: "번역", example: "example" };
  assert.throws(
    () => buildToeicCards({ deck, dataset: withoutPartOfSpeech, range: TOEIC_DECK_RANGES["english-toeic-advanced"] }),
    /품사를 알 수 없다/,
  );
});

test("행 수나 rank 연속성이 깨진 목록은 거부한다", () => {
  const range = TOEIC_DECK_RANGES["english-essential-intro"];

  const short = buildDataset();
  short.words = short.words.slice(0, 100);
  assert.throws(() => buildToeicCards({ deck, dataset: short, range }), /1250행이 아니다/);

  const shuffled = buildDataset();
  shuffled.words[10] = [...shuffled.words[10]];
  shuffled.words[10][1] = 999;
  assert.throws(() => buildToeicCards({ deck, dataset: shuffled, range }), /rank가 연속하지 않는다/);
});

test("commit pin이 다르면 import를 시작하지 않는다", () => {
  assert.equal(assertCommitPin(COMMIT, COMMIT), COMMIT);
  assert.throws(() => assertCommitPin("0".repeat(40), COMMIT), /manifest pin과 다르다/);
  assert.throws(() => assertCommitPin(COMMIT, "main"), /40자리 SHA가 아니라/);
});

test("source registry는 카드가 가리키는 모든 성분에 uri와 revision pin을 남긴다", () => {
  const digests = Object.fromEntries(TOEIC_SOURCE_FILES.map((file) => [file, `sha256:${"a".repeat(64)}`]));
  const registry = buildSourceRegistry({
    commit: COMMIT,
    revision: "rev-1",
    enrichmentRevision: "self-authored-ko-enrichment-v1",
    digests,
    urls: { sourceUrl: "https://example.test/toeic", definitionsUrl: "https://example.test/tsl", wordnetUrl: "https://example.test/wordnet" },
  });

  assert.deepEqual(
    registry.map((entry) => entry.id).sort(),
    Object.values(SOURCE_REF).sort(),
  );
  for (const entry of registry) {
    assert.ok(entry.uri.length > 0, `${entry.id} uri`);
    assert.ok(entry.revision.includes(COMMIT), `${entry.id} revision commit pin`);
    assert.ok(entry.fileSha256.startsWith("sha256:"), `${entry.id} file digest`);
  }
});

test("importer는 지원하지 않는 덱과 잘못된 전략을 거부한다", async () => {
  const importer = new VocabSwipeToeicImporter({ sourceRoot: "/tmp/does-not-matter" });

  await assert.rejects(
    () => importer.generate({ deck: { ...deck, contentStrategy: "ai-assisted-operator-batch" } }),
    /vocab-swipe-import 덱이 아니다/,
  );
  await assert.rejects(() => importer.generate({ deck: { ...deck, id: "korean-vocabulary" } }), /지원하지 않는 덱/);
  assert.throws(() => new VocabSwipeToeicImporter({ sourceRoot: "" }), /--source-root/);
});
