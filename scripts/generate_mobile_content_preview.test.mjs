import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readJson, writeJsonAtomic } from "../content-pipeline/src/io.mjs";
import { runToHumanApproval } from "../content-pipeline/src/pipeline.mjs";
import { OfflineFixtureGenerator } from "../content-pipeline/src/providers/offline-fixture.mjs";
import {
  createMobilePreviewArtifact,
  generateMobileContentPreview,
  validateMobilePreviewRecord,
} from "./generate_mobile_content_preview.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

async function createRealSourceRecord() {
  const manifest = await readJson(path.join(REPO_ROOT, "content-pipeline", "manifests", "v1.json"));
  const deck = manifest.decks.find((candidate) => candidate.id === "korean-history-cert-core");
  assert.ok(deck);
  const record = await runToHumanApproval({
    deck,
    generator: new OfflineFixtureGenerator(),
    clock: () => new Date("2026-07-14T00:00:00.000Z"),
  });
  return { ...record, fixtureOnly: false };
}

test("미승인 실제 source 레코드를 최소 필드 mobile Preview artifact로 만든다", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "daoewo-preview-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const inputFile = path.join(root, ".work", "record.json");
  const outputFile = path.join(root, ".work", "mobile-preview.json");
  await writeJsonAtomic(inputFile, await createRealSourceRecord());

  const artifact = await generateMobileContentPreview({
    inputFiles: [inputFile],
    outputFile,
    clock: () => new Date("2026-07-14T01:02:03.000Z"),
  });

  assert.equal(artifact.notice, "DEV · 미승인 콘텐츠 · 외부 전송 금지");
  assert.equal(artifact.generatedAt, "2026-07-14T01:02:03.000Z");
  assert.equal(artifact.decks[0].workflowState, "awaiting-human-approval");
  assert.equal(artifact.decks[0].reviewStatus, "pending");
  assert.equal(artifact.decks[0].source, "ai-batch");
  assert.equal(artifact.decks[0].cards.length, 5);
  const serialized = await readFile(outputFile, "utf8");
  for (const forbidden of ["sourceRegistry", "referenceTexts", "sourceRefs", "reviewer", "evidenceUri"]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden}가 Preview artifact에 남았다.`);
  }
});

test("contentStrategy를 Preview source provenance로 보존한다", async () => {
  const aiRecord = await createRealSourceRecord();
  const importedRecord = {
    ...aiRecord,
    deck: {
      ...aiRecord.deck,
      contentStrategy: "vocab-swipe-import",
      provenance: {...aiRecord.deck.provenance, kind: "imported"},
    },
  };
  const artifact = createMobilePreviewArtifact([
    {filePath: "/tmp/imported.json", record: importedRecord},
  ]);
  assert.equal(artifact.decks[0].source, "official");
});

test("fixture, 승인 상태, 저장 QA 위조, 현재 QA 실패를 fail-closed 처리한다", async () => {
  const record = await createRealSourceRecord();
  assert.throws(
    () => validateMobilePreviewRecord({ ...record, fixtureOnly: true }, "fixture.json"),
    /offline fixture/,
  );
  assert.throws(
    () =>
      validateMobilePreviewRecord(
        {
          ...record,
          deck: { ...record.deck, status: "approved" },
          workflow: { ...record.workflow, state: "approved" },
        },
        "approved.json",
      ),
    /awaiting-human-approval/,
  );
  assert.throws(
    () =>
      validateMobilePreviewRecord(
        { ...record, qa: { ...record.qa, safety: { stage: "safety", passed: true, findingCount: 1 } } },
        "qa.json",
      ),
    /safety QA/,
  );
  assert.throws(
    () =>
      validateMobilePreviewRecord(
        {
          ...record,
          cards: record.cards.map((card, index) =>
            index === 0 ? { ...card, back: "무조건 합격" } : card,
          ),
        },
        "tampered.json",
      ),
    /safety QA 실패/,
  );
});

test("Preview Metro는 index 요청만 별도 entry로 바꾸고 production import는 격리한다", async () => {
  const require = createRequire(import.meta.url);
  const { rewritePreviewRequestUrl } = require(
    path.join(REPO_ROOT, "apps", "mobile", "preview-request-url.js"),
  );
  assert.equal(
    rewritePreviewRequestUrl("/index.bundle?platform=ios&dev=true"),
    "/index.preview.bundle?platform=ios&dev=true",
  );
  assert.equal(rewritePreviewRequestUrl("/index.map?platform=android"), "/index.preview.map?platform=android");
  assert.equal(rewritePreviewRequestUrl("/index.preview.bundle?platform=ios"), "/index.preview.bundle?platform=ios");
  assert.equal(rewritePreviewRequestUrl("/status"), "/status");

  const productionEntry = await readFile(path.join(REPO_ROOT, "apps", "mobile", "index.js"), "utf8");
  const productionApp = await readFile(path.join(REPO_ROOT, "apps", "mobile", "App.tsx"), "utf8");
  const previewEntry = await readFile(path.join(REPO_ROOT, "apps", "mobile", "index.preview.js"), "utf8");
  const mobilePackage = JSON.parse(
    await readFile(path.join(REPO_ROOT, "apps", "mobile", "package.json"), "utf8"),
  );
  const appDelegate = await readFile(
    path.join(REPO_ROOT, "apps", "mobile", "ios", "Daoewo", "AppDelegate.swift"),
    "utf8",
  );
  const previewXcconfig = await readFile(
    path.join(REPO_ROOT, "apps", "mobile", "ios", "Preview.xcconfig"),
    "utf8",
  );
  assert.doesNotMatch(productionEntry, /preview|\.work/i);
  assert.doesNotMatch(productionApp, /preview|\.work/i);
  assert.match(previewEntry, /__DEV__/);
  assert.match(previewEntry, /PreviewApp/);
  assert.match(mobilePackage.scripts["ios:preview"], /--xcconfig Preview\.xcconfig/);
  assert.match(previewXcconfig, /DAOEWO_CONTENT_PREVIEW/);
  assert.match(previewXcconfig, /ENTRY_FILE = index\.preview\.js/);
  assert.match(previewXcconfig, /BUNDLE_NAME = preview/);
  assert.match(previewXcconfig, /FORCE_BUNDLING = YES/);
  assert.match(appDelegate, /#if DEBUG && DAOEWO_CONTENT_PREVIEW/);
  assert.match(appDelegate, /index\.preview\.bundle/);
  assert.match(appDelegate, /components\.port = 8082/);
  assert.match(appDelegate, /RCTBundleURLProvider\.isPackagerRunning\(previewMetroHost\)/);
  assert.match(appDelegate, /url\(forResource: "preview", withExtension: "jsbundle"\)/);
  assert.match(appDelegate, /#else\n    Bundle\.main\.url\(forResource: "main", withExtension: "jsbundle"\)/);
});
