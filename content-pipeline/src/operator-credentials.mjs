import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const PAID_KEY_NAME = "GEMINI_API_KEY_WITH_PAYMENT";

function unquote(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseOperatorEnvFile(contents) {
  for (const line of String(contents).split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?GEMINI_API_KEY_WITH_PAYMENT\s*=\s*(.*?)\s*$/);
    if (match !== null) {
      const value = unquote(match[1]);
      if (value.length >= 8 && !/[\r\n]/.test(value)) return value;
      break;
    }
  }
  throw new Error(`${PAID_KEY_NAME}가 operator credential 파일에 없다.`);
}

/**
 * 유료 operator key를 Gemini adapter가 기대하는 이름으로 메모리에서만 매핑한다.
 * 파일을 source/eval하지 않으며 key 값은 오류나 로그에 포함하지 않는다.
 */
export async function resolveGeminiOperatorEnv({
  env = process.env,
  home = homedir(),
  readFileImpl = readFile,
} = {}) {
  if (typeof env.GEMINI_API_KEY === "string" && env.GEMINI_API_KEY.length >= 8) {
    return { ...env, GEMINI_API_KEY: env.GEMINI_API_KEY };
  }
  if (typeof env[PAID_KEY_NAME] === "string" && env[PAID_KEY_NAME].length >= 8) {
    return { ...env, GEMINI_API_KEY: env[PAID_KEY_NAME] };
  }

  const credentialPath = path.join(home, ".config", "seorilabs", "gemini-api-key.env");
  let contents;
  try {
    contents = await readFileImpl(credentialPath, "utf8");
  } catch {
    throw new Error("Gemini operator credential 파일을 읽을 수 없다.");
  }
  return { ...env, GEMINI_API_KEY: parseOperatorEnvFile(contents) };
}
