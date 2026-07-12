import type { Clock } from "../domain/types.js";
import { assertBackend } from "../errors.js";
import type {
  AccountAccessRepository,
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
    private readonly accounts: AccountAccessRepository,
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
    const [source, target] = await Promise.all([
      this.tokens.verifyIdToken(input.sourceIdToken, true),
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
    await this.accounts.assertAccountActive(source.uid);
    return this.accounts.mergeAnonymousAccount({
      sourceUid: source.uid,
      targetUid: target.uid,
      deviceHash: sha256(input.deviceId),
      now: this.clock.now(),
    });
  }
}
