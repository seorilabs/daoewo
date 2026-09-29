import assert from "node:assert/strict";
import test from "node:test";
import { parseOperatorEnvFile, resolveGeminiOperatorEnv } from "../src/operator-credentials.mjs";

test("유료 Gemini key를 GEMINI_API_KEY로 메모리에서만 매핑한다", async () => {
  const secret = "paid-test-secret-never-print";
  const resolved = await resolveGeminiOperatorEnv({
    env: { GEMINI_TEXT_MODEL: "gemini-test" },
    home: "/not-used",
    readFileImpl: async (filePath) => {
      assert.match(filePath, /\.config\/seorilabs\/gemini-api-key\.env$/);
      return `export GEMINI_API_KEY_WITH_PAYMENT='${secret}'\n`;
    },
  });
  assert.equal(resolved.GEMINI_API_KEY, secret);
  assert.equal(resolved.GEMINI_API_KEY_WITH_PAYMENT, undefined);
});

test("operator env parser는 shell 실행 없이 정확한 key 한 줄만 읽는다", () => {
  assert.equal(
    parseOperatorEnvFile("UNRELATED=value\nGEMINI_API_KEY_WITH_PAYMENT=abcdefgh12345678\n"),
    "abcdefgh12345678",
  );
  assert.throws(
    () => parseOperatorEnvFile("GEMINI_API_KEY_WITH_PAYMENT=short\n"),
    (error) => !error.message.includes("short"),
  );
});

test("이미 주입된 GEMINI_API_KEY를 우선하고 credential 파일을 읽지 않는다", async () => {
  let reads = 0;
  const resolved = await resolveGeminiOperatorEnv({
    env: { GEMINI_API_KEY: "existing-secret-value" },
    readFileImpl: async () => {
      reads += 1;
      throw new Error("unexpected");
    },
  });
  assert.equal(resolved.GEMINI_API_KEY, "existing-secret-value");
  assert.equal(reads, 0);
});
