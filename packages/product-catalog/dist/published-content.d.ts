import type { PublishedDeckContent } from './types.js';
export { PUBLISHED_DECK_CONTENT } from './published-content.generated.js';
export type { PublishedCard, PublishedCardMedia, PublishedDeckChunk, PublishedDeckContent, } from './types.js';
/** 서버 전용. root catalog export에서는 본문을 재수출하지 않는다. */
export declare function getPublishedDeckContent(deckId: string): PublishedDeckContent | null;
//# sourceMappingURL=published-content.d.ts.map