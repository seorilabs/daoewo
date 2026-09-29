#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { prioritizeBacklog } from "./backlog.mjs";
import { assertBatchPlan } from "./batch-plan.mjs";
import { readBatchRunStatus, runResumableBatch } from "./batch-runner.mjs";
import { readJson, writeJsonAtomic } from "./io.mjs";
import { resolveGeminiOperatorEnv } from "./operator-credentials.mjs";
import {
  BACKLOG_PATH,
  BATCH_RUNS_ROOT,
  CARD_SCHEMA_PATH,
  CATALOG_PATH,
  CATALOG_SCHEMA_PATH,
  P1_AI_BATCH_PLAN_PATH,
  PIPELINE_ROOT,
} from "./paths.mjs";
import { approveRecord, publishApprovedRecord, runToHumanApproval } from "./pipeline.mjs";
import { GeminiTextGenerator } from "./providers/gemini.mjs";
import { ImagenGenerator } from "./providers/imagen.mjs";
import { OfflineFixtureGenerator } from "./providers/offline-fixture.mjs";
import {
  VOCAB_SWIPE_COMMIT,
  VOCAB_SWIPE_DECK_IDS,
  VocabSwipeSnapshotGenerator,
} from "./providers/vocab-swipe.mjs";
import { HUMAN_REVIEW_CONFIRMATION } from "./state-machine.mjs";
import { assertBacklog, assertCatalog, assertSchemas } from "./validation.mjs";

function parseArgs(argv) {
  const [command = "help", ...tokens] = argv;
  const options = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--") continue;
    if (!token.startsWith("--")) throw new Error(`알 수 없는 인자: ${token}`);
    const equalIndex = token.indexOf("=");
    if (equalIndex >= 0) {
      options[token.slice(2, equalIndex)] = token.slice(equalIndex + 1);
      continue;
    }
    const key = token.slice(2);
    const next = tokens[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return { command, options };
}

function requireOption(options, key) {
  const value = options[key];
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`--${key} 값이 필요하다.`);
  return value;
}

async function loadCatalogDeck(deckId) {
  const catalog = await readJson(CATALOG_PATH);
  assertCatalog(catalog);
  const deck = catalog.decks.find((candidate) => candidate.id === deckId);
  if (deck === undefined) throw new Error(`manifest에 없는 deck id: ${deckId}`);
  return deck;
}

async function validateCommand() {
  const [catalog, backlog, cardSchema, catalogSchema, batchPlan] = await Promise.all([
    readJson(CATALOG_PATH),
    readJson(BACKLOG_PATH),
    readJson(CARD_SCHEMA_PATH),
    readJson(CATALOG_SCHEMA_PATH),
    readJson(P1_AI_BATCH_PLAN_PATH),
  ]);
  assertSchemas(cardSchema, catalogSchema);
  assertCatalog(catalog);
  assertBacklog(backlog);
  assertBatchPlan(batchPlan, catalog);
  const summary = {
    ok: true,
    decks: catalog.decks.length,
    tier: {
      free: catalog.decks.filter((deck) => deck.tier === "free").length,
      pro: catalog.decks.filter((deck) => deck.tier === "pro").length,
    },
    priority: Object.fromEntries(["P1", "P2", "P3"].map((priority) => [priority, catalog.decks.filter((deck) => deck.priority === priority).length])),
    chunkSize: catalog.chunkSize,
    backlogSignals: backlog.signals.length,
    p1AiBatchTargets: Object.fromEntries(batchPlan.decks.map((deck) => [deck.deckId, deck.targetCardCount])),
  };
  console.log(JSON.stringify(summary));
}

async function backlogCommand() {
  const ranked = prioritizeBacklog(await readJson(BACKLOG_PATH));
  console.log(JSON.stringify({ generatedBy: "priority-backlog-v1", items: ranked }, null, 2));
}

async function runCommand(options) {
  const deckId = requireOption(options, "deck");
  const providerName = options.provider ?? "offline";
  const deck = await loadCatalogDeck(deckId);
  let generator;
  if (providerName === "offline") {
    generator = new OfflineFixtureGenerator();
  } else if (providerName === "gemini") {
    throw new Error("Gemini 생성은 model sourceRegistry를 차단하는 tracked `batch-run` 명령으로만 실행한다.");
  } else if (providerName === "vocab-swipe") {
    if (deck.contentStrategy !== "vocab-swipe-import") {
      throw new Error("vocab-swipe provider는 vocab-swipe-import 덱에만 사용할 수 있다.");
    }
    generator = new VocabSwipeSnapshotGenerator({ repoPath: requireOption(options, "source-repo") });
  } else {
    throw new Error(`지원하지 않는 provider: ${providerName}`);
  }

  const output = path.resolve(options.output ?? path.join(PIPELINE_ROOT, ".work", `${deckId}.json`));
  const record = await runToHumanApproval({ deck, generator, outputFile: output });
  console.log(JSON.stringify({ deckId, state: record.workflow.state, cards: record.cards.length, fixtureOnly: record.fixtureOnly, output }));
}

