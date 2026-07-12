import type { Entitlement } from "@daoewo/product-core";
import { BackendError } from "../errors.js";

export interface VersionedEntitlementProjection {
  version: string;
  entitlement: Entitlement;
}

export async function convergeEntitlementCustomClaims(input: {
  readProjection(): Promise<VersionedEntitlementProjection | null>;
  readCustomClaims(): Promise<Record<string, unknown>>;
  writeCustomClaims(claims: Record<string, unknown>): Promise<void>;
  now: Date;
  maxAttempts?: number;
}): Promise<void> {
  const maxAttempts = input.maxAttempts ?? 4;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const before = await input.readProjection();
    if (before === null) return;
    const existing = await input.readCustomClaims();
    await input.writeCustomClaims({
      ...existing,
      daoewoPlan: isProjectionActive(before.entitlement, input.now)
        ? "pro"
        : "free",
      daoewoProUntil: before.entitlement.validUntil,
    });
    const after = await input.readProjection();
    if (after === null || after.version === before.version) return;
  }
  throw new BackendError(
    "aborted",
    "Entitlement custom claims changed concurrently and must be retried.",
    { kind: "entitlement-claims-convergence" },
  );
}

function isProjectionActive(entitlement: Entitlement, now: Date): boolean {
  if (entitlement.plan !== "pro") return false;
  return (
    entitlement.validUntil === null ||
    Date.parse(entitlement.validUntil) > now.getTime()
  );
}
