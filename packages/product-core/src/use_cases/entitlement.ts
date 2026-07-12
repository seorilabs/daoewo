import type { Deck, Entitlement } from '../domain/entities.js';

export interface ProductLimits {
  readonly maxActiveDecks: number | null;
  readonly dailyNewCards: number | null;
}

export const FREE_LIMITS: ProductLimits = Object.freeze({
  maxActiveDecks: 1,
  dailyNewCards: 60,
});

export const PRO_LIMITS: ProductLimits = Object.freeze({
  maxActiveDecks: null,
  dailyNewCards: null,
});

export type DeckActivationDenialReason = 'pro-required' | 'active-deck-limit';

export type DeckActivationDecision =
  | { readonly allowed: true; readonly reason: null }
  | { readonly allowed: false; readonly reason: DeckActivationDenialReason };

/** 현재 시점에 유효한 Pro 권한인지 판단한다. */
export function isEntitled(entitlement: Entitlement, now: Date): boolean {
  const nowMs = validDateMilliseconds(now);

  if (entitlement.plan !== 'pro') {
    return false;
  }

  if (entitlement.validUntil == null) {
    return true;
  }

  const validUntilMs = Date.parse(entitlement.validUntil);
  return Number.isFinite(validUntilMs) && validUntilMs > nowMs;
}

export const hasActiveProEntitlement = isEntitled;

export function getProductLimits(entitlement: Entitlement, now: Date): ProductLimits {
  return isEntitled(entitlement, now) ? PRO_LIMITS : FREE_LIMITS;
}

export function evaluateDeckActivation(input: {
  readonly deck: Pick<Deck, 'id' | 'tier'>;
  readonly activeDeckIds: readonly string[];
  readonly entitlement: Entitlement;
  readonly now: Date;
}): DeckActivationDecision {
  const pro = isEntitled(input.entitlement, input.now);

  if (input.deck.tier === 'pro' && !pro) {
    return { allowed: false, reason: 'pro-required' };
  }

  if (input.activeDeckIds.includes(input.deck.id)) {
    return { allowed: true, reason: null };
  }

  if (!pro && new Set(input.activeDeckIds).size >= (FREE_LIMITS.maxActiveDecks ?? 0)) {
    return { allowed: false, reason: 'active-deck-limit' };
  }

  return { allowed: true, reason: null };
}

export function resolveDailyCardLimit(
  entitlement: Entitlement,
  requestedCount: number,
  now: Date,
): number {
  if (!Number.isInteger(requestedCount) || requestedCount < 0) {
    throw new RangeError('requestedCount must be a non-negative integer');
  }

  if (isEntitled(entitlement, now)) {
    return requestedCount;
  }

  return Math.min(requestedCount, FREE_LIMITS.dailyNewCards ?? requestedCount);
}

function validDateMilliseconds(date: Date): number {
  const milliseconds = date.getTime();

  if (Number.isNaN(milliseconds)) {
    throw new RangeError('Invalid date');
  }

  return milliseconds;
}
