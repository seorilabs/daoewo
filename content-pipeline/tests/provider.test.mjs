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
