export const FREE_LIMITS = Object.freeze({
    maxActiveDecks: 1,
    dailyNewCards: 60,
});
export const PRO_LIMITS = Object.freeze({
    maxActiveDecks: null,
    dailyNewCards: null,
});
/** 현재 시점에 유효한 Pro 권한인지 판단한다. */
export function isEntitled(entitlement, now) {
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
export function getProductLimits(entitlement, now) {
    return isEntitled(entitlement, now) ? PRO_LIMITS : FREE_LIMITS;
}
export function evaluateDeckActivation(input) {
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
export function resolveDailyCardLimit(entitlement, requestedCount, now) {
    if (!Number.isInteger(requestedCount) || requestedCount < 0) {
        throw new RangeError('requestedCount must be a non-negative integer');
    }
    if (isEntitled(entitlement, now)) {
        return requestedCount;
    }
    return Math.min(requestedCount, FREE_LIMITS.dailyNewCards ?? requestedCount);
}
function validDateMilliseconds(date) {
    const milliseconds = date.getTime();
    if (Number.isNaN(milliseconds)) {
        throw new RangeError('Invalid date');
    }
    return milliseconds;
}
//# sourceMappingURL=entitlement.js.map