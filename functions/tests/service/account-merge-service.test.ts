import { describe, expect, it } from "vitest";
import { BackendError } from "../../src/errors.js";
import { AccountMergeService } from "../../src/services/account-merge-service.js";

describe("AccountMergeService", () => {
  it("merges a verified anonymous source into a Google target", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const service = new AccountMergeService(
      {
        verifyIdToken: async (token, checkRevoked) => {
          calls.push({ token, checkRevoked });
          return token === "source-token"
            ? { uid: "anonymous-uid", firebase: { sign_in_provider: "anonymous" } }
            : { uid: "google-uid", firebase: { sign_in_provider: "google.com" } };
        },
        getUser: async () => ({ providerData: [] }),
      },
      {
        assertAccountActive: async () => undefined,
        getAccountMergeResult: async () => null,
        mergeAnonymousAccount: async (input: {
          sourceUid: string;
          targetUid: string;
          deviceHash: string;
          now: Date;
        }) => ({
          merged: true,
          goalCount: 2,
          progressDeckCount: 2,
          entitlementMoved: true,
          input,
        }),
      } as never,
      { now: () => new Date("2026-07-12T00:00:00.000Z") },
    );

    const result = await service.merge("google-uid", {
      sourceIdToken: "source-token",
      targetIdToken: "target-token",
      deviceId: "stable-device-id-1234",
    });

    expect(result).toMatchObject({
      merged: true,
      goalCount: 2,
      progressDeckCount: 2,
      entitlementMoved: true,
    });
    expect(calls).toEqual([
      { token: "source-token", checkRevoked: false },
      { token: "target-token", checkRevoked: true },
      { token: "source-token", checkRevoked: true },
    ]);
  });

  it("does not copy state when Firebase link retained the same uid", async () => {
    let mergeCalled = false;
    const service = new AccountMergeService(
      {
        verifyIdToken: async (token) => ({
          uid: "same-uid",
          firebase: {
            sign_in_provider: token === "source-token" ? "anonymous" : "apple.com",
          },
        }),
        getUser: async () => ({ providerData: [] }),
      },
      {
        assertAccountActive: async () => undefined,
        getAccountMergeResult: async () => null,
        mergeAnonymousAccount: async () => {
          mergeCalled = true;
          throw new Error("must not run");
        },
      },
      { now: () => new Date("2026-07-12T00:00:00.000Z") },
    );

    await expect(
      service.merge("same-uid", {
        sourceIdToken: "source-token",
        targetIdToken: "target-token",
        deviceId: "stable-device-id-1234",
      }),
    ).resolves.toEqual({ merged: false, sameAccount: true });
    expect(mergeCalled).toBe(false);
  });

  it("rejects a non-anonymous source and propagates repository conflicts", async () => {
    let mergeAttempts = 0;
    const repository = {
      assertAccountActive: async () => undefined,
      getAccountMergeResult: async () => null,
      mergeAnonymousAccount: async () => {
        mergeAttempts += 1;
        throw new BackendError(
          "failed-precondition",
          "Source and target accounts have conflicting store entitlements.",
          { kind: "entitlement-ownership-conflict" },
        );
      },
    };
    const invalidSource = new AccountMergeService(
      {
        verifyIdToken: async (token) => ({
          uid: token === "source-token" ? "email-uid" : "google-uid",
          firebase: {
            sign_in_provider: token === "source-token" ? "password" : "google.com",
          },
        }),
        getUser: async () => ({ providerData: [] }),
      },
      repository,
      { now: () => new Date("2026-07-12T00:00:00.000Z") },
    );
    await expect(
      invalidSource.merge("google-uid", {
        sourceIdToken: "source-token",
        targetIdToken: "target-token",
        deviceId: "stable-device-id-1234",
      }),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(mergeAttempts).toBe(0);

    const conflict = new AccountMergeService(
      {
        verifyIdToken: async (token) => ({
          uid: token === "source-token" ? "anonymous-uid" : "google-uid",
          firebase: {
            sign_in_provider: token === "source-token" ? "anonymous" : "google.com",
          },
        }),
        getUser: async () => ({ providerData: [] }),
      },
      repository,
      { now: () => new Date("2026-07-12T00:00:00.000Z") },
    );
    await expect(
      conflict.merge("google-uid", {
        sourceIdToken: "source-token",
        targetIdToken: "target-token",
        deviceId: "stable-device-id-1234",
      }),
    ).rejects.toMatchObject({
      code: "failed-precondition",
      details: { kind: "entitlement-ownership-conflict" },
    });
  });

  it("returns the stored exact source-target result after response loss without requiring a non-revoked source", async () => {
    const verificationCalls: Array<{ token: string; checkRevoked?: boolean }> = [];
    const merge = {
      merged: true as const,
      goalCount: 3,
      progressDeckCount: 4,
      entitlementMoved: false,
    };
    const service = new AccountMergeService(
      {
        async verifyIdToken(token, checkRevoked) {
          verificationCalls.push(
            checkRevoked === undefined ? { token } : { token, checkRevoked }
          );
          if (token === "source-token" && checkRevoked === true) {
            throw new Error("source token was revoked after committed merge");
          }
          return token === "source-token"
            ? {
                uid: "anonymous-uid",
                firebase: { sign_in_provider: "anonymous" },
              }
            : {
                uid: "google-uid",
                firebase: { sign_in_provider: "google.com" },
              };
        },
        getUser: async () => ({ providerData: [] }),
      },
      {
        assertAccountActive: async () => undefined,
        getAccountMergeResult: async (sourceUid, targetUid) =>
          sourceUid === "anonymous-uid" && targetUid === "google-uid"
            ? merge
            : null,
        mergeAnonymousAccount: async () => {
          throw new Error("must not merge twice");
        },
      },
      { now: () => new Date("2026-07-12T00:00:00.000Z") }
    );

    await expect(
      service.merge("google-uid", {
        sourceIdToken: "source-token",
        targetIdToken: "target-token",
        deviceId: "stable-device-id-1234",
      })
    ).resolves.toEqual(merge);
    expect(verificationCalls).toEqual([
      { token: "source-token", checkRevoked: false },
      { token: "target-token", checkRevoked: true },
    ]);
  });

  it("recovers a concurrent exact commit after the source revocation check loses the race", async () => {
    let lookupCount = 0;
    const merge = {
      merged: true as const,
      goalCount: 1,
      progressDeckCount: 1,
      entitlementMoved: true,
    };
    const service = new AccountMergeService(
      {
        async verifyIdToken(token, checkRevoked) {
          if (token === "source-token" && checkRevoked === true) {
            throw new Error("revoked by concurrent committed merge");
          }
          return token === "source-token"
            ? {
                uid: "anonymous-uid",
                firebase: { sign_in_provider: "anonymous" },
              }
            : {
                uid: "google-uid",
                firebase: { sign_in_provider: "google.com" },
              };
        },
        getUser: async () => ({ providerData: [] }),
      },
      {
        assertAccountActive: async () => undefined,
        getAccountMergeResult: async () => (++lookupCount === 1 ? null : merge),
        mergeAnonymousAccount: async () => {
          throw new Error("must not reach merge after revocation race");
        },
      },
      { now: () => new Date("2026-07-12T00:00:00.000Z") }
    );

    await expect(
      service.merge("google-uid", {
        sourceIdToken: "source-token",
        targetIdToken: "target-token",
        deviceId: "stable-device-id-1234",
      })
    ).resolves.toEqual(merge);
    expect(lookupCount).toBe(2);
  });

  it("rejects a stale anonymous token after the source account was linked", async () => {
    let mergeCalled = false;
    const service = new AccountMergeService(
      {
        verifyIdToken: async (token) =>
          token === "source-token"
            ? {
                uid: "formerly-anonymous-uid",
                firebase: { sign_in_provider: "anonymous" },
              }
            : {
                uid: "target-uid",
                firebase: { sign_in_provider: "google.com" },
              },
        getUser: async () => ({
          providerData: [{ providerId: "apple.com" }],
        }),
      },
      {
        assertAccountActive: async () => undefined,
        getAccountMergeResult: async () => null,
        mergeAnonymousAccount: async () => {
          mergeCalled = true;
          throw new Error("must not merge a currently linked source");
        },
      },
      { now: () => new Date("2026-07-13T00:00:00.000Z") }
    );

    await expect(
      service.merge("target-uid", {
        sourceIdToken: "source-token",
        targetIdToken: "target-token",
        deviceId: "stable-device-id-1234",
      })
    ).rejects.toMatchObject({
      code: "failed-precondition",
      details: { kind: "account-merge-source-linked" },
    });
    expect(mergeCalled).toBe(false);
  });
});
