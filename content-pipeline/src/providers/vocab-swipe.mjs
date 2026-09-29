import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import vm from "node:vm";

const execFileAsync = promisify(execFile);

export const VOCAB_SWIPE_COMMIT = "e1ba2d5503d1f90ee9d6995c80070b0e2e3152e6";
export const VOCAB_SWIPE_COMMITTED_AT = "2026-07-12T09:03:12.000Z";
export const VOCAB_SWIPE_REPOSITORY_URI = "https://github.com/seorilabs/vocab-swipe";

const SELF_AUTHORED_LICENSE = Object.freeze({
  id: "LicenseRef-Seorilabs-Self-Authored",
  attribution: "Seorilabs 자체 작성 또는 생성 후 사람 검수 대상 콘텐츠",
  evidenceUri: "urn:daoewo:content-policy:v1",
  commercialUse: true,
  shareAlike: false,
});

const INPUT_FILES = Object.freeze({
  toeicWords: Object.freeze({
    id: "vocab-swipe-toeic-word-list",
    path: "packages/product-core/src/data/toeic-word-list.generated.ts",
    sha256: "565963b0e71deb90931750971b36bd7e8d4c3b05dffd6edaf9343b1dbadf034a",
    licenses: Object.freeze([
      Object.freeze({
        id: "CC-BY-SA-4.0",
        attribution: "TOEIC Service List 1.2, Browne and Culligan; nltk-data-hub/words",
        evidenceUri: "https://huggingface.co/datasets/nltk-data-hub/words",
        commercialUse: true,
        shareAlike: true,
      }),
      Object.freeze({
        id: "WordNet-3.0",
        attribution: "Princeton University WordNet 3.0",
        evidenceUri: "https://wordnet.princeton.edu/license-and-commercial-use",
        commercialUse: true,
        shareAlike: false,
      }),
    ]),
  }),
  toeicGlosses: Object.freeze({
    id: "vocab-swipe-toeic-korean-glosses",
    path: "packages/product-core/src/data/toeic-korean-glosses.ts",
    sha256: "25b514eb7278e3c74e85d21256c868c7bf9e2606b29aaa2295fe4e2da0371c65",
    licenses: Object.freeze([SELF_AUTHORED_LICENSE]),
  }),
  toeicEnrichment: Object.freeze({
    id: "vocab-swipe-toeic-self-authored-enrichment",
    path: "packages/product-core/src/data/toeic-self-authored-enrichment.ts",
    sha256: "5e50df05597354955feda1d3b5532a6f7d8f918a622253fcde6886cdeffef823",
    licenses: Object.freeze([SELF_AUTHORED_LICENSE]),
  }),
  jlptWords: Object.freeze({
    id: "vocab-swipe-jlpt-word-list",
    path: "packages/product-core/src/data/jlpt-word-list.generated.ts",
    sha256: "57c15bfc3f1591d24a54e3cb6f7d9b1eabb5c09145ea5fa5761d7fb77c2a978d",
    licenses: Object.freeze([
      Object.freeze({
        id: "MIT",
        attribution: "elzup/jlpt-word-list",
        evidenceUri: "https://github.com/elzup/jlpt-word-list/blob/master/LICENSE",
        commercialUse: true,
        shareAlike: false,
      }),
    ]),
  }),
  jlptEnrichment: Object.freeze({
    id: "vocab-swipe-jlpt-korean-enrichment",
    path: "packages/product-core/src/data/jlpt-korean-enrichment.generated.ts",
    sha256: "61fdad1ef892548453b9457e46e9502a7c264229c5a53645c2981bedf488c8fa",
    licenses: Object.freeze([SELF_AUTHORED_LICENSE]),
    reviewStatus: "machine-generated-awaiting-human-review",
  }),
});

export const VOCAB_SWIPE_INPUT_FILES = INPUT_FILES;

export const VOCAB_SWIPE_DECK_IDS = Object.freeze([
  "english-essential-intro",
  "english-toeic-advanced",
  "japanese-jlpt-n5-preview",
  "japanese-jlpt-n3-n2",
]);

const DECK_PLANS = Object.freeze({
  "english-essential-intro": Object.freeze({ kind: "toeic", count: 600 }),
  "english-toeic-advanced": Object.freeze({ kind: "toeic", count: 1_250 }),
  "japanese-jlpt-n5-preview": Object.freeze({ kind: "jlpt-n5", count: 240 }),
  "japanese-jlpt-n3-n2": Object.freeze({ kind: "jlpt-n3-n2", count: 2_688 }),
});

