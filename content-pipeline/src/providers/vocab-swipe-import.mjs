import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DATA_DIR = path.join("packages", "product-core", "src", "data");

const WORD_LIST_FILE = "toeic-word-list.generated.ts";
const GLOSS_FILE = "toeic-korean-glosses.ts";
const ENRICHMENT_FILE = "toeic-self-authored-enrichment.ts";

export const TOEIC_SOURCE_FILES = [WORD_LIST_FILE, GLOSS_FILE, ENRICHMENT_FILE];

/** TSL 1.2 전체 목록은 1,250행이고 rank는 1부터 빈틈없이 증가한다. */
export const TOEIC_TOTAL_ROWS = 1250;

/**
 * 덱별 rank 구간. 입문 덱은 TSL 정의·품사·예문이 함께 담긴 상위 300행이고,
 * 심화 덱은 자체 보강으로 채운 나머지 950행이다. 구간은 겹치지 않는다.
 */
export const TOEIC_DECK_RANGES = Object.freeze({
  "english-essential-intro": Object.freeze({ fromRank: 1, toRank: 300 }),
  "english-toeic-advanced": Object.freeze({ fromRank: 301, toRank: TOEIC_TOTAL_ROWS }),
});

export const SOURCE_REF = Object.freeze({
  tslHeadword: "vocab-swipe-toeic-tsl-headword",
  tslDefinition: "vocab-swipe-toeic-tsl-definition",
  wordnetExample: "vocab-swipe-toeic-wordnet-example",
  koreanGloss: "seorilabs-toeic-korean-gloss",
  selfAuthoredEnrichment: "seorilabs-toeic-self-authored-enrichment",
});

const PART_OF_SPEECH_KO = Object.freeze({
  noun: "명사",
  verb: "동사",
  adjective: "형용사",
  adverb: "부사",
  word: "기타",
});

const FREQUENCY_BAND_SIZE = 250;

const COMMIT_PATTERN = /^[a-f0-9]{40}$/;

/** rank 1~1250을 250행 단위로 나눈 1~5 난이도. 빈도 순위가 낮을수록 어렵게 본다. */
export function difficultyForRank(rank) {
  return Math.min(5, Math.max(1, Math.ceil(rank / FREQUENCY_BAND_SIZE)));
}

export function frequencyBandLabel(rank) {
  const bandIndex = Math.min(Math.ceil(rank / FREQUENCY_BAND_SIZE), TOEIC_TOTAL_ROWS / FREQUENCY_BAND_SIZE);
  const low = (bandIndex - 1) * FREQUENCY_BAND_SIZE + 1;
  const high = bandIndex * FREQUENCY_BAND_SIZE;
  return `빈출 ${low}~${high}위`;
}

export function assertCommitPin(actualCommit, expectedCommit) {
  if (!COMMIT_PATTERN.test(expectedCommit ?? "")) {
    throw new Error("manifest의 source.commit이 40자리 SHA가 아니라 import를 진행할 수 없다.");
  }
  if (actualCommit !== expectedCommit) {
    throw new Error(
      `vocab-swipe checkout commit이 manifest pin과 다르다. 기대: ${expectedCommit}, 실제: ${actualCommit ?? "unknown"}`,
    );
  }
  return expectedCommit;
}

function requireField(value, deckId, word, field) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length === 0) {
    throw new Error(`${deckId}: 표제어 ${word}의 ${field}가 비어 있어 카드로 만들 수 없다.`);
  }
  return text;
}

/**
 * 한 행의 최종 예문과 그 출처 성분을 결정한다. 자체 보강이 예문을 덮어쓰면 출처는
 * 언제나 자체 작성이고, 덮어쓰지 않으면 생성 목록이 선언한 출처를 그대로 따른다.
 */
export function resolveExample(generatedExample, generatedExampleSource, enrichmentExample) {
  if (typeof enrichmentExample === "string" && enrichmentExample.trim().length > 0) {
    return { example: enrichmentExample.trim(), exampleSource: "self-authored" };
  }
  const example = typeof generatedExample === "string" ? generatedExample.trim() : "";
  if (example.length === 0) return { example: null, exampleSource: null };
  if (generatedExampleSource !== "wordnet-3.0" && generatedExampleSource !== "self-authored") {
    throw new Error(`알 수 없는 예문 출처: ${generatedExampleSource}`);
  }
  return { example, exampleSource: generatedExampleSource };
}

