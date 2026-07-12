import { isEntitled, type Entitlement } from "@daoewo/product-core";
import { assertBackend } from "../errors.js";
import type {
  AuthoritativeSubscriptionState,
  StoreEventCursor,
} from "./types.js";

export interface CurrentEntitlementProjection {
  entitlement: Entitlement;
  receiptFingerprint?: string;
  cursor?: StoreEventCursor;
  authorityObservation?: AuthorityObservation;
}

export interface AuthorityObservation {
  startedAt: string;
  observedAt: string;
  observationId: string;
}

export type StoreNotificationUpdateDecision = "apply" | "stale" | "superseded";

export function decideStoreNotificationUpdate(input: {
  current: CurrentEntitlementProjection | null;
  incomingFingerprint: string;
  incomingCursor: StoreEventCursor;
  incomingObservation: AuthorityObservation;
  incomingState: AuthoritativeSubscriptionState;
  now: Date;
}): StoreNotificationUpdateDecision {
  const { current } = input;
  if (current === null) return "apply";

  if (current.receiptFingerprint === input.incomingFingerprint) {
    return decideSameReceiptObservation(
      current,
      input.incomingObservation,
      input.incomingState,
    );
  }

  // 이전 token/original transaction의 종료 이벤트가 더 최근의 구독을 회수하면 안 된다.
  if (!input.incomingState.active) return "superseded";

  if (
    current.authorityObservation !== undefined &&
    !isIncomingAuthorityNewer({
      current: current.authorityObservation,
      currentActive: current.entitlement.plan === "pro",
      incoming: input.incomingObservation,
      incomingActive: true,
    })
  ) {
    return "superseded";
  }

  if (!isEntitled(current.entitlement, input.now)) return "apply";
  if (current.entitlement.validUntil === null) return "superseded";

  const currentExpiry = Date.parse(current.entitlement.validUntil);
  const incomingExpiry = Date.parse(input.incomingState.validUntil);
  return incomingExpiry > currentExpiry ? "apply" : "superseded";
}

function decideSameReceiptObservation(
  current: CurrentEntitlementProjection,
  incoming: AuthorityObservation,
  incomingState: AuthoritativeSubscriptionState,
): StoreNotificationUpdateDecision {
  if (current.authorityObservation === undefined) return "apply";
  return isIncomingAuthorityNewer({
    current: current.authorityObservation,
    currentActive: current.entitlement.plan === "pro",
    incoming,
    incomingActive: incomingState.active,
  })
    ? "apply"
    : "stale";
}

export function isIncomingAuthorityNewer(input: {
  current: AuthorityObservation;
  currentActive: boolean;
  incoming: AuthorityObservation;
  incomingActive: boolean;
}): boolean {
  const currentStartedAt = Date.parse(input.current.startedAt);
  const currentObservedAt = Date.parse(input.current.observedAt);
  const incomingStartedAt = Date.parse(input.incoming.startedAt);
  const incomingObservedAt = Date.parse(input.incoming.observedAt);
  assertBackend(
    [
      currentStartedAt,
      currentObservedAt,
      incomingStartedAt,
      incomingObservedAt,
    ].every(Number.isFinite) &&
      currentStartedAt <= currentObservedAt &&
      incomingStartedAt <= incomingObservedAt,
    "internal",
    "Store authority observation window is invalid.",
  );

  // Non-overlapping queries have a definite order.
  if (incomingObservedAt < currentStartedAt) return false;
  if (incomingStartedAt > currentObservedAt) return true;

  // Overlapping queries cannot be totally ordered by client time. Converge
  // fail-closed: inactive wins; equal states use response time then stable ID.
  if (input.currentActive !== input.incomingActive) {
    return !input.incomingActive;
  }
  if (incomingObservedAt !== currentObservedAt) {
    return incomingObservedAt > currentObservedAt;
  }
  return input.incoming.observationId.localeCompare(input.current.observationId) > 0;
}

export function compareStoreEventCursor(
  left: StoreEventCursor,
  right: StoreEventCursor,
): number {
  const timeDelta = Date.parse(left.occurredAt) - Date.parse(right.occurredAt);
  if (timeDelta !== 0) return timeDelta;
  return left.eventId.localeCompare(right.eventId);
}
