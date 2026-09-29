import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { digestJson, readJson, writeJsonAtomic } from "../content-pipeline/src/io.mjs";
import { runCopyrightQa, runFactualQa, runSafetyQa } from "../content-pipeline/src/qa.mjs";
import { canTransition } from "../content-pipeline/src/state-machine.mjs";
import { assertCards, validateDeck, ValidationError } from "../content-pipeline/src/validation.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const DEFAULT_WORK_ROOT = path.join(REPO_ROOT, "content-pipeline", ".work");
export const DEFAULT_PREVIEW_OUTPUT = path.join(
  REPO_ROOT,
  "apps",
  "mobile",
  ".work",
  "content-preview.generated.json",
);

const PREVIEW_WORKFLOW = [
  "planned",
  "generated",
  "normalized",
  "deduplicated",
  "safety-qa-passed",
  "copyright-qa-passed",
  "factual-qa-passed",
  "awaiting-human-approval",
];

const CATEGORY_LABELS = Object.freeze({
  language: "언어",
  certification: "자격증",
  career: "직무",
  "general-knowledge": "교양",
  "k12-secondary": "K-12",
});

function fail(sourceLabel, message) {
  throw new Error(`Preview 입력 ${sourceLabel} 검증 실패: ${message}`);
}

function assertWorkflow(record, sourceLabel) {
  if (record?.workflow?.state !== "awaiting-human-approval") {
    fail(sourceLabel, "workflow.state는 awaiting-human-approval이어야 한다.");
  }
  const history = record.workflow.history;
  if (!Array.isArray(history) || history.length !== PREVIEW_WORKFLOW.length) {
    fail(sourceLabel, "workflow.history가 사람 승인 대기까지의 전체 이력과 일치하지 않는다.");
  }

  let previousAt = -Infinity;
  for (const [index, state] of PREVIEW_WORKFLOW.entries()) {
    const entry = history[index];
    const expectedFrom = index === 0 ? null : PREVIEW_WORKFLOW[index - 1];
    if (entry?.from !== expectedFrom || entry?.to !== state) {
      fail(sourceLabel, `workflow.history[${index}] 상태 전이가 올바르지 않다.`);
    }
    if (index > 0 && !canTransition(expectedFrom, state)) {
      fail(sourceLabel, `허용되지 않은 상태 전이가 있다: ${expectedFrom} -> ${state}`);
    }
    const at = Date.parse(entry.at);
    if (!Number.isFinite(at) || at < previousAt) {
      fail(sourceLabel, `workflow.history[${index}].at이 유효한 시간 순서가 아니다.`);
    }
    previousAt = at;
  }
}

function assertPendingReviewer(record, sourceLabel) {
  const reviewer = record?.deck?.reviewer;
  if (
    reviewer?.status !== "pending" ||
    reviewer.name !== null ||
    reviewer.reviewedAt !== null ||
    reviewer.evidence !== null
  ) {
    fail(sourceLabel, "reviewer는 검수 정보가 없는 pending 상태여야 한다.");
  }
}

function assertRecordedQa(record, sourceLabel) {
  for (const stage of ["safety", "copyright", "factual"]) {
    const result = record?.qa?.[stage];
    if (result?.stage !== stage || result?.passed !== true || result?.findingCount !== 0) {
      fail(sourceLabel, `${stage} QA 통과 기록이 올바르지 않다.`);
    }
  }
}

export function validateMobilePreviewRecord(record, sourceLabel = "unknown") {
  if (record?.schemaVersion !== 1) fail(sourceLabel, "schemaVersion은 1이어야 한다.");
  if (record?.fixtureOnly !== false) {
    fail(sourceLabel, "offline fixture는 Preview에 사용할 수 없다. 실제 source 레코드가 필요하다.");
  }
  if (record?.deck?.status !== "awaiting-human-approval") {
    fail(sourceLabel, "deck.status는 awaiting-human-approval이어야 한다.");
  }

  assertWorkflow(record, sourceLabel);
  assertPendingReviewer(record, sourceLabel);
  assertRecordedQa(record, sourceLabel);

  const deckErrors = validateDeck(record.deck);
  if (deckErrors.length > 0) {
    throw new ValidationError(`Preview 덱 ${sourceLabel}`, deckErrors);
  }
  assertCards(record.cards);

  record.cards.forEach((card, index) => {
    if (card.deckId !== record.deck.id) {
      fail(sourceLabel, `cards[${index}].deckId가 덱 id와 일치하지 않는다.`);
    }
    if (card.index !== index) {
      fail(sourceLabel, `cards[${index}].index는 정규화된 순번 ${index}여야 한다.`);
    }
  });

  // 저장된 QA 플래그만 신뢰하지 않고 현재 규칙으로 다시 검사한다.
  runSafetyQa(record.cards);
  runCopyrightQa(record.cards, record.referenceTexts ?? []);
  runFactualQa(record.cards, record.sourceRegistry ?? []);
  return record;
}

