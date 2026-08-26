import assert from "node:assert/strict";
import test from "node:test";
import {
  buildJlptCards,
  buildJlptSourceRegistry,
  JLPT_DECK_LEVELS,
  JLPT_SOURCE_FILES,
  JLPT_SOURCE_REF,
  VocabSwipeJlptImporter,
} from "../src/providers/vocab-swipe-jlpt.mjs";

const COMMIT = "e1ba2d5503d1f90ee9d6995c80070b0e2e3152e6";

const deck = {
  id: "japanese-jlpt-n3-n2",
  contentStrategy: "vocab-swipe-import",
  source: { commit: COMMIT, revision: "elzup/jlpt-word-list@master captured by pinned vocab-swipe commit" },
};

function buildDataset() {
  return {
    wordsByLevel: {
      "jlpt-n5": [
        ["会う", "あう", "to meet", "JLPT_N5"],
        ["青", "あお", "blue", "JLPT_N5"],
        ["～回", "～かい", "counter", "JLPT_N5"],
      ],
      "jlpt-n3": [
        ["様々", "さまざま", "various", "JLPT_3"],
        ["共通", "きょうつう", "common", "JLPT_3"],
        ["共通", "きょうつう", "common (dup row)", "JLPT_3"],
      ],
      "jlpt-n2": [
        ["共通", "きょうつう", "common", "JLPT_2"],
        ["就任", "しゅうにん", "assumption of office", "JLPT_2"],
      ],
    },
    enrichmentByLevel: {
      "jlpt-n5": {
        "会う": { meaningKo: "만나다", example: "友だちに会います。", exampleMeaning: "친구를 만납니다.", studyTip: "조사 「に」와 쓴다." },
        "青": { meaningKo: "파랑", example: "青が好きです。", exampleMeaning: "파란색을 좋아합니다." },
      },
      "jlpt-n3": {
        "様々": { meaningKo: "여러 가지", example: "様々な人がいます。", exampleMeaning: "여러 사람이 있습니다." },
        "共通": { meaningKo: "공통(N3판)", example: "共通の趣味があります。", exampleMeaning: "공통 취미가 있습니다." },
      },
      "jlpt-n2": {
        "共通": { meaningKo: "공통(N2판)", example: "共通点が多いです。", exampleMeaning: "공통점이 많습니다." },
        "就任": { meaningKo: "취임", example: "社長に就任しました。", exampleMeaning: "사장에 취임했습니다." },
      },
    },
  };
}

test("덱별 레벨 매핑: N5 맛보기는 n5만, 심화는 n3 다음 n2 순서다", () => {
  assert.deepEqual([...JLPT_DECK_LEVELS["japanese-jlpt-n5-preview"]], ["jlpt-n5"]);
  assert.deepEqual([...JLPT_DECK_LEVELS["japanese-jlpt-n4"]], ["jlpt-n4"]);
  assert.deepEqual([...JLPT_DECK_LEVELS["japanese-jlpt-n3-n2"]], ["jlpt-n3", "jlpt-n2"]);
  assert.deepEqual([...JLPT_DECK_LEVELS["japanese-jlpt-n1"]], ["jlpt-n1"]);
});

test("보강이 있는 표제어만 카드가 되고 카운터·접사류 미보강 행은 건너뛴다", () => {
  const cards = buildJlptCards({ deck, dataset: buildDataset(), levels: ["jlpt-n5"] });

  assert.deepEqual(cards.map((card) => card.front), ["会う", "青"]);
  assert.equal(cards[0].reading, "あう");
  assert.equal(cards[0].back, "만나다");
  assert.equal(cards[0].hint, "조사 「に」와 쓴다.");
  assert.equal(cards[1].hint, undefined);
  assert.deepEqual(cards[0].tags, ["N5", "어휘"]);
  assert.equal(cards[0].difficulty, 1);
});