const JLPT_DEFAULT_HINT = "단어와 읽는 법을 소리 내어 읽고, 예문에서 쓰임을 확인하세요.";
const TOEIC_SELF_AUTHORED_HINT = "한국어 뜻과 품사를 먼저 보고, 예문에서 단어가 어떤 역할로 쓰였는지 확인하세요.";
const TOEIC_WORDNET_HINT = "한국어 뜻을 떠올린 뒤 WordNet 3.0 예문에서 쓰임을 확인하세요. ETS 공식 문항이나 공식 예문은 사용하지 않습니다.";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function invariant(condition, message) {
  if (!condition) throw new Error(`vocab-swipe snapshot 불변식 위반: ${message}`);
}

function extractLiteral(source, exportName) {
  const escapedName = exportName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const declarationMatch = new RegExp(`export\\s+const\\s+${escapedName}(?=\\s|:|=)`).exec(source);
  if (declarationMatch === null) throw new Error(`${exportName} export를 찾을 수 없다.`);
  const declarationIndex = declarationMatch.index;

  const equalsIndex = source.indexOf("=", declarationIndex + declarationMatch[0].length);
  if (equalsIndex < 0) throw new Error(`${exportName} initializer를 찾을 수 없다.`);

  let start = equalsIndex + 1;
  while (/\s/.test(source[start] ?? "")) start += 1;
  if (!["[", "{"].includes(source[start])) throw new Error(`${exportName} initializer가 data literal이 아니다.`);

  const stack = [];
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "`") throw new Error(`${exportName} initializer의 template literal은 허용하지 않는다.`);
    if (character === "[" || character === "{") {
      stack.push(character);
      continue;
    }
    if (character === "]" || character === "}") {
      const expected = character === "]" ? "[" : "{";
      if (stack.pop() !== expected) throw new Error(`${exportName} initializer 괄호가 올바르지 않다.`);
      if (stack.length === 0) return source.slice(start, index + 1);
    }
  }

  throw new Error(`${exportName} initializer가 끝나지 않았다.`);
}

export function parseExportedDataLiteral(source, exportName) {
  const literal = extractLiteral(source, exportName);
  const value = vm.runInNewContext(`(${literal})`, Object.create(null), {
    timeout: 2_000,
    contextCodeGeneration: { strings: false, wasm: false },
  });
  return structuredClone(value);
}

function sourceRegistryEntry(spec) {
  return {
    id: spec.id,
    kind: "git-blob",
    uri: `${VOCAB_SWIPE_REPOSITORY_URI}/blob/${VOCAB_SWIPE_COMMIT}/${spec.path}`,
    revision: `git:${VOCAB_SWIPE_COMMIT};sha256:${spec.sha256}`,
    repositoryCommit: VOCAB_SWIPE_COMMIT,
    path: spec.path,
    sha256: `sha256:${spec.sha256}`,
    licenses: spec.licenses,
    ...(spec.reviewStatus === undefined ? {} : { reviewStatus: spec.reviewStatus }),
  };
}

function sourceRegistryFor(kind, files = INPUT_FILES) {
  const selected = kind === "toeic"
    ? [files.toeicWords, files.toeicGlosses, files.toeicEnrichment]
    : [files.jlptWords, files.jlptEnrichment];
  const licenseIds = [...new Set(selected.flatMap((file) => file.licenses.map((license) => license.id)))];
  return [
    {
      id: "vocab-swipe-pinned-repository",
      kind: "git-commit",
      uri: `${VOCAB_SWIPE_REPOSITORY_URI}/tree/${VOCAB_SWIPE_COMMIT}`,
      revision: `git:${VOCAB_SWIPE_COMMIT}`,
      commit: VOCAB_SWIPE_COMMIT,
      committedAt: VOCAB_SWIPE_COMMITTED_AT,
      licensePolicy: "mixed-by-input-file",
      licenseIds,
    },
    ...selected.map(sourceRegistryEntry),
  ];
}