/**
 * vocab-swipe TOEIC 자산을 generic Card raw 행으로 매핑한다. 라이선스 성분별로
 * sourceRefs를 나눠 기록해 CC BY-SA / WordNet / 자체 작성 성분이 섞이지 않게 한다.
 */
export function buildToeicCards({ deck, dataset, range }) {
  const { words, glosses, enrichment } = dataset;

  if (!Array.isArray(words) || words.length !== TOEIC_TOTAL_ROWS) {
    throw new Error(`TOEIC 목록이 ${TOEIC_TOTAL_ROWS}행이 아니다: ${Array.isArray(words) ? words.length : "non-array"}`);
  }
  words.forEach((row, index) => {
    if (row[1] !== index + 1) throw new Error(`TOEIC 목록 rank가 연속하지 않는다: index ${index}, rank ${row[1]}`);
  });

  const selected = words.filter((row) => row[1] >= range.fromRank && row[1] <= range.toRank);
  if (selected.length !== range.toRank - range.fromRank + 1) {
    throw new Error(`${deck.id}: rank ${range.fromRank}~${range.toRank} 구간 행 수가 기대와 다르다.`);
  }

  return selected.map((row) => {
    const [word, rank, , , definition, generatedPartOfSpeech, generatedExample, generatedExampleSource] = row;
    const headword = requireField(word, deck.id, word, "표제어");
    const enriched = enrichment[word];
    if (enriched === undefined) throw new Error(`${deck.id}: 표제어 ${word}의 자체 보강 항목이 없다.`);

    const gloss = requireField(glosses[word], deck.id, word, "한국어 뜻");
    const exampleMeaning = requireField(enriched.exampleMeaning, deck.id, word, "예문 번역");
    const partOfSpeech = generatedPartOfSpeech ?? enriched.partOfSpeech;
    const partOfSpeechKo = PART_OF_SPEECH_KO[partOfSpeech];
    if (partOfSpeechKo === undefined) throw new Error(`${deck.id}: 표제어 ${word}의 품사를 알 수 없다: ${partOfSpeech}`);

    const { example, exampleSource } = resolveExample(generatedExample, generatedExampleSource, enriched.example);
    if (example === null) throw new Error(`${deck.id}: 표제어 ${word}의 예문이 없다.`);

    // 표제어와 빈도는 TSL, 한국어 뜻은 자체 작성, 예문 번역은 자체 보강에서 온다.
    const sourceRefs = [SOURCE_REF.tslHeadword, SOURCE_REF.koreanGloss, SOURCE_REF.selfAuthoredEnrichment];
    const card = {
      front: headword,
      back: gloss,
      example,
      exampleMeaning,
      tags: [partOfSpeechKo, frequencyBandLabel(rank)],
      difficulty: difficultyForRank(rank),
      sourceRefs,
    };

    if (typeof definition === "string" && definition.trim().length > 0) {
      card.hint = definition.trim();
      sourceRefs.push(SOURCE_REF.tslDefinition);
    }
    if (exampleSource === "wordnet-3.0") sourceRefs.push(SOURCE_REF.wordnetExample);

    return card;
  });
}

export function buildSourceRegistry({ commit, revision, enrichmentRevision, digests, urls }) {
  const pin = `vocab-swipe@${commit}`;
  return [
    {
      id: SOURCE_REF.tslHeadword,
      kind: "external-dataset",
      uri: urls.sourceUrl,
      revision: `${revision} via ${pin}`,
      licenseId: "CC-BY-SA-4.0",
      fileSha256: digests[WORD_LIST_FILE],
    },
    {
      id: SOURCE_REF.tslDefinition,
      kind: "external-dataset",
      uri: urls.definitionsUrl,
      revision: `${revision} via ${pin}`,
      licenseId: "CC-BY-SA-4.0",
      fileSha256: digests[WORD_LIST_FILE],
    },
    {
      id: SOURCE_REF.wordnetExample,
      kind: "external-dataset",
      uri: urls.wordnetUrl,
      revision: `WordNet-3.0 via ${pin}`,
      licenseId: "WordNet-3.0",
      fileSha256: digests[WORD_LIST_FILE],
    },
    {
      id: SOURCE_REF.koreanGloss,
      kind: "seorilabs-self-authored",
      uri: "urn:daoewo:content-policy:v1",
      revision: `${pin}:${GLOSS_FILE}`,
      licenseId: "LicenseRef-Seorilabs-Self-Authored",
      fileSha256: digests[GLOSS_FILE],
    },
    {
      id: SOURCE_REF.selfAuthoredEnrichment,
      kind: "seorilabs-self-authored",
      uri: "urn:daoewo:content-policy:v1",
      revision: `${enrichmentRevision} via ${pin}`,
      licenseId: "LicenseRef-Seorilabs-Self-Authored",
      fileSha256: digests[ENRICHMENT_FILE],
    },
  ];
}

