import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_TEXT_MODEL, GeminiTextGenerator } from "../src/providers/gemini.mjs";
import { DEFAULT_IMAGEN_MODEL, ImagenGenerator } from "../src/providers/imagen.mjs";

const deck = {
  id: "it-cs-interview-terms",
  title: "IT/CS 면접 용어",
  description: "테스트",
  provenance: { recipe: "테스트 recipe" },
};

test("Gemini adapter는 GEMINI_API_KEY를 환경에서만 읽고 모델을 환경변수로 바꾼다", async () => {
  assert.equal(new GeminiTextGenerator({ env: {}, fetchImpl: async () => null }).model, DEFAULT_TEXT_MODEL);
  await assert.rejects(() => new GeminiTextGenerator({ env: {}, fetchImpl: async () => null }).generate({ deck }), /GEMINI_API_KEY/);

  const secret = "test-secret-never-log";
  let request;
  const generator = new GeminiTextGenerator({
    env: { GEMINI_API_KEY: secret, GEMINI_TEXT_MODEL: "gemini-test-model" },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        async json() {
          return { candidates: [{ content: { parts: [{ text: JSON.stringify({ deckId: deck.id, sourceRegistry: [], cards: [] }) }] } }] };
        },
      };
    },
  });
  const result = await generator.generate({ deck });
  assert.equal(result.deckId, deck.id);
  assert.equal(request.options.headers["x-goog-api-key"], secret);
  assert.equal(request.url.includes(secret), false);
  assert.match(request.url, /gemini-test-model/);
});

test("Gemini 실패 메시지는 키와 응답 본문을 노출하지 않는다", async () => {
  const secret = "test-secret-never-log";
  const generator = new GeminiTextGenerator({
    env: { GEMINI_API_KEY: secret },
    fetchImpl: async () => ({ ok: false, status: 403, async text() { return `body ${secret}`; } }),
  });
  await assert.rejects(
    () => generator.generate({ deck }),
    (error) => error.message.includes("status=403") && !error.message.includes(secret) && !error.message.includes("body"),
  );
});

test("이미지 adapter는 IMAGEN_MODEL 기본값의 Imagen만 허용한다", async () => {
  assert.equal(new ImagenGenerator({ env: {}, fetchImpl: async () => null }).model, DEFAULT_IMAGEN_MODEL);
  assert.throws(() => new ImagenGenerator({ env: { IMAGEN_MODEL: "gemini-2.5-flash" } }), /Imagen 모델만/);

  let request;
  const generator = new ImagenGenerator({
    env: { GEMINI_API_KEY: "test-secret-never-log", IMAGEN_MODEL: "imagen-test-model" },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        async json() {
          return { predictions: [{ bytesBase64Encoded: Buffer.from("png").toString("base64"), mimeType: "image/png" }] };
        },
      };
    },
  });
  const result = await generator.generate({ prompt: "flat educational card artwork" });
  assert.equal(result.bytes.toString(), "png");
  assert.match(request.url, /imagen-test-model/);
});

test("운영자 batch provider는 덱 불일치, fixtureOnly, registry 누락을 거부한다", async (t) => {
  const { OperatorBatchGenerator } = await import("../src/providers/operator-batch.mjs");
  const { writeFile, mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");

  const workDir = await mkdtemp(path.join(tmpdir(), "daoewo-batch-test-"));
  t.after(() => rm(workDir, { recursive: true, force: true }));
  const batchPath = path.join(workDir, "batch.json");
  const batchDeck = { id: "wine-basics", contentStrategy: "ai-assisted-operator-batch" };
  const write = (payload) => writeFile(batchPath, JSON.stringify(payload));

  assert.throws(() => new OperatorBatchGenerator({ inputFile: "" }), /--input/);

  const generator = new OperatorBatchGenerator({ inputFile: batchPath });
  assert.equal(generator.name, "claude-operator-batch-v1");

  await assert.rejects(
    () => generator.generate({ deck: { ...batchDeck, contentStrategy: "vocab-swipe-import" } }),
    /ai-assisted-operator-batch 덱이 아니다/,
  );

  await write({ deckId: "other-deck", sourceRegistry: [{ id: "s" }], cards: [] });
  await assert.rejects(() => generator.generate({ deck: batchDeck }), /deckId/);

  await write({ deckId: "wine-basics", fixtureOnly: true, sourceRegistry: [{ id: "s" }], cards: [] });
  await assert.rejects(() => generator.generate({ deck: batchDeck }), /fixtureOnly/);

  await write({ deckId: "wine-basics", sourceRegistry: [], cards: [] });
  await assert.rejects(() => generator.generate({ deck: batchDeck }), /sourceRegistry/);

  await write({ deckId: "wine-basics", sourceRegistry: [{ id: "s", uri: "urn:x", revision: "v1" }], cards: [{ front: "f" }] });
  const raw = await generator.generate({ deck: batchDeck });
  assert.equal(raw.cards.length, 1);
});