function toeicCards(snapshot, count, files) {
  const rows = snapshot.toeicWords;
  const glosses = snapshot.toeicGlosses;
  const enrichmentByWord = snapshot.toeicEnrichment;
  invariant(Array.isArray(rows) && rows.length === 1_250, `TOEIC 원본은 1,250행이어야 한다(현재 ${rows?.length ?? "invalid"}).`);
  invariant(Object.keys(glosses).length === 1_250, "TOEIC 한국어 gloss는 1,250개여야 한다.");
  invariant(Object.keys(enrichmentByWord).length === 1_250, "TOEIC 자체 enrichment는 1,250개여야 한다.");

  const words = new Set();
  const ranks = new Set();
  const cards = rows.map((row, index) => {
    invariant(Array.isArray(row) && row.length >= 4, `TOEIC ${index + 1}행 형식이 올바르지 않다.`);
    const [word, rank, , , , rowPartOfSpeech, rowExample, rowExampleSource] = row;
    invariant(typeof word === "string" && word.length > 0, `TOEIC ${index + 1}행 표제어가 비어 있다.`);
    invariant(rank === index + 1 && !ranks.has(rank), `TOEIC rank ${rank}가 연속·고유하지 않다.`);
    invariant(!words.has(word), `TOEIC 표제어가 중복됐다: ${word}`);
    ranks.add(rank);
    words.add(word);

    const koreanMeaning = glosses[word];
    const enrichment = enrichmentByWord[word];
    const partOfSpeech = rowPartOfSpeech ?? enrichment?.partOfSpeech;
    const example = enrichment?.example ?? rowExample;
    const exampleSource = enrichment?.example !== undefined ? "self-authored" : rowExampleSource;
    invariant(typeof koreanMeaning === "string" && koreanMeaning.length > 0, `${word}의 한국어 뜻이 없다.`);
    invariant(typeof enrichment?.exampleMeaning === "string" && enrichment.exampleMeaning.length > 0, `${word}의 예문 번역이 없다.`);
    invariant(typeof partOfSpeech === "string" && partOfSpeech.length > 0, `${word}의 품사가 없다.`);
    invariant(typeof example === "string" && example.length > 0, `${word}의 예문이 없다.`);
    invariant(exampleSource === "self-authored" || exampleSource === "wordnet-3.0", `${word}의 예문 출처가 올바르지 않다.`);

    return {
      front: word,
      back: koreanMeaning,
      hint: exampleSource === "wordnet-3.0" ? TOEIC_WORDNET_HINT : TOEIC_SELF_AUTHORED_HINT,
      example,
      exampleMeaning: enrichment.exampleMeaning,
      tags: ["TOEIC", "TSL", `rank-${rank}`, `pos:${partOfSpeech}`],
      difficulty: Math.min(5, Math.ceil(rank / 250)),
      sourceRefs: [files.toeicWords.id, files.toeicGlosses.id, files.toeicEnrichment.id],
    };
  });

  return cards.slice(0, count);
}

function jlptLevelCards(snapshot, level, files) {
  const rows = snapshot.jlptWords[level];
  const enrichmentByWord = snapshot.jlptEnrichment[level];
  invariant(Array.isArray(rows), `${level} 원본 배열이 없다.`);
  invariant(enrichmentByWord !== null && typeof enrichmentByWord === "object", `${level} enrichment가 없다.`);

  const seen = new Set();
  const cards = [];
  for (const row of rows) {
    invariant(Array.isArray(row) && row.length === 4, `${level} 원본 행 형식이 올바르지 않다.`);
    const [word, reading] = row;
    if (seen.has(word)) continue;
    seen.add(word);
    const enrichment = enrichmentByWord[word];
    if (enrichment === undefined) continue;
    invariant(typeof enrichment.meaningKo === "string" && enrichment.meaningKo.length > 0, `${level}/${word}의 한국어 뜻이 없다.`);
    invariant(typeof enrichment.example === "string" && enrichment.example.length > 0, `${level}/${word}의 예문이 없다.`);
    invariant(typeof enrichment.exampleMeaning === "string" && enrichment.exampleMeaning.length > 0, `${level}/${word}의 예문 번역이 없다.`);
    cards.push({
      front: word,
      back: enrichment.meaningKo,
      reading,
      example: enrichment.example,
      exampleMeaning: enrichment.exampleMeaning,
      hint: enrichment.studyTip ?? JLPT_DEFAULT_HINT,
      tags: ["JLPT", level.replace("jlpt-n", "N")],
      difficulty: { "jlpt-n5": 1, "jlpt-n3": 3, "jlpt-n2": 4 }[level],
      sourceRefs: [files.jlptWords.id, files.jlptEnrichment.id],
    });
  }
  return cards;
}

function jlptCards(snapshot, plan, files) {
  const n5 = jlptLevelCards(snapshot, "jlpt-n5", files);
  const n3 = jlptLevelCards(snapshot, "jlpt-n3", files);
  const n2 = jlptLevelCards(snapshot, "jlpt-n2", files);
  invariant(n5.length === 525, `N5 enrichment join은 525개여야 한다(현재 ${n5.length}).`);
  invariant(n3.length === 1_462, `N3 enrichment join은 1,462개여야 한다(현재 ${n3.length}).`);
  invariant(n2.length === 1_227, `N2 enrichment join은 1,227개여야 한다(현재 ${n2.length}).`);

  if (plan.kind === "jlpt-n5") return n5.slice(0, plan.count);

  const seen = new Set();
  const overlaps = [];
  const combined = [];
  for (const card of [...n3, ...n2]) {
    if (seen.has(card.front)) {
      overlaps.push(card.front);
      continue;
    }
    seen.add(card.front);
    combined.push(card);
  }
  invariant(overlaps.length === 1 && overlaps[0] === "故郷", `N3/N2 중복은 故郷 1건이어야 한다(현재 ${overlaps.join(", ") || "없음"}).`);
  invariant(combined.length === plan.count, `N3/N2 결과는 ${plan.count}개여야 한다(현재 ${combined.length}).`);
  return combined;
}

