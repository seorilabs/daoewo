import { describe, expect, it, vi } from "vitest";
import { BackendError } from "../../src/errors.js";
import type { AccountMergeCleanupRepository } from "../../src/repositories/contracts.js";
import {
  AccountMergeCleanupRetryError,
  AccountMergeCleanupService,
} from "../../src/services/account-merge-cleanup-service.js";

const NOW = new Date("2026-07-13T00:00:00.000Z");

describe("AccountMergeCleanupService", () => {
  it("claims the durable marker, removes source Auth, projects target claims, and completes", async () => {
    const { repository, calls } = harness();
    const service = new AccountMergeCleanupService(
      repository,
      { now: () => NOW },
      () => "cleanup-lease"
    );

    await expect(service.process("source-uid")).resolves.toEqual({
      outcome: "completed",
    });
    expect(calls).toEqual([
      "claim:source-uid:cleanup-lease",
      "source-auth:source-uid",
      "target-claims:target-uid",
      "complete:source-uid:cleanup-lease",
    ]);
  });

  it("ignores missing, legacy, or already-complete markers", async () => {
    const { repository, calls } = harness({ claim: null });
    const service = new AccountMergeCleanupService(repository, { now: () => NOW });

    await expect(service.process("source-uid")).resolves.toEqual({
      outcome: "ignored",
    });
    expect(calls).toEqual([expect.stringMatching(/^claim:source-uid:/)]);
  });

  it.each([
    ["source-auth", "source-auth:source-uid"],
    ["target-claims", "target-claims:target-uid"],
  ] as const)(
    "%s failure releases the lease with an allowlisted code and throws only a safe retry error",
    async (failure, failedCall) => {
      const { repository, calls } = harness({ failure });
      const service = new AccountMergeCleanupService(
        repository,
        { now: () => NOW },
        () => "cleanup-lease"
      );

      let caught: unknown;
      try {
        await service.process("source-uid");
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(AccountMergeCleanupRetryError);
      expect(caught).toMatchObject({ safeCode: "cleanup-transient" });
      expect(JSON.stringify(caught)).not.toMatch(/source-uid|target-uid|secret/i);
      expect(calls).toContain(failedCall);
      expect(calls).toContain(
        `retry:source-uid:cleanup-lease:${failure}`
      );
      expect(calls).not.toContain("complete:source-uid:cleanup-lease");
    }
  );

  it("turns an active lease into a sanitized contention retry", async () => {
    const { repository } = harness();
    repository.claimAccountMergeCleanup = vi.fn(async () => {
      throw new BackendError("aborted", "contains source-uid", {
        kind: "account-merge-cleanup-lease-active",
      });
    });
    const service = new AccountMergeCleanupService(repository, { now: () => NOW });

    await expect(service.process("source-uid")).rejects.toMatchObject({
      safeCode: "cleanup-contention",
    });
  });

  it("sweeps an oldest-first bounded candidate batch without exposing marker identities", async () => {
    const { repository, calls } = harness({
      candidates: ["complete-source", "ignored-source", "leased-source", "corrupt-source"],
    });
    repository.claimAccountMergeCleanup = vi.fn(async ({ sourceUid }) => {
      if (sourceUid === "ignored-source") return null;
      if (sourceUid === "leased-source") {
        throw new BackendError("aborted", "contains leased-source", {
          kind: "account-merge-cleanup-lease-active",
        });
      }
      if (sourceUid === "corrupt-source") {
        throw new Error("contains corrupt-source");
      }
      return { sourceUid, targetUid: "target-uid" };
    });
    const service = new AccountMergeCleanupService(
      repository,
      { now: () => NOW },
      () => "cleanup-lease"
    );

    await expect(service.sweep()).resolves.toEqual({
      scanned: 4,
      completed: 1,
      ignored: 1,
      deferred: 1,
      failed: 1,
    });
    expect(calls[0]).toBe(
      "list:2026-07-12T23:55:00.000Z:50"
    );
  });
});

function harness(input?: {
  readonly claim?: { sourceUid: string; targetUid: string } | null;
  readonly failure?: "source-auth" | "target-claims";
  readonly candidates?: readonly string[];
}) {
  const calls: string[] = [];
  const repository: AccountMergeCleanupRepository = {
    async listAccountMergeCleanupCandidates(request) {
      calls.push(`list:${request.cutoff.toISOString()}:${request.limit}`);
      return input?.candidates ?? [];
    },
    async claimAccountMergeCleanup(claim) {
      calls.push(`claim:${claim.sourceUid}:${claim.leaseId}`);
      return input?.claim === undefined
        ? { sourceUid: "source-uid", targetUid: "target-uid" }
        : input.claim;
    },
    async cleanupMergedSourceAuth(sourceUid) {
      calls.push(`source-auth:${sourceUid}`);
      if (input?.failure === "source-auth") {
        throw new Error("secret source provider failure");
      }
    },
    async syncMergedAccountEntitlementClaims(targetUid) {
      calls.push(`target-claims:${targetUid}`);
      if (input?.failure === "target-claims") {
        throw new Error("secret target provider failure");
      }
    },
    async recordAccountMergeCleanupRetry(retry) {
      calls.push(
        `retry:${retry.sourceUid}:${retry.leaseId}:${retry.failureCode}`
      );
    },
    async completeAccountMergeCleanup(complete) {
      calls.push(`complete:${complete.sourceUid}:${complete.leaseId}`);
    },
  };
  return { repository, calls };
}
