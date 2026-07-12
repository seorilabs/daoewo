import { Buffer } from "node:buffer";

export const DEFAULT_IMAGEN_MODEL = "imagen-4.0-generate-001";
const API_ROOT = "https://generativelanguage.googleapis.com/v1beta";

export class ImagenGenerator {
  constructor({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
    this.name = "imagen-operator-batch-v1";
    this.env = env;
    this.fetchImpl = fetchImpl;
    this.model = env.IMAGEN_MODEL || DEFAULT_IMAGEN_MODEL;
    if (!this.model.startsWith("imagen-")) {
      throw new Error("이미지 생성은 IMAGEN_MODEL의 Imagen 모델만 허용한다.");
    }
  }

  async generate({ prompt, aspectRatio = "1:1" }) {
    const apiKey = this.env.GEMINI_API_KEY;
    if (typeof apiKey !== "string" || apiKey.length < 8) {
      throw new Error("Imagen 실행에는 GEMINI_API_KEY가 필요하다. 키 값은 출력하지 않는다.");
    }
    if (typeof prompt !== "string" || prompt.trim().length < 8) throw new Error("이미지 prompt가 너무 짧다.");

    const endpoint = `${API_ROOT}/models/${encodeURIComponent(this.model)}:predict`;
    const response = await this.fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        instances: [{ prompt: prompt.trim() }],
        parameters: { sampleCount: 1, aspectRatio },
      }),
    });
    if (!response.ok) {
      throw new Error(`Imagen 요청 실패(status=${response.status}, model=${this.model}). 응답 본문과 키는 출력하지 않는다.`);
    }
    const payload = await response.json();
    const prediction = payload?.predictions?.[0];
    const encoded = prediction?.bytesBase64Encoded ?? prediction?.image?.bytesBase64Encoded;
    if (typeof encoded !== "string") throw new Error("Imagen 응답에 이미지 바이트가 없다.");
    return {
      bytes: Buffer.from(encoded, "base64"),
      mimeType: prediction?.mimeType ?? prediction?.mime_type ?? "image/png",
      model: this.model,
    };
  }
}
