import type { Deck, Entitlement } from '../domain/entities.js';
export interface ProductLimits {
    readonly maxActiveDecks: number | null;
    readonly dailyNewCards: number | null;
}
export declare const FREE_LIMITS: ProductLimits;
export declare const PRO_LIMITS: ProductLimits;
export type DeckActivationDenialReason = 'pro-required' | 'active-deck-limit';
export type DeckActivationDecision = {
    readonly allowed: true;
    readonly reason: null;
} | {
    readonly allowed: false;
    readonly reason: DeckActivationDenialReason;
};
/** 현재 시점에 유효한 Pro 권한인지 판단한다. */
export declare function isEntitled(entitlement: Entitlement, now: Date): boolean;
export declare const hasActiveProEntitlement: typeof isEntitled;
export declare function getProductLimits(entitlement: Entitlement, now: Date): ProductLimits;
export declare function evaluateDeckActivation(input: {
    readonly deck: Pick<Deck, 'id' | 'tier'>;
    readonly activeDeckIds: readonly string[];
    readonly entitlement: Entitlement;
    readonly now: Date;
}): DeckActivationDecision;
export declare function resolveDailyCardLimit(entitlement: Entitlement, requestedCount: number, now: Date): number;
//# sourceMappingURL=entitlement.d.ts.map