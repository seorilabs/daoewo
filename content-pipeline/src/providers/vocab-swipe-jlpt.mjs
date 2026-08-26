import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertCommitPin } from "./vocab-swipe-import.mjs";

const DATA_DIR = path.join("packages", "product-core", "src", "data");

const WORD_LIST_FILE = "jlpt-word-list.generated.ts";
const ENRICHMENT_FILE = "jlpt-korean-enrichment.generated.ts";

export const JLPT_SOURCE_FILES = [WORD_LIST_FILE, ENRICHMENT_FILE];

/**
 * 덱별 JLPT 레벨. N3~N2 덱은 N3를 먼저 순회하므로 두 레벨에 모두 있는 표제어는
 * N3 항목이 이긴다(결정적 first-wins).
 */
export const JLPT_DECK_LEVELS = Object.freeze({
  "japanese-jlpt-n5-preview": Object.freeze(["jlpt-n5"]),
  "japanese-jlpt-n3-n2": Object.freeze(["jlpt-n3", "jlpt-n2"]),
});

const LEVEL_LABEL = Object.freeze({
  "jlpt-n1": "N1",
  "jlpt-n2": "N2",
  "jlpt-n3": "N3",
  "jlpt-n4": "N4",
  "jlpt-n5": "N5",
});

/** 레벨이 어려울수록 난이도가 높다: N5=1 … N1=5. */
const LEVEL_DIFFICULTY = Object.freeze({
  "jlpt-n5": 1,
  "jlpt-n4": 2,
  "jlpt-n3": 3,
  "jlpt-n2": 4,
  "jlpt-n1": 5,
});

export const JLPT_SOURCE_REF = Object.freeze({
  headword: "vocab-swipe-jlpt-headword",
  koreanEnrichment: "seorilabs-jlpt-korean-enrichment",
});

/**
 * JLPT generated 파일은 값 위치에서 `import { JlptLevelCode } from '../domain/types'`를
 * 쓰기 때문에 Node의 타입 스트리핑만으로는 로드할 수 없다. 그 import 한 줄을 로컬 타입
 * 별칭으로 치환한 사본을 임시 경로에서 import한다. 치환은 파일 bytes의 순수 함수라
 * 결정성이 유지되고, digest는 원본 bytes로 계산한다.
 */
async function importWithTypeAliasShim(filePath) {
  const source = await readFile(filePath, "utf8");
  const shimmed = source.replace(
    /import\s*\{\s*JlptLevelCode\s*\}\s*from\s*'[^']*';/,
    "type JlptLevelCode = string;",
  );
  if (shimmed === source) {
    throw new Error(`예상한 JlptLevelCode import를 찾지 못했다: ${filePath}`);
  }
  const workDir = await mkdtemp(path.join(tmpdir(), "daoewo-jlpt-shim-"));
  const shimPath = path.join(workDir, path.basename(filePath));
  await writeFile(shimPath, shimmed);
  try {
    return await import(pathToFileURL(shimPath).href);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function requireEnrichmentField(value, deckId, word, field) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length === 0) {
    throw new Error(`${deckId}: 표제어 ${word}의 보강 ${field}가 비어 있어 카드로 만들 수 없다.`);
  }
  return text;
}

/**
 * 레벨별 표제어 목록과 한국어 보강의 교집합을 generic Card raw 행으로 매핑한다.
 * 보강이 없는 행은 의도된 제외(카운터·접사·중복 이표기)이므로 조용히 건너뛰고,
 * 보강이 있는데 필드가 비면 실패한다. 같은 표제어는 첫 등장 레벨·행이 이긴다.
 */