function toPreviewCard(card, locale) {
  return {
    id: card.id,
    deckId: card.deckId,
    front: card.front,
    back: card.back,
    ...(card.hint === undefined ? {} : { hint: card.hint }),
    ...(card.reading === undefined ? {} : { reading: card.reading }),
    ...(card.example === undefined ? {} : { example: card.example }),
    ...(card.exampleMeaning === undefined ? {} : { exampleMeaning: card.exampleMeaning }),
    tags: [...card.tags],
    difficulty: card.difficulty,
    locale,
  };
}

function toPreviewDeck(record) {
  const { deck } = record;
  return {
    id: deck.id,
    title: deck.title,
    description: deck.description,
    category: deck.category,
    categoryLabel: CATEGORY_LABELS[deck.category],
    locale: deck.locale,
    contentLanguage: deck.contentLanguage,
    tier: deck.tier,
    source: deck.contentStrategy === "vocab-swipe-import" ? "official" : "ai-batch",
    priority: deck.priority,
    version: deck.version,
    tags: [...deck.tags],
    workflowState: "awaiting-human-approval",
    reviewStatus: "pending",
    cards: record.cards.map((card) => toPreviewCard(card, deck.locale)),
  };
}

export function createMobilePreviewArtifact(inputs, options = {}) {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new Error("Preview 입력 레코드가 하나 이상 필요하다.");
  }

  const validated = inputs.map(({ filePath, record }) => ({
    filePath,
    record: validateMobilePreviewRecord(record, path.basename(filePath)),
  }));
  const deckIds = validated.map(({ record }) => record.deck.id);
  if (new Set(deckIds).size !== deckIds.length) {
    throw new Error("Preview 입력에 중복된 deck id가 있다.");
  }

  const generatedAt = (options.clock ?? (() => new Date()))().toISOString();
  return {
    schemaVersion: 1,
    kind: "daoewo-mobile-content-preview",
    generatedAt,
    notice: "DEV · 미승인 콘텐츠 · 외부 전송 금지",
    sourceRecords: validated.map(({ filePath, record }) => ({
      file: path.basename(filePath),
      digest: digestJson(record),
    })),
    decks: validated.map(({ record }) => toPreviewDeck(record)),
  };
}

function assertIgnoredWorkOutput(outputFile) {
  const parts = path.resolve(outputFile).split(path.sep);
  if (!parts.includes(".work") || path.extname(outputFile) !== ".json") {
    throw new Error("Preview 출력은 gitignore 대상 .work 디렉터리의 JSON 파일이어야 한다.");
  }
}

export async function generateMobileContentPreview({ inputFiles, outputFile = DEFAULT_PREVIEW_OUTPUT, clock }) {
  if (!Array.isArray(inputFiles) || inputFiles.length === 0) {
    throw new Error("Preview 입력 파일이 하나 이상 필요하다.");
  }
  assertIgnoredWorkOutput(outputFile);
  const resolvedOutput = path.resolve(outputFile);
  if (inputFiles.some((file) => path.resolve(file) === resolvedOutput)) {
    throw new Error("Preview 출력 파일은 입력 레코드를 덮어쓸 수 없다.");
  }

  const inputs = await Promise.all(
    [...inputFiles].sort().map(async (filePath) => ({
      filePath,
      record: await readJson(filePath),
    })),
  );
  const artifact = createMobilePreviewArtifact(inputs, { clock });
  await writeJsonAtomic(outputFile, artifact);
  return artifact;
}

async function defaultInputFiles() {
  const names = await readdir(DEFAULT_WORK_ROOT);
  return names
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => path.join(DEFAULT_WORK_ROOT, name));
}

function parseArguments(args) {
  const inputFiles = [];
  let outputFile = DEFAULT_PREVIEW_OUTPUT;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--input" && args[index + 1]) {
      inputFiles.push(path.resolve(args[index + 1]));
      index += 1;
    } else if (args[index] === "--output" && args[index + 1]) {
      outputFile = path.resolve(args[index + 1]);
      index += 1;
    } else {
      throw new Error(`알 수 없는 인자: ${args[index]}`);
    }
  }
  return { inputFiles, outputFile };
}

async function main() {
  const parsed = parseArguments(process.argv.slice(2));
  const inputFiles = parsed.inputFiles.length > 0 ? parsed.inputFiles : await defaultInputFiles();
  const artifact = await generateMobileContentPreview({ ...parsed, inputFiles });
  process.stdout.write(
    `${JSON.stringify({ output: parsed.outputFile, decks: artifact.decks.length, notice: artifact.notice })}\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
