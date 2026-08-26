import { PUBLIC_CATALOG } from './catalog.generated.js';
export { PUBLIC_CATALOG } from './catalog.generated.js';
/** 잠금·준비중 상태를 포함해 23개 메타데이터를 항상 반환한다. */
export function listPublicCatalog(entitlement = 'free') {
    const decks = PUBLIC_CATALOG.decks;
    return decks.map((deck) => ({
        ...deck,
        locked: deck.tier === 'pro' && entitlement !== 'pro',
        available: deck.availability === 'published',
    }));
}
export function getPublicDeckMetadata(deckId) {
    const decks = PUBLIC_CATALOG.decks;
    return decks.find((deck) => deck.id === deckId) ?? null;
}
//# sourceMappingURL=index.js.map