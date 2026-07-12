import type { Clock } from "../domain/types.js";
import { assertBackend } from "../errors.js";
import type {
  AccountDeletionRepository,
  AccountDeletionSummary,
  FirebaseAccountAdmin,
} from "../repositories/contracts.js";

export const RECENT_AUTH_MAX_AGE_MS = 5 * 60 * 1_000;
const AUTH_CLOCK_SKEW_MS = 60 * 1_000;

export interface AccountDeletionAuthentication {
  readonly authenticatedAt: Date;
  readonly signInProvider: string;
}

export class AccountDeletionService {
  constructor(
    private readonly auth: FirebaseAccountAdmin,
    private readonly accounts: AccountDeletionRepository,
    private readonly clock: Clock,
  ) {}

  async delete(
    authenticatedUid: string,
    authentication: AccountDeletionAuthentication,
  ): Promise<AccountDeletionSummary & { readonly deleted: true }> {
    const now = this.clock.now();
    if (authentication.signInProvider !== "anonymous") {
      const authenticationAge =
        now.getTime() - authentication.authenticatedAt.getTime();
      assertBackend(
        Number.isFinite(authenticationAge) &&
          authenticationAge >= -AUTH_CLOCK_SKEW_MS &&
          authenticationAge <= RECENT_AUTH_MAX_AGE_MS,
        "failed-precondition",
        "Recent authentication is required before deleting an account.",
        { kind: "recent-auth-required", maxAgeSeconds: RECENT_AUTH_MAX_AGE_MS / 1_000 },
      );
    }

    // marker가 먼저 생성되어야 다른 쓰기 transaction과 삭제 작업이 직렬화된다.
    await this.accounts.beginAccountDeletion(authenticatedUid, now);
    const summary = await this.accounts.purgeAccountData(authenticatedUid, now);

    // Auth 삭제가 마지막이다. 여기서 실패하면 marker와 멱등 cleanup을 이용해 재시도한다.
    await this.auth.deleteUser(authenticatedUid);
    return { deleted: true, ...summary };
  }
}
