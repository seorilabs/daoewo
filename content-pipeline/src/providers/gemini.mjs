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

export class GeminiTextGenerator {
  constructor({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
    this.name = "gemini-operator-batch-v1";
    this.env = env;
    this.fetchImpl = fetchImpl;
    this.model = env.GEMINI_TEXT_MODEL || DEFAULT_TEXT_MODEL;
    if (this.model.startsWith("imagen-")) throw new Error("텍스트 생성 모델에 Imagen 모델을 사용할 수 없다.");
  }

  async generate({ deck }) {
    const apiKey = requireApiKey(this.env);
    const endpoint = `${API_ROOT}/models/${encodeURIComponent(this.model)}:generateContent`;
    const prompt = [
      "You are an operator-side batch content author for Daoewo. This is not a user on-demand API.",
      "Return one JSON object only. Do not quote or reproduce textbook, exam-question, answer-choice, or paid-course wording.",
      "Every factual card must include sourceRefs pointing to a source registry entry that an operator will pin and review.",
      "Do not claim official affiliation, guaranteed pass, medical benefit, or financial outcome.",
      `Deck id: ${deck.id}`,
      `Title: ${deck.title}`,
      `Description: ${deck.description}`,
      `Recipe: ${deck.provenance.recipe}`,
      "Shape: {deckId, sourceRegistry:[{id,kind,uri,revision}], referenceTexts:[], cards:[{front,back,hint?,reading?,example?,exampleMeaning?,tags,difficulty,sourceRefs}]}",
      "Generate a review-sized operator batch of 20 cards. Human approval is mandatory before publication.",
    ].join("\n");

    const response = await this.fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini 텍스트 요청 실패(status=${response.status}, model=${this.model}). 응답 본문과 키는 출력하지 않는다.`);
    }
    const payload = await response.json();
    const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    return extractJson(text);
  }
}

export { DEFAULT_TEXT_MODEL };
