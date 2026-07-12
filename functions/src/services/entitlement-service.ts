import { isEntitled } from "@daoewo/product-core";
import type { Clock } from "../domain/types.js";
import { BackendError, assertBackend } from "../errors.js";
import type {
  EntitlementRepository,
  ReceiptEntitlementRepository,
} from "../repositories/contracts.js";
import type { ReceiptVerificationRequest } from "../receipts/providers.js";
import { ReceiptProviderRegistry } from "../receipts/providers.js";
import { receiptFingerprint } from "../receipts/fingerprint.js";

export class EntitlementService {
  constructor(
    private readonly entitlements: EntitlementRepository,
    private readonly receiptEntitlements: ReceiptEntitlementRepository,
    private readonly providers: ReceiptProviderRegistry,
    private readonly clock: Clock,
  ) {}

  async get(uid: string): Promise<{ active: boolean; entitlement: unknown | null }> {
    const entitlement = await this.entitlements.getEntitlement(uid);
    return {
      active: entitlement !== null && isEntitled(entitlement, this.clock.now()),
      entitlement,
    };
  }

  async verifyReceipt(
    uid: string,
    input: Omit<ReceiptVerificationRequest, "uid">,
  ): Promise<{ active: boolean; entitlement: unknown }> {
    // Provider 조회가 시작된 뒤 들어온 revoke/refund projection을 direct grant가 덮지 못하게 한다.
    const verificationStartedAt = this.clock.now();
    const request: ReceiptVerificationRequest = { ...input, uid };
    const verified = await this.providers.get(input.platform).verify(request);
    const verificationCompletedAt = this.clock.now();

    assertBackend(
      verified.platform === input.platform && verified.productId === input.productId,
      "permission-denied",
      "Receipt verification result does not match the requested product.",
    );
    if (input.platform === "apps-in-toss") {
      assertBackend(
        (input.subscriptionId === undefined ||
          verified.originalTransactionId === input.subscriptionId) &&
          verified.productId === input.sku,
        "permission-denied",
        "AppsInToss verification result does not match subscriptionId/sku.",
      );
    }
    assertBackend(
      verified.active && isEntitled(verified.entitlement, this.clock.now()),
      "failed-precondition",
      "The store receipt does not contain an active entitlement.",
    );
    assertBackend(
      input.platform === "apps-in-toss" ||
        verified.authorityObservation !== undefined,
      "internal",
      "Store verification did not return an authority observation.",
    );
    const authorityObservation = verified.authorityObservation ?? {
      startedAt: verificationStartedAt.toISOString(),
      observedAt: verificationCompletedAt.toISOString(),
    };

    const entitlement = await this.receiptEntitlements.applyVerifiedReceipt(
      uid,
      verified,
      receiptFingerprint(verified.platform, verified.originalTransactionId),
      authorityObservation,
      this.clock.now(),
    );
    if (!isEntitled(entitlement, this.clock.now())) {
      throw new BackendError("internal", "Verified entitlement was not persisted as active.");
    }
    return { active: true, entitlement };
  }
}
