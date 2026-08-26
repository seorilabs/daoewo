#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { prioritizeBacklog } from "./backlog.mjs";
import { readJson, writeJsonAtomic } from "./io.mjs";
import {
  BACKLOG_PATH,
  CARD_SCHEMA_PATH,
  CATALOG_PATH,
  CATALOG_SCHEMA_PATH,
  PIPELINE_ROOT,
} from "./paths.mjs";
import { approveRecord, publishApprovedRecord, runToHumanApproval } from "./pipeline.mjs";
import { GeminiTextGenerator } from "./providers/gemini.mjs";
import { ImagenGenerator } from "./providers/imagen.mjs";
import { OfflineFixtureGenerator } from "./providers/offline-fixture.mjs";
import { OperatorBatchGenerator } from "./providers/operator-batch.mjs";
import { TOEIC_DECK_RANGES, VocabSwipeToeicImporter } from "./providers/vocab-swipe-import.mjs";
import { JLPT_DECK_LEVELS, VocabSwipeJlptImporter } from "./providers/vocab-swipe-jlpt.mjs";
import { HUMAN_REVIEW_CONFIRMATION } from "./state-machine.mjs";
import { assertBacklog, assertCatalog, assertSchemas } from "./validation.mjs";

function parseArgs(argv) {
  const [command = "help", ...tokens] = argv;
  const options = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
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
  const [catalog, backlog, cardSchema, catalogSchema] = await Promise.all([
    readJson(CATALOG_PATH),
    readJson(BACKLOG_PATH),
    readJson(CARD_SCHEMA_PATH),
    readJson(CATALOG_SCHEMA_PATH),
  ]);
  assertSchemas(cardSchema, catalogSchema);
  assertCatalog(catalog);
  assertBacklog(backlog);
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
    if (deck.contentStrategy !== "ai-assisted-operator-batch") {
      throw new Error("vocab-swipe-import 덱은 pinned import 경로로 가져와야 하며 Gemini 신규 생성으로 대체할 수 없다.");
    }
    generator = new GeminiTextGenerator();
  } else if (providerName === "batch") {
    if (deck.contentStrategy !== "ai-assisted-operator-batch") {
      throw new Error("운영자 batch provider는 ai-assisted-operator-batch 덱에만 사용할 수 있다.");
    }
    generator = new OperatorBatchGenerator({ inputFile: requireOption(options, "input") });
  } else if (providerName === "vocab-swipe") {
    if (deck.contentStrategy !== "vocab-swipe-import") {
      throw new Error("vocab-swipe importer는 vocab-swipe-import 덱에만 사용할 수 있다.");
    }
    const sourceRoot = requireOption(options, "source-root");
    if (deck.id in TOEIC_DECK_RANGES) {
      generator = new VocabSwipeToeicImporter({ sourceRoot });
    } else if (deck.id in JLPT_DECK_LEVELS) {
      generator = new VocabSwipeJlptImporter({ sourceRoot });
    } else {
      throw new Error(`vocab-swipe importer가 아직 지원하지 않는 덱이다: ${deck.id}`);
    }
  } else {
    throw new Error(`지원하지 않는 provider: ${providerName}`);
  }

  const output = path.resolve(options.output ?? path.join(PIPELINE_ROOT, ".work", `${deckId}.json`));
  const record = await runToHumanApproval({ deck, generator, outputFile: output });
  console.log(JSON.stringify({ deckId, state: record.workflow.state, cards: record.cards.length, fixtureOnly: record.fixtureOnly, output }));
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
    `  node src/cli.mjs run --deck <id> --provider offline|gemini [--output <file>]\n` +
    `  node src/cli.mjs run --deck <id> --provider vocab-swipe --source-root <vocab-swipe checkout> [--output <file>]\n` +
    `  node src/cli.mjs run --deck <id> --provider batch --input <batch raw json> [--output <file>]\n` +
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