test("레벨 간·레벨 내 중복 표제어는 첫 등장이 이기고 충돌 카드를 만들지 않는다", () => {
  const cards = buildJlptCards({ deck, dataset: buildDataset(), levels: ["jlpt-n3", "jlpt-n2"] });

  assert.deepEqual(cards.map((card) => card.front), ["様々", "共通", "就任"]);
  const common = cards.find((card) => card.front === "共通");
  assert.equal(common.back, "공통(N3판)");
  assert.deepEqual(common.tags, ["N3", "어휘"]);
  assert.equal(common.difficulty, 3);
  assert.equal(cards.find((card) => card.front === "就任").difficulty, 4);
});

test("보강 필드나 읽기가 비면 빈 칸 카드를 만들지 않고 실패한다", () => {
  const missingMeaning = buildDataset();
  missingMeaning.enrichmentByLevel["jlpt-n3"]["様々"].meaningKo = " ";
  assert.throws(() => buildJlptCards({ deck, dataset: missingMeaning, levels: ["jlpt-n3"] }), /meaningKo/);

  const missingExample = buildDataset();
  delete missingExample.enrichmentByLevel["jlpt-n3"]["様々"].example;
  assert.throws(() => buildJlptCards({ deck, dataset: missingExample, levels: ["jlpt-n3"] }), /example/);

  const missingReading = buildDataset();
  missingReading.wordsByLevel["jlpt-n3"][0] = ["様々", "", "various", "JLPT_3"];
  assert.throws(() => buildJlptCards({ deck, dataset: missingReading, levels: ["jlpt-n3"] }), /읽기/);
});

test("레벨 누락, 잘못된 행 형식, 빈 교집합은 거부한다", () => {
  const dataset = buildDataset();
  assert.throws(() => buildJlptCards({ deck, dataset, levels: ["jlpt-n1"] }), /표제어 목록이 없다/);

  const malformed = buildDataset();
  malformed.wordsByLevel["jlpt-n3"][0] = ["様々", "さまざま"];
  assert.throws(() => buildJlptCards({ deck, dataset: malformed, levels: ["jlpt-n3"] }), /행 형식/);

  const emptyIntersection = buildDataset();
  emptyIntersection.enrichmentByLevel["jlpt-n3"] = {};
  emptyIntersection.enrichmentByLevel["jlpt-n2"] = {};
  assert.throws(
    () => buildJlptCards({ deck, dataset: emptyIntersection, levels: ["jlpt-n3", "jlpt-n2"] }),
    /교집합이 비어 있어/,
  );
});

test("source registry는 MIT 표제어와 자체 보강을 분리해 pin과 digest를 남긴다", () => {
  const digests = Object.fromEntries(JLPT_SOURCE_FILES.map((file) => [file, `sha256:${"a".repeat(64)}`]));
  const registry = buildJlptSourceRegistry({
    commit: COMMIT,
    fileRevision: "elzup/jlpt-word-list@master",
    digests,
    sourceUrl: "https://github.com/elzup/jlpt-word-list",
  });

  assert.deepEqual(registry.map((entry) => entry.id).sort(), Object.values(JLPT_SOURCE_REF).sort());
  const headword = registry.find((entry) => entry.id === JLPT_SOURCE_REF.headword);
  const enrichment = registry.find((entry) => entry.id === JLPT_SOURCE_REF.koreanEnrichment);
  assert.equal(headword.licenseId, "MIT");
  assert.equal(enrichment.licenseId, "LicenseRef-Seorilabs-Self-Authored");
  for (const entry of registry) {
    assert.ok(entry.revision.includes(COMMIT), `${entry.id} revision commit pin`);
    assert.ok(entry.fileSha256.startsWith("sha256:"), `${entry.id} digest`);
  }
});

test("importer는 지원하지 않는 덱과 잘못된 전략을 거부한다", async () => {
  const importer = new VocabSwipeJlptImporter({ sourceRoot: "/tmp/does-not-matter" });

  await assert.rejects(
    () => importer.generate({ deck: { ...deck, contentStrategy: "ai-assisted-operator-batch" } }),
    /vocab-swipe-import 덱이 아니다/,
  );
  await assert.rejects(() => importer.generate({ deck: { ...deck, id: "korean-vocabulary" } }), /지원하지 않는 덱/);
  assert.throws(() => new VocabSwipeJlptImporter({ sourceRoot: " " }), /--source-root/);
});