export function buildVocabSwipeDeck(deckId, snapshot, files = INPUT_FILES) {
  const plan = DECK_PLANS[deckId];
  if (plan === undefined) throw new Error(`지원하지 않는 vocab-swipe import deck: ${deckId}`);
  const cards = plan.kind === "toeic" ? toeicCards(snapshot, plan.count, files) : jlptCards(snapshot, plan, files);
  invariant(cards.length === plan.count, `${deckId} 결과는 ${plan.count}개여야 한다(현재 ${cards.length}).`);
  return {
    deckId,
    fixtureOnly: false,
    cards,
    sourceRegistry: sourceRegistryFor(plan.kind === "toeic" ? "toeic" : "jlpt", files),
    referenceTexts: [],
  };
}

export class GitSnapshotReader {
  constructor(repoPath) {
    if (typeof repoPath !== "string" || repoPath.trim().length === 0) throw new Error("vocab-swipe repo 경로가 필요하다.");
    this.repoPath = path.resolve(repoPath);
  }

  async #git(args, encoding = "utf8") {
    try {
      const { stdout } = await execFileAsync("git", ["-C", this.repoPath, ...args], {
        encoding,
        maxBuffer: 32 * 1024 * 1024,
      });
      return stdout;
    } catch {
      throw new Error(`pinned vocab-swipe snapshot을 git으로 읽지 못했다: ${args[0]}`);
    }
  }

  async verifyCommit(commit, committedAt) {
    const resolved = String(await this.#git(["rev-parse", "--verify", `${commit}^{commit}`])).trim();
    invariant(resolved === commit, `요청 commit이 다른 객체로 해석됐다: ${resolved}`);
    const actualCommittedAt = String(await this.#git(["show", "-s", "--format=%cI", commit])).trim();
    invariant(new Date(actualCommittedAt).toISOString() === committedAt, `commit 시각이 다르다: ${actualCommittedAt}`);
  }

  async readFile(commit, filePath) {
    return this.#git(["show", `${commit}:${filePath}`], null);
  }
}

export class VocabSwipeSnapshotGenerator {
  constructor({ repoPath, reader, inputFiles = INPUT_FILES } = {}) {
    this.name = "vocab-swipe-git-snapshot-v1";
    this.reader = reader ?? new GitSnapshotReader(repoPath);
    this.inputFiles = inputFiles;
    this.snapshotPromise = null;
  }

  async #loadSnapshot() {
    await this.reader.verifyCommit(VOCAB_SWIPE_COMMIT, VOCAB_SWIPE_COMMITTED_AT);
    const entries = await Promise.all(Object.entries(this.inputFiles).map(async ([key, spec]) => {
      const bytes = await this.reader.readFile(VOCAB_SWIPE_COMMIT, spec.path);
      invariant(Buffer.isBuffer(bytes), `${spec.path}를 byte buffer로 읽지 못했다.`);
      const actualSha256 = sha256(bytes);
      invariant(actualSha256 === spec.sha256, `${spec.path} SHA-256 불일치: ${actualSha256}`);
      return [key, bytes.toString("utf8")];
    }));
    const sources = Object.fromEntries(entries);
    return {
      toeicWords: parseExportedDataLiteral(sources.toeicWords, "BUNDLED_TOEIC_WORDS"),
      toeicGlosses: parseExportedDataLiteral(sources.toeicGlosses, "BUNDLED_TOEIC_KOREAN_GLOSSES"),
      toeicEnrichment: parseExportedDataLiteral(sources.toeicEnrichment, "BUNDLED_TOEIC_SELF_AUTHORED_ENRICHMENT"),
      jlptWords: parseExportedDataLiteral(sources.jlptWords, "BUNDLED_JLPT_WORDS_BY_LEVEL"),
      jlptEnrichment: parseExportedDataLiteral(sources.jlptEnrichment, "JLPT_KOREAN_ENRICHMENT"),
    };
  }

  async generate({ deck }) {
    if (deck?.contentStrategy !== "vocab-swipe-import") throw new Error(`${deck?.id ?? "unknown"} 덱은 vocab-swipe import 대상이 아니다.`);
    if (deck.source?.commit !== VOCAB_SWIPE_COMMIT) throw new Error(`${deck.id} manifest의 source.commit이 pinned snapshot과 다르다.`);
    this.snapshotPromise ??= this.#loadSnapshot();
    return buildVocabSwipeDeck(deck.id, await this.snapshotPromise, this.inputFiles);
  }
}
