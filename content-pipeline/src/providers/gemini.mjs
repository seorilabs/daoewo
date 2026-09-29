const DEFAULT_TEXT_MODEL = "gemini-2.5-flash";
const API_ROOT = "https://generativelanguage.googleapis.com/v1beta";

function requireApiKey(env) {
  const key = env.GEMINI_API_KEY;
  if (typeof key !== "string" || key.length < 8) {
    throw new Error("GEMINI_API_KEY가 필요하다. 키 값은 출력하지 않는다.");
  }
  return key;
}

function extractJson(text) {
  const unfenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Gemini 응답에 JSON 객체가 없다.");
  return JSON.parse(unfenced.slice(start, end + 1));
}

function tokenCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function sanitizeUsage(payload) {
  const usage = payload?.usageMetadata ?? {};
  return Object.freeze({
    promptTokenCount: tokenCount(usage.promptTokenCount),
    candidatesTokenCount: tokenCount(usage.candidatesTokenCount),
    thoughtsTokenCount: tokenCount(usage.thoughtsTokenCount),
    totalTokenCount: tokenCount(usage.totalTokenCount),
  });
}

function assertBatchResponse(raw, { deckId, slotId, requestedCount, allowedSourceIds }) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Gemini batch 응답은 JSON 객체여야 한다.");
  }
  const allowedTopLevel = new Set(["deckId", "slotId", "cards"]);
  const unexpected = Object.keys(raw).filter((key) => !allowedTopLevel.has(key));
  if (unexpected.length > 0) {
    throw new Error(`Gemini batch 응답에 허용되지 않은 필드가 있다: ${unexpected.join(", ")}`);
  }
  if (raw.deckId !== deckId || raw.slotId !== slotId) {
    throw new Error("Gemini batch 응답의 deckId 또는 slotId가 요청과 다르다.");
  }
  if (!Array.isArray(raw.cards) || raw.cards.length < 1 || raw.cards.length > requestedCount) {
    throw new Error(`Gemini batch 응답 cards는 1~${requestedCount}장이어야 한다.`);
  }

  const allowedCardKeys = new Set([
    "front",
    "back",
    "hint",
    "reading",
    "example",
    "exampleMeaning",
    "tags",
    "difficulty",
    "sourceRefs",
  ]);
  for (const [index, card] of raw.cards.entries()) {
    if (card === null || typeof card !== "object" || Array.isArray(card)) {
      throw new Error(`Gemini batch cards[${index}]는 객체여야 한다.`);
    }
    const invalidKeys = Object.keys(card).filter((key) => !allowedCardKeys.has(key));
    if (invalidKeys.length > 0) {
      throw new Error(`Gemini batch cards[${index}]에 허용되지 않은 필드가 있다: ${invalidKeys.join(", ")}`);
    }
    if (
      !Array.isArray(card.sourceRefs) ||
      card.sourceRefs.length === 0 ||
      new Set(card.sourceRefs).size !== card.sourceRefs.length
    ) {
      throw new Error(`Gemini batch cards[${index}].sourceRefs가 없거나 중복됐다.`);
    }
    for (const sourceRef of card.sourceRefs) {
      if (!allowedSourceIds.has(sourceRef)) {
        throw new Error(`Gemini batch cards[${index}]가 plan allowlist 밖 sourceRef를 사용했다.`);
      }
    }
  }
  return raw;
}

function batchResponseSchema({ deckId, slotId, requestedCount, allowedSourceIds }) {
  const sourceEnum = [...allowedSourceIds];
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      deckId: {
        type: "string",
        enum: [deckId],
        description: "The exact operator-provided deck ID.",
      },
      slotId: {
        type: "string",
        enum: [slotId],
        description: "The exact operator-provided coverage slot ID.",
      },
      cards: {
        type: "array",
        description: `Generate exactly ${requestedCount} distinct cards.`,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            front: { type: "string", description: "Concise card question, term, or prompt." },
            back: { type: "string", description: "Concise Korean answer or explanation written in original wording." },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Short classification tags.",
            },
            difficulty: {
              type: "integer",
              enum: [1, 2, 3, 4, 5],
              description: "Integer difficulty where 1 is easiest and 5 is hardest.",
            },
            sourceRefs: {
              type: "array",
              items: { type: "string", enum: sourceEnum },
              description: "One or more exact source IDs from this coverage slot.",
            },
          },
          required: ["front", "back", "tags", "difficulty", "sourceRefs"],
        },
      },
    },
    required: ["deckId", "slotId", "cards"],
  };
}

