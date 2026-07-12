import { PUBLISHED_DECK_CONTENT } from './published-content.generated.js';
import type { PublishedDeckContent } from './types.js';

export { PUBLISHED_DECK_CONTENT } from './published-content.generated.js';
export type {
  PublishedCard,
  PublishedCardMedia,
  PublishedDeckChunk,
  PublishedDeckContent,
} from './types.js';

/** 서버 전용. root catalog export에서는 본문을 재수출하지 않는다. */
export function getPublishedDeckContent(deckId: string): PublishedDeckContent | null {
  const content: Readonly<Record<string, PublishedDeckContent>> = PUBLISHED_DECK_CONTENT;
  return content[deckId] ?? null;
}