async function batchRunCommand(options) {
  const deckId = requireOption(options, "deck");
  const [catalog, plan] = await Promise.all([
    readJson(CATALOG_PATH),
    readJson(P1_AI_BATCH_PLAN_PATH),
  ]);
  assertCatalog(catalog);
  assertBatchPlan(plan, catalog);
  const operatorEnv = await resolveGeminiOperatorEnv();
  process.env.GEMINI_API_KEY = operatorEnv.GEMINI_API_KEY;
  const generator = new GeminiTextGenerator({ env: operatorEnv });
  const runRoot = path.resolve(options["run-root"] ?? path.join(BATCH_RUNS_ROOT, deckId));
  const compatibilityPath = path.resolve(options.output ?? path.join(PIPELINE_ROOT, ".work", `${deckId}.json`));
  const maxCalls = options["max-calls"] === undefined ? undefined : Number(options["max-calls"]);
  const result = await runResumableBatch({
    plan,
    catalog,
    deckId,
    generator,
    runRoot,
    compatibilityPath,
    ...(maxCalls === undefined ? {} : { maxCalls }),
    retryUncertain: options["retry-uncertain"] === true,
    forceUnlock: options["force-unlock"] === true,
  });
  console.log(JSON.stringify({
    ok: true,
    deckId,
    state: result.record.workflow.state,
    cards: result.record.cards.length,
    calls: result.runState.calls,
    usage: result.runState.usage,
    runRoot: result.runRoot,
    output: result.compatibilityPath,
    legacyPreserved: result.legacyPreserved,
  }, null, 2));
}

async function batchStatusCommand(options) {
  const deckId = requireOption(options, "deck");
  const runRoot = path.resolve(options["run-root"] ?? path.join(BATCH_RUNS_ROOT, deckId));
  const status = await readBatchRunStatus({ runRoot });
  console.log(JSON.stringify({ ...status, runRoot }, null, 2));
}

async function importVocabSwipeCommand(options) {
  if (options.all === true && options.deck !== undefined) throw new Error("--all과 --deck은 함께 사용할 수 없다.");
  if (options.all !== true && typeof options.deck !== "string") throw new Error("--all 또는 --deck <id>가 필요하다.");
  const deckIds = options.all === true ? VOCAB_SWIPE_DECK_IDS : [options.deck];
  const outputRoot = path.resolve(options.output ?? path.join(PIPELINE_ROOT, ".work"));
  const generator = new VocabSwipeSnapshotGenerator({ repoPath: requireOption(options, "source-repo") });
  const results = [];

  for (const deckId of deckIds) {
    const deck = await loadCatalogDeck(deckId);
    if (!VOCAB_SWIPE_DECK_IDS.includes(deck.id)) throw new Error(`P1 vocab-swipe import plan에 없는 deck id: ${deck.id}`);
    const outputFile = path.join(outputRoot, `${deck.id}.json`);
    const record = await runToHumanApproval({
      deck,
      generator,
      outputFile,
    });
    if (record.workflow.state !== "awaiting-human-approval" || record.deck.reviewer.status !== "pending") {
      throw new Error(`${deck.id} import가 사람 승인 대기 draft에서 멈추지 않았다.`);
    }
    results.push({
      deckId: deck.id,
      cards: record.cards.length,
      state: record.workflow.state,
      reviewerStatus: record.deck.reviewer.status,
      inputDigest: record.deck.provenance.inputDigest,
      output: outputFile,
    });
  }

  console.log(JSON.stringify({
    ok: true,
    sourceCommit: VOCAB_SWIPE_COMMIT,
    draftOnly: true,
    outputRoot,
    results,
  }, null, 2));
}

