import {
  APIError,
  APIException,
} from "@apple/app-store-server-library";
import { describe, expect, it } from "vitest";
import { normalizeAppleApiError } from "../../src/receipts/runtime-providers.js";

describe("Apple runtime API error normalization", () => {
  it.each([
    APIError.ACCOUNT_NOT_FOUND_RETRYABLE,
    APIError.APP_NOT_FOUND_RETRYABLE,
    APIError.ORIGINAL_TRANSACTION_ID_NOT_FOUND_RETRYABLE,
    APIError.GENERAL_INTERNAL_RETRYABLE,
    APIError.RATE_LIMIT_EXCEEDED,
  ])("keeps retryable APIError %s retryable", (apiError) => {
    expect(normalizeAppleApiError(new APIException(404, apiError)).kind).toBe(
      "unavailable",
    );
  });

  it("keeps a non-retryable missing transaction distinct", () => {
    expect(
      normalizeAppleApiError(
        new APIException(404, APIError.TRANSACTION_ID_NOT_FOUND),
      ).kind,
    ).toBe("not-found");
  });
});
