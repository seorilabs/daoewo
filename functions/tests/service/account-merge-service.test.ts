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
      },
      {
        assertAccountActive: async () => undefined,
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
      { token: "source-token", checkRevoked: true },
      { token: "target-token", checkRevoked: true },
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
      },
      {
        assertAccountActive: async () => undefined,
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
});