async function smokeCommand(options) {
  if (options.offline !== true) throw new Error("smoke는 네트워크 호출 방지를 위해 --offline 플래그가 필요하다.");
  const workRoot = await mkdtemp(path.join(tmpdir(), "daoewo-content-smoke-"));
  const generator = new OfflineFixtureGenerator();
  const results = [];
  for (const deckId of ["korean-history-cert-core", "it-cs-interview-terms"]) {
    const deck = await loadCatalogDeck(deckId);
    const outputFile = path.join(workRoot, `${deckId}.json`);
    const record = await runToHumanApproval({ deck, generator, outputFile });
    results.push({
      deckId,
      cards: record.cards.length,
      duplicatesRemoved: record.dedupe.removed.length,
      state: record.workflow.state,
      reviewerStatus: record.deck.reviewer.status,
      published: record.workflow.state === "published",
    });
  }
  console.log(JSON.stringify({ ok: true, offline: true, results }));
}

async function approveCommand(options) {
  const workPath = path.resolve(requireOption(options, "work"));
  const record = await readJson(workPath);
  const approved = approveRecord(record, {
    reviewer: requireOption(options, "reviewer"),
    evidence: requireOption(options, "evidence"),
    confirmation: requireOption(options, "confirm-human-review"),
  });
  await writeJsonAtomic(workPath, approved);
  console.log(JSON.stringify({ deckId: approved.deck.id, state: approved.workflow.state, reviewer: approved.deck.reviewer.name, work: workPath }));
}

async function publishCommand(options) {
  const workPath = path.resolve(requireOption(options, "work"));
  const outputRoot = path.resolve(options.output ?? path.join(PIPELINE_ROOT, "published"));
  const record = await readJson(workPath);
  const published = await publishApprovedRecord(record, outputRoot);
  await writeJsonAtomic(workPath, published.record);
  console.log(JSON.stringify({ deckId: published.record.deck.id, state: published.record.workflow.state, chunks: published.chunks.length, target: published.target }));
}

async function imageCommand(options) {
  const promptPath = path.resolve(requireOption(options, "prompt-file"));
  const outputPath = path.resolve(requireOption(options, "output"));
  const prompt = await readFile(promptPath, "utf8");
  const generator = new ImagenGenerator();
  const generated = await generator.generate({ prompt, aspectRatio: options["aspect-ratio"] ?? "1:1" });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, generated.bytes);
  console.log(JSON.stringify({ output: outputPath, mimeType: generated.mimeType, model: generated.model }));
}

function help() {
  console.log(`공급자 전용 CLI (사용자 요청 경로에서 호출 금지)\n\n` +
    `  node src/cli.mjs validate\n` +
    `  node src/cli.mjs backlog\n` +
    `  node src/cli.mjs smoke --offline\n` +
    `  node src/cli.mjs run --deck <id> --provider offline|vocab-swipe [--source-repo <path>] [--output <file>]\n` +
    `  node src/cli.mjs batch-run --deck <p1-ai-deck> [--max-calls <n>] [--run-root <directory>] [--output <file>] [--retry-uncertain] [--force-unlock]\n` +
    `  node src/cli.mjs batch-status --deck <p1-ai-deck> [--run-root <directory>]\n` +
    `  node src/cli.mjs import-vocab-swipe --source-repo <path> (--all | --deck <id>) [--output <directory>]\n` +
    `  node src/cli.mjs approve --work <file> --reviewer <name> --evidence <path-or-ticket> --confirm-human-review ${HUMAN_REVIEW_CONFIRMATION}\n` +
    `  node src/cli.mjs publish --work <file> [--output <directory>]\n` +
    `  node src/cli.mjs image --prompt-file <file> --output <png> [--aspect-ratio 1:1]\n`);
}

function redactSecrets(message) {
  let redacted = String(message);
  const key = process.env.GEMINI_API_KEY;
  if (typeof key === "string" && key.length > 0) redacted = redacted.split(key).join("[REDACTED]");
  return redacted.replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED]");
}

const { command, options } = parseArgs(process.argv.slice(2));

try {
  if (command === "validate") await validateCommand();
  else if (command === "backlog") await backlogCommand();
  else if (command === "run") await runCommand(options);
  else if (command === "batch-run") await batchRunCommand(options);
  else if (command === "batch-status") await batchStatusCommand(options);
  else if (command === "import-vocab-swipe") await importVocabSwipeCommand(options);
  else if (command === "smoke") await smokeCommand(options);
  else if (command === "approve") await approveCommand(options);
  else if (command === "publish") await publishCommand(options);
  else if (command === "image") await imageCommand(options);
  else if (command === "help" || command === "--help") help();
  else throw new Error(`알 수 없는 command: ${command}`);
} catch (error) {
  console.error(redactSecrets(error?.message ?? error));
  process.exitCode = 1;
}