export class GeminiRequestError extends Error {
  constructor(status) {
    super(`Gemini 텍스트 요청 실패(status=${status}). 응답 본문과 키는 출력하지 않는다.`);
    this.name = "GeminiRequestError";
    this.status = status;
    this.retryable = status === 408 || status === 429 || status >= 500;
  }
}

export class GeminiTextGenerator {
  constructor({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
    this.name = "gemini-operator-batch-v2";
    this.env = env;
    this.fetchImpl = fetchImpl;
    this.model = env.GEMINI_TEXT_MODEL || DEFAULT_TEXT_MODEL;
    if (this.model.startsWith("imagen-")) throw new Error("텍스트 생성 모델에 Imagen 모델을 사용할 수 없다.");
  }

  async generateBatch({ deck, slot, sources, requestedCount, excludedFronts = [] }) {
    const apiKey = requireApiKey(this.env);
    if (
      slot === undefined ||
      !Array.isArray(sources) ||
      sources.length === 0 ||
      !Number.isInteger(requestedCount) ||
      requestedCount < 1 ||
      requestedCount > 20
    ) {
      throw new Error("Gemini batch 생성에는 plan slot, source allowlist, 1~20 requestedCount가 필요하다.");
    }
    const planSources = new Map(sources.map((source) => [source.id, source]));
    const slotSources = slot.sourceIds.map((sourceId) => planSources.get(sourceId));
    if (slotSources.some((source) => source === undefined)) {
      throw new Error("coverage slot이 plan allowlist 밖 source를 참조한다.");
    }

    const endpoint = `${API_ROOT}/models/${encodeURIComponent(this.model)}:generateContent`;
    const prompt = [
      "You are an operator-side batch content author for Daoewo. This is not a user on-demand API.",
      "Return one JSON object only. Do not quote or reproduce textbook, exam-question, answer-choice, or paid-course wording.",
      "The operator owns the source registry. Never create, rename, or return a sourceRegistry field.",
      "Every card must use one or more sourceRefs from the exact allowed source IDs below. Do not invent source IDs.",
      "Do not claim official affiliation, guaranteed pass, medical benefit, or financial outcome.",
      `Deck id: ${deck.id}`,
      `Title: ${deck.title}`,
      `Description: ${deck.description}`,
      `Recipe: ${deck.provenance.recipe}`,
      `Coverage slot id: ${slot.id}`,
      `Coverage instruction: ${slot.instruction}`,
      `Allowed sources: ${JSON.stringify(slotSources.map((source) => ({ id: source.id, authority: source.authority, uri: source.uri, revision: source.revision, scope: source.scope })))}`,
      `Already accepted fronts to avoid: ${JSON.stringify(excludedFronts.slice(-100))}`,
      "Shape: {deckId,slotId,cards:[{front,back,hint?,reading?,example?,exampleMeaning?,tags,difficulty,sourceRefs}]}",
      "difficulty must be an integer from 1 to 5, never a label such as easy or hard.",
      "sourceRefs must contain only exact source ID strings shown in Allowed sources.",
      "Every front in this response must be unique and must not repeat or closely copy an Already accepted front.",
      `Generate exactly ${requestedCount} distinct cards for this slot. Human factual review is mandatory before publication.`,
    ].join("\n");

    const responseSchema = batchResponseSchema({
      deckId: deck.id,
      slotId: slot.id,
      requestedCount,
      allowedSourceIds: slot.sourceIds,
    });

    const response = await this.fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: responseSchema,
          temperature: 0.2,
          maxOutputTokens: 16384,
          thinkingConfig: { thinkingBudget: 512 },
        },
      }),
    });

    if (!response.ok) throw new GeminiRequestError(response.status);
    const payload = await response.json();
    const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    const raw = assertBatchResponse(extractJson(text), {
      deckId: deck.id,
      slotId: slot.id,
      requestedCount,
      allowedSourceIds: new Set(slot.sourceIds),
    });
    return Object.freeze({
      raw,
      usage: sanitizeUsage(payload),
      model: this.model,
      responseId: typeof payload?.responseId === "string" ? payload.responseId : null,
    });
  }

  async generate({ deck, slot, sources, requestedCount = 20, excludedFronts = [] }) {
    if (slot === undefined || sources === undefined) {
      throw new Error("Gemini 단일 run은 sourceRegistry 생성을 허용하지 않는다. tracked batch plan을 사용한다.");
    }
    return (await this.generateBatch({ deck, slot, sources, requestedCount, excludedFronts })).raw;
  }
}

export { DEFAULT_TEXT_MODEL };
