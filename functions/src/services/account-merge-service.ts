import type { Clock } from "../domain/types.js";
import { assertBackend } from "../errors.js";
import type {
  AccountMergeRepository,
  FirebaseIdTokenVerifier,
} from "../repositories/contracts.js";
import { sha256 } from "../utils/hash.js";

export interface MergeAnonymousAccountInput {
  sourceIdToken: string;
  targetIdToken: string;
  deviceId: string;
}

const LINK_TARGET_PROVIDERS = new Set(["google.com", "apple.com"]);

export class AccountMergeService {
  constructor(
    private readonly tokens: FirebaseIdTokenVerifier,
    private readonly accounts: AccountMergeRepository,
    private readonly clock: Clock,
  ) {}

  async merge(
    authenticatedTargetUid: string,
    input: MergeAnonymousAccountInput,
  ): Promise<
    | { merged: false; sameAccount: true }
    | {
        merged: true;
        goalCount: number;
        progressDeckCount: number;
        entitlementMoved: boolean;
      }
  > {
    // 완료된 merge는 source Auth가 이미 폐기됐어도 같은 signed ID token의 UID/provider를
    // marker와 대조해 멱등 응답할 수 있어야 한다. 신규 merge 직전에는 아래에서 폐기 여부를
    // 다시 검사하므로 revoked token으로 새 병합을 시작할 수는 없다.
    const [source, target] = await Promise.all([
      this.tokens.verifyIdToken(input.sourceIdToken, false),
      this.tokens.verifyIdToken(input.targetIdToken, true),
    ]);
    assertBackend(
      target.uid === authenticatedTargetUid,
      "permission-denied",
      "Target Firebase token does not match the authenticated account.",
    );
    assertBackend(
      source.firebase?.sign_in_provider === "anonymous",
      "permission-denied",
      "Only an anonymous Firebase account can be merged as the source.",
    );
    assertBackend(
      LINK_TARGET_PROVIDERS.has(target.firebase?.sign_in_provider ?? ""),
      "permission-denied",
      "Target account must be linked with Google or Apple.",
    );
    await this.accounts.assertAccountActive(target.uid);
    if (source.uid === target.uid) {
      return { merged: false, sameAccount: true };
    }
    const previous = await this.accounts.getAccountMergeResult(
      source.uid,
      target.uid
    );
    if (previous !== null) return previous;

    try {
      const checkedSource = await this.tokens.verifyIdToken(
        input.sourceIdToken,
        true
      );
      assertBackend(
        checkedSource.uid === source.uid &&
          checkedSource.firebase?.sign_in_provider === "anonymous",
        "permission-denied",
        "Source Firebase token identity changed during account merge."
      );
      const currentSource = await this.tokens.getUser(source.uid);
      assertBackend(
        currentSource.providerData.length === 0,
        "failed-precondition",
        "Source Firebase account is no longer anonymous.",
        { kind: "account-merge-source-linked" }
      );
      await this.accounts.assertAccountActive(source.uid);
      return await this.accounts.mergeAnonymousAccount({
        sourceUid: source.uid,
        targetUid: target.uid,
        deviceHash: sha256(input.deviceId),
        now: this.clock.now(),
      });
    } catch (error) {
      // 동시 요청이 먼저 commit했거나 응답 유실 뒤 source revoke가 끝난 경우 exact
      // source→target marker만 성공으로 복원한다. 다른 target marker나 신규 실패는 그대로 거부한다.
      const committed = await this.accounts.getAccountMergeResult(
        source.uid,
        target.uid
      );
      if (committed !== null) return committed;
      throw error;
    }
  }
}