async function readCommit(sourceRoot) {
  try {
    const { stdout } = await execFileAsync("git", ["-C", sourceRoot, "rev-parse", "HEAD"]);
    return stdout.trim();
  } catch {
    throw new Error(
      `vocab-swipe source root의 git commit을 읽을 수 없다: ${sourceRoot}. import는 commit이 고정된 checkout에서만 가능하다.`,
    );
  }
}

/**
 * revision이 고정된 vocab-swipe checkout에서 TOEIC 어휘 덱을 가져온다.
 * 네트워크로 upstream을 새로 fetch하지 않고 이미 검증된 snapshot bytes만 읽는다.
 */
export class VocabSwipeToeicImporter {
  constructor({ sourceRoot }) {
    if (typeof sourceRoot !== "string" || sourceRoot.trim().length === 0) {
      throw new Error("vocab-swipe checkout 경로(--source-root)가 필요하다.");
    }
    this.name = "vocab-swipe-import-v1";
    this.sourceRoot = path.resolve(sourceRoot);
  }

  async generate({ deck }) {
    if (deck.contentStrategy !== "vocab-swipe-import") {
      throw new Error(`${deck.id}는 vocab-swipe-import 덱이 아니다.`);
    }
    const range = TOEIC_DECK_RANGES[deck.id];
    if (range === undefined) {
      throw new Error(`vocab-swipe TOEIC importer가 아직 지원하지 않는 덱이다: ${deck.id}`);
    }

    const commit = await readCommit(this.sourceRoot);
    assertCommitPin(commit, deck.source.commit);

    const dataDir = path.join(this.sourceRoot, DATA_DIR);
    const digests = {};
    for (const fileName of TOEIC_SOURCE_FILES) {
      const bytes = await readFile(path.join(dataDir, fileName));
      digests[fileName] = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    }

    const wordList = await import(path.join(dataDir, WORD_LIST_FILE));
    const glossModule = await import(path.join(dataDir, GLOSS_FILE));
    const enrichmentModule = await import(path.join(dataDir, ENRICHMENT_FILE));

    const revision = wordList.BUNDLED_TOEIC_REVISION;
    if (revision !== deck.source.revision) {
      throw new Error(`vocab-swipe 생성 헤더 revision이 manifest pin과 다르다. 기대: ${deck.source.revision}, 실제: ${revision}`);
    }

    const cards = buildToeicCards({
      deck,
      range,
      dataset: {
        words: wordList.BUNDLED_TOEIC_WORDS,
        glosses: glossModule.BUNDLED_TOEIC_KOREAN_GLOSSES,
        enrichment: enrichmentModule.BUNDLED_TOEIC_SELF_AUTHORED_ENRICHMENT,
      },
    });

    return {
      schemaVersion: 1,
      deckId: deck.id,
      generator: this.name,
      sourceRegistry: buildSourceRegistry({
        commit,
        revision,
        enrichmentRevision: enrichmentModule.BUNDLED_TOEIC_SELF_AUTHORED_ENRICHMENT_REVISION,
        digests,
        urls: {
          sourceUrl: wordList.BUNDLED_TOEIC_SOURCE_URL,
          definitionsUrl: wordList.BUNDLED_TOEIC_DEFINITIONS_URL,
          wordnetUrl: wordList.BUNDLED_TOEIC_WORDNET_URL,
        },
      }),
      referenceTexts: [],
      cards,
    };
  }
}