export function buildJlptCards({ deck, dataset, levels }) {
  const { wordsByLevel, enrichmentByLevel } = dataset;
  const cards = [];
  const taken = new Set();

  for (const level of levels) {
    const rows = wordsByLevel[level];
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error(`${deck.id}: 레벨 ${level}의 표제어 목록이 없다.`);
    }
    const enrichment = enrichmentByLevel[level] ?? {};
    const levelLabel = LEVEL_LABEL[level];
    const difficulty = LEVEL_DIFFICULTY[level];
    if (levelLabel === undefined || difficulty === undefined) {
      throw new Error(`${deck.id}: 알 수 없는 JLPT 레벨: ${level}`);
    }

    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 4 || row.slice(0, 4).some((cell) => typeof cell !== "string")) {
        throw new Error(`${deck.id}: 레벨 ${level}의 표제어 행 형식이 올바르지 않다: ${JSON.stringify(row)}`);
      }
      const [word, reading] = row;
      const enriched = enrichment[word];
      if (enriched === undefined) continue;
      if (taken.has(word)) continue;
      taken.add(word);

      const card = {
        front: word,
        reading: requireEnrichmentField(reading, deck.id, word, "읽기"),
        back: requireEnrichmentField(enriched.meaningKo, deck.id, word, "meaningKo"),
        example: requireEnrichmentField(enriched.example, deck.id, word, "example"),
        exampleMeaning: requireEnrichmentField(enriched.exampleMeaning, deck.id, word, "exampleMeaning"),
        tags: [levelLabel, "어휘"],
        difficulty,
        sourceRefs: [JLPT_SOURCE_REF.headword, JLPT_SOURCE_REF.koreanEnrichment],
      };
      if (typeof enriched.studyTip === "string" && enriched.studyTip.trim().length > 0) {
        card.hint = enriched.studyTip.trim();
      }
      cards.push(card);
    }
  }

  if (cards.length === 0) {
    throw new Error(`${deck.id}: 보강 교집합이 비어 있어 카드를 만들 수 없다.`);
  }
  return cards;
}

export function buildJlptSourceRegistry({ commit, fileRevision, digests, sourceUrl }) {
  const pin = `vocab-swipe@${commit}`;
  return [
    {
      id: JLPT_SOURCE_REF.headword,
      kind: "external-dataset",
      uri: sourceUrl,
      revision: `${fileRevision} via ${pin}`,
      licenseId: "MIT",
      fileSha256: digests[WORD_LIST_FILE],
    },
    {
      id: JLPT_SOURCE_REF.koreanEnrichment,
      kind: "seorilabs-self-authored",
      uri: "urn:daoewo:content-policy:v1",
      revision: `${pin}:${ENRICHMENT_FILE}`,
      licenseId: "LicenseRef-Seorilabs-Self-Authored",
      fileSha256: digests[ENRICHMENT_FILE],
    },
  ];
}

async function readCommit(sourceRoot) {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  try {
    const { stdout } = await promisify(execFile)("git", ["-C", sourceRoot, "rev-parse", "HEAD"]);
    return stdout.trim();
  } catch {
    throw new Error(
      `vocab-swipe source root의 git commit을 읽을 수 없다: ${sourceRoot}. import는 commit이 고정된 checkout에서만 가능하다.`,
    );
  }
}

/**
 * revision이 고정된 vocab-swipe checkout에서 JLPT 어휘 덱을 가져온다.
 * MIT 표제어·읽기와 자체 생성 한국어 보강(뜻·예문·번역·학습 팁)의 교집합만 카드가 된다.
 */
export class VocabSwipeJlptImporter {
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
    const levels = JLPT_DECK_LEVELS[deck.id];
    if (levels === undefined) {
      throw new Error(`vocab-swipe JLPT importer가 지원하지 않는 덱이다: ${deck.id}`);
    }

    const commit = await readCommit(this.sourceRoot);
    assertCommitPin(commit, deck.source.commit);

    const dataDir = path.join(this.sourceRoot, DATA_DIR);
    const digests = {};
    for (const fileName of JLPT_SOURCE_FILES) {
      const bytes = await readFile(path.join(dataDir, fileName));
      digests[fileName] = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    }

    const wordList = await importWithTypeAliasShim(path.join(dataDir, WORD_LIST_FILE));
    const enrichmentModule = await importWithTypeAliasShim(path.join(dataDir, ENRICHMENT_FILE));

    const fileRevision = wordList.BUNDLED_JLPT_REVISION;
    if (typeof fileRevision !== "string" || !deck.source.revision.includes(fileRevision)) {
      throw new Error(
        `manifest revision이 생성 헤더 revision을 포함하지 않는다. manifest: ${deck.source.revision}, 헤더: ${fileRevision}`,
      );
    }

    const cards = buildJlptCards({
      deck,
      levels,
      dataset: {
        wordsByLevel: wordList.BUNDLED_JLPT_WORDS_BY_LEVEL,
        enrichmentByLevel: enrichmentModule.JLPT_KOREAN_ENRICHMENT,
      },
    });

    return {
      schemaVersion: 1,
      deckId: deck.id,
      generator: this.name,
      sourceRegistry: buildJlptSourceRegistry({
        commit,
        fileRevision,
        digests,
        sourceUrl: wordList.BUNDLED_JLPT_SOURCE_URL,
      }),
      referenceTexts: [],
      cards,
    };
  }
}
