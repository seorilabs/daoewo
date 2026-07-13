import { randomUUID } from "node:crypto";
import type { Clock } from "../domain/types.js";
import { BackendError } from "../errors.js";
import type {
  AccountMergeCleanupFailureCode,
  AccountMergeCleanupRepository,
} from "../repositories/contracts.js";

export const ACCOUNT_MERGE_CLEANUP_LEASE_MINUTES = 5;
export const ACCOUNT_MERGE_CLEANUP_SWEEP_DELAY_MINUTES = 5;
export const ACCOUNT_MERGE_CLEANUP_SWEEP_LIMIT = 50;

export interface AccountMergeCleanupSweepResult {
  readonly scanned: number;
  readonly completed: number;
  readonly ignored: number;
  readonly deferred: number;
  readonly failed: number;
}

export class AccountMergeCleanupRetryError extends Error {
  readonly safeCode:
    | "cleanup-contention"
    | "cleanup-transient";

  constructor(
    safeCode: "cleanup-contention" | "cleanup-transient" = "cleanup-transient"
  ) {
    super("Account merge cleanup should be retried.");
    this.name = "AccountMergeCleanupRetryError";
    this.safeCode = safeCode;
  }
}

export class AccountMergeCleanupService {
  constructor(
    private readonly repository: AccountMergeCleanupRepository,
    private readonly clock: Clock,
    private readonly createLeaseId: () => string = randomUUID
  ) {}

  async process(
    sourceUid: string
  ): Promise<{ readonly outcome: "ignored" | "completed" }> {
    const now = this.clock.now();
    const leaseId = this.createLeaseId();
    let claim;
    try {
      claim = await this.repository.claimAccountMergeCleanup({
        sourceUid,
        leaseId,
        now,
        leaseUntil: new Date(
          now.getTime() + ACCOUNT_MERGE_CLEANUP_LEASE_MINUTES * 60 * 1_000
        ),
      });
    } catch (error) {
      if (
        error instanceof BackendError &&
        error.details?.kind === "account-merge-cleanup-lease-active"
      ) {
        throw new AccountMergeCleanupRetryError("cleanup-contention");
      }
      throw error;
    }
    if (claim === null) return { outcome: "ignored" };

    // source credential 폐기를 먼저 끝내 merge marker만 남은 source UID가 다시
    // 활성화될 수 있는 시간을 최소화한다. 두 단계 모두 멱등이라 lease 만료 후 재실행해도 안전하다.
    try {
      await this.repository.cleanupMergedSourceAuth(claim.sourceUid);
    } catch {
      await this.retry(sourceUid, leaseId, "source-auth");
      throw new AccountMergeCleanupRetryError();
    }

    try {
      await this.repository.syncMergedAccountEntitlementClaims(
        claim.targetUid,
        this.clock.now()
      );
    } catch {
      await this.retry(sourceUid, leaseId, "target-claims");
      throw new AccountMergeCleanupRetryError();
    }

    await this.repository.completeAccountMergeCleanup({
      sourceUid,
      leaseId,
      now: this.clock.now(),
    });
    return { outcome: "completed" };
  }

  async sweep(
    limit = ACCOUNT_MERGE_CLEANUP_SWEEP_LIMIT
  ): Promise<AccountMergeCleanupSweepResult> {
    const cutoff = new Date(
      this.clock.now().getTime() -
        ACCOUNT_MERGE_CLEANUP_SWEEP_DELAY_MINUTES * 60 * 1_000
    );
    const sourceUids = await this.repository.listAccountMergeCleanupCandidates({
      cutoff,
      limit,
    });
    let completed = 0;
    let ignored = 0;
    let deferred = 0;
    let failed = 0;

    // Cloud Scheduler 인스턴스 하나가 bounded batch를 순차 처리한다. 개별 marker의
    // provider 오류나 lease contention은 UID/원본 오류 없이 count로만 집계하고,
    // failed marker 또는 다음 정기 sweep가 다시 회수한다.
    for (const sourceUid of sourceUids) {
      try {
        const result = await this.process(sourceUid);
        if (result.outcome === "completed") completed += 1;
        else ignored += 1;
      } catch (error) {
        if (error instanceof AccountMergeCleanupRetryError) deferred += 1;
        else failed += 1;
      }
    }
    return {
      scanned: sourceUids.length,
      completed,
      ignored,
      deferred,
      failed,
    };
  }

  private retry(
    sourceUid: string,
    leaseId: string,
    failureCode: AccountMergeCleanupFailureCode
  ): Promise<void> {
    return this.repository.recordAccountMergeCleanupRetry({
      sourceUid,
      leaseId,
      failureCode,
      now: this.clock.now(),
    });
  }
}
