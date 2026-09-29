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
const slot = {
  id: "networking-01",
  instruction: "HTTP 핵심 개념",
  sourceIds: ["rfc-http"],
};
const sources = [{
  id: "rfc-http",
  authority: "RFC Editor",
  uri: "https://www.rfc-editor.org/rfc/rfc9110.html",
  revision: "RFC9110",
  scope: "HTTP",
}];
const rawCard = {
  front: "HTTP GET은 무엇인가?",
  back: "대상 리소스의 현재 표현 전송을 요청하는 메서드다.",
  tags: ["HTTP"],
  difficulty: 2,
  sourceRefs: ["rfc-http"],
};

test("Gemini adapter는 GEMINI_API_KEY를 환경에서만 읽고 모델을 환경변수로 바꾼다", async () => {
  assert.equal(new GeminiTextGenerator({ env: {}, fetchImpl: async () => null }).model, DEFAULT_TEXT_MODEL);
  await assert.rejects(
    () => new GeminiTextGenerator({ env: {}, fetchImpl: async () => null }).generateBatch({ deck, slot, sources, requestedCount: 1 }),
    /GEMINI_API_KEY/,
  );

  const secret = "test-secret-never-log";
  let request;
  const generator = new GeminiTextGenerator({
    env: { GEMINI_API_KEY: secret, GEMINI_TEXT_MODEL: "gemini-test-model" },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        async json() {
          return {
            responseId: "response-safe-id",
            candidates: [{ content: { parts: [{ text: JSON.stringify({ deckId: deck.id, slotId: slot.id, cards: [rawCard] }) }] } }],
            usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, thoughtsTokenCount: 10, totalTokenCount: 160 },
          };
        },
      };
    },
  });
  const result = await generator.generateBatch({ deck, slot, sources, requestedCount: 1 });
  assert.equal(result.raw.deckId, deck.id);
  assert.equal(result.raw.slotId, slot.id);
  assert.equal(result.usage.totalTokenCount, 160);
  assert.equal(request.options.headers["x-goog-api-key"], secret);
  assert.equal(request.url.includes(secret), false);
  assert.match(request.url, /gemini-test-model/);
  const requestBody = JSON.parse(request.options.body);
  assert.equal(requestBody.contents[0].parts[0].text.includes("Allowed sources"), true);
  assert.equal(requestBody.generationConfig.responseMimeType, "application/json");
  const schema = requestBody.generationConfig.responseJsonSchema;
  assert.match(schema.properties.cards.description, /exactly 1/);
  assert.deepEqual(schema.properties.cards.items.properties.difficulty.enum, [1, 2, 3, 4, 5]);
  assert.deepEqual(schema.properties.cards.items.properties.sourceRefs.items.enum, ["rfc-http"]);
  assert.equal(schema.properties.cards.items.additionalProperties, false);
});

test("Gemini 실패 메시지는 키와 응답 본문을 노출하지 않는다", async () => {
  const secret = "test-secret-never-log";
  const generator = new GeminiTextGenerator({
    env: { GEMINI_API_KEY: secret },
    fetchImpl: async () => ({ ok: false, status: 403, async text() { return `body ${secret}`; } }),
  });
  await assert.rejects(
    () => generator.generateBatch({ deck, slot, sources, requestedCount: 1 }),
    (error) => error.message.includes("status=403") && !error.message.includes(secret) && !error.message.includes("body"),
  );
});

test("Gemini batch 응답은 model이 만든 sourceRegistry와 plan 밖 sourceRef를 거부한다", async () => {
  const responses = [
    { deckId: deck.id, slotId: slot.id, sourceRegistry: sources, cards: [rawCard] },
    { deckId: deck.id, slotId: slot.id, cards: [{ ...rawCard, sourceRefs: ["invented-source"] }] },
  ];
  for (const response of responses) {
    const generator = new GeminiTextGenerator({
      env: { GEMINI_API_KEY: "test-secret-never-log" },
      fetchImpl: async () => ({
        ok: true,
        async json() {
          return { candidates: [{ content: { parts: [{ text: JSON.stringify(response) }] } }] };
        },
      }),
    });
    await assert.rejects(
      () => generator.generateBatch({ deck, slot, sources, requestedCount: 1 }),
      /허용되지 않은 필드|allowlist 밖 sourceRef/,
    );
  }
});

test("legacy Gemini 단일 run은 sourceRegistry 생성 경로를 닫는다", async () => {
  const generator = new GeminiTextGenerator({ env: { GEMINI_API_KEY: "test-secret-never-log" } });
  await assert.rejects(() => generator.generate({ deck }), /tracked batch plan/);
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
