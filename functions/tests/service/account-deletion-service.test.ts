import { describe, expect, it } from "vitest";
import type {
  AccountDeletionRepository,
  FirebaseAccountAdmin,
} from "../../src/repositories/contracts.js";
import { AccountDeletionService } from "../../src/services/account-deletion-service.js";

const NOW = new Date("2026-07-12T12:00:00.000Z");

describe("AccountDeletionService", () => {
  it("marks, purges, and deletes Firebase Auth in that order", async () => {
    const calls: string[] = [];
    const accounts: AccountDeletionRepository = {
      async beginAccountDeletion(uid) {
        calls.push(`begin:${uid}`);
      },
      async purgeAccountData(uid) {
        calls.push(`purge:${uid}`);
        return {
          deletedUidCount: 2,
          deletedDocumentCount: 12,
          retainedReceiptClaimCount: 1,
        };
      },
    };
    const auth: FirebaseAccountAdmin = {
      async deleteUser(uid) {
        calls.push(`auth:${uid}`);
      },
    };
    const service = new AccountDeletionService(auth, accounts, { now: () => NOW });

    await expect(
      service.delete("user-a", {
        authenticatedAt: new Date("2026-07-12T11:56:00.000Z"),
        signInProvider: "google.com",
      }),
    ).resolves.toEqual({
      deleted: true,
      deletedUidCount: 2,
      deletedDocumentCount: 12,
      retainedReceiptClaimCount: 1,
    });
    expect(calls).toEqual(["begin:user-a", "purge:user-a", "auth:user-a"]);
  });

  it("rejects a stale authentication before creating a deletion marker", async () => {
    const calls: string[] = [];
    const service = new AccountDeletionService(
      { async deleteUser() { calls.push("auth"); } },
      {
        async beginAccountDeletion() { calls.push("begin"); },
        async purgeAccountData() {
          calls.push("purge");
          return {
            deletedUidCount: 0,
            deletedDocumentCount: 0,
            retainedReceiptClaimCount: 0,
          };
        },
      },
      { now: () => NOW },
    );

    await expect(
      service.delete("user-a", {
        authenticatedAt: new Date("2026-07-12T11:54:59.000Z"),
        signInProvider: "apple.com",
      }),
    ).rejects.toMatchObject({
      code: "failed-precondition",
      details: { kind: "recent-auth-required" },
    });
    expect(calls).toEqual([]);
  });

  it("does not delete Auth when authoritative data cleanup fails", async () => {
    const calls: string[] = [];
    const service = new AccountDeletionService(
      { async deleteUser() { calls.push("auth"); } },
      {
        async beginAccountDeletion() { calls.push("begin"); },
        async purgeAccountData() {
          calls.push("purge");
          throw new Error("cleanup failed");
        },
      },
      { now: () => NOW },
    );

    await expect(
      service.delete("user-a", {
        authenticatedAt: new Date("2026-07-12T11:59:00.000Z"),
        signInProvider: "apps-in-toss",
      }),
    ).rejects.toThrow("cleanup failed");
    expect(calls).toEqual(["begin", "purge"]);
  });

  it("allows an anonymous account with a boundary-verified non-revoked token", async () => {
    const calls: string[] = [];
    const service = new AccountDeletionService(
      { async deleteUser() { calls.push("auth"); } },
      {
        async beginAccountDeletion() { calls.push("begin"); },
        async purgeAccountData() {
          calls.push("purge");
          return {
            deletedUidCount: 1,
            deletedDocumentCount: 0,
            retainedReceiptClaimCount: 0,
          };
        },
      },
      { now: () => NOW },
    );

    await expect(
      service.delete("anonymous-user", {
        authenticatedAt: new Date("2026-01-01T00:00:00.000Z"),
        signInProvider: "anonymous",
      }),
    ).resolves.toMatchObject({ deleted: true });
    expect(calls).toEqual(["begin", "purge", "auth"]);
  });
});
