import path from "node:path";
import { readJson } from "../io.mjs";

/**
 * 운영자가 오프라인으로 작성해 repo에 커밋한 batch 파일을 파이프라인에 넣는다.
 * Gemini adapter와 같은 자리의 입력 provider일 뿐이며, 결과는 동일하게
 * normalize/dedupe/QA를 거쳐 `awaiting-human-approval`에서 멈춘다.
 */
export class OperatorBatchGenerator {
  constructor({ inputFile, name = "claude-operator-batch-v1" }) {
    if (typeof inputFile !== "string" || inputFile.trim().length === 0) {
      throw new Error("운영자 batch 파일 경로(--input)가 필요하다.");
    }
    this.name = name;
    this.inputFile = path.resolve(inputFile);
  }

  async generate({ deck }) {
    if (deck.contentStrategy !== "ai-assisted-operator-batch") {
      throw new Error(`${deck.id}는 ai-assisted-operator-batch 덱이 아니다.`);
    }
    const raw = await readJson(this.inputFile);
    if (raw?.deckId !== deck.id) {
      throw new Error(`batch 파일의 deckId(${raw?.deckId})가 대상 덱(${deck.id})과 다르다.`);
    }
    if (raw.fixtureOnly === true) {
      throw new Error("fixtureOnly batch는 offline provider 경로를 써야 한다.");
    }
    if (!Array.isArray(raw.sourceRegistry) || raw.sourceRegistry.length === 0) {
      throw new Error("batch 파일에 revision이 고정된 sourceRegistry가 필요하다.");
    }
    return raw;
  }
}
