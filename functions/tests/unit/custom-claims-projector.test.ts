import { describe, expect, it } from "vitest";
import {
  convergeEntitlementCustomClaims,
  type VersionedEntitlementProjection,
} from "../../src/store-notifications/custom-claims-projector.js";

const NOW = new Date("2026-07-12T00:00:00.000Z");

describe("convergeEntitlementCustomClaims", () => {
  it("converges to the newest Firestore projection when an older Pro write finishes last", async () => {
    let projection: VersionedEntitlementProjection = {
      version: "active-v1",
      entitlement: {
        plan: "pro",
        source: "google-play",
        validUntil: "2026-08-12T00:00:00.000Z",
      },
    };
    let claims: Record<string, unknown> = { unrelated: "preserved" };
    const firstProWriteStarted = deferred<void>();
    const releaseFirstProWrite = deferred<void>();
    let blockedFirstProWrite = false;

    const project = () =>
      convergeEntitlementCustomClaims({
        readProjection: async () => projection,
        readCustomClaims: async () => claims,
        writeCustomClaims: async (next) => {
          if (next.daoewoPlan === "pro" && !blockedFirstProWrite) {
            blockedFirstProWrite = true;
            firstProWriteStarted.resolve();
            await releaseFirstProWrite.promise;
          }
          claims = next;
        },
        now: NOW,
      });

    const olderProjection = project();
    await firstProWriteStarted.promise;

    projection = {
      version: "revoked-v2",
      entitlement: {
        plan: "free",
        source: "google-play",
        validUntil: null,
      },
    };
    await project();
    expect(claims).toMatchObject({ daoewoPlan: "free" });

    releaseFirstProWrite.resolve();
    await olderProjection;
    expect(claims).toEqual({
      unrelated: "preserved",
      daoewoPlan: "free",
      daoewoProUntil: null,
    });
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
