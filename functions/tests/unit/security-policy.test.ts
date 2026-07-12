import { describe, expect, it } from "vitest";
import { requiresRevocationCheckForHttpPath } from "../../src/security-policy.js";

describe("HTTP revocation-check policy", () => {
  it.each([
    "/v1/goals:createOrReset",
    "/v1/goals:deactivate",
    "/v1/sync:pull",
    "/v1/windows:today",
    "/v1/progress:batchSubmit",
    "/v1/deckRequests:create",
    "/v1/receipts:verify",
    "/v1/auth:mergeAnonymous",
    "/v1/account:delete",
  ])("requires a non-revoked token for %s", (path) => {
    expect(requiresRevocationCheckForHttpPath(path)).toBe(true);
  });

  it.each(["/v1/catalog", "/v1/entitlement", "/v1/unknown"])(
    "does not add an Auth backend round trip for read/unknown path %s",
    (path) => {
      expect(requiresRevocationCheckForHttpPath(path)).toBe(false);
    },
  );
});
