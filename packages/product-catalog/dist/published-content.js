import { PUBLISHED_DECK_CONTENT } from './published-content.generated.js';
export { PUBLISHED_DECK_CONTENT } from './published-content.generated.js';
/** 서버 전용. root catalog export에서는 본문을 재수출하지 않는다. */
export function getPublishedDeckContent(deckId) {
    const content = PUBLISHED_DECK_CONTENT;
    return content[deckId] ?? null;
}
//# sourceMappingURL=published-content.js.map