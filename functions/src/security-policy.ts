const MUTATION_HTTP_PATHS = new Set([
  "/v1/goals:createOrReset",
  "/v1/goals:deactivate",
  // pull도 Free primary-device binding과 lastSeenAt을 갱신한다.
  "/v1/sync:pull",
  "/v1/windows:today",
  "/v1/progress:batchSubmit",
  "/v1/deckRequests:create",
  "/v1/receipts:verify",
  "/v1/auth:mergeAnonymous",
]);

export function requiresRevocationCheckForHttpPath(path: string): boolean {
  return path === "/v1/account:delete" || MUTATION_HTTP_PATHS.has(path);
}
