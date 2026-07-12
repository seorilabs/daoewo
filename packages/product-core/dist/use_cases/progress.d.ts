import type { CardProgress, SwipeDirection } from '../domain/entities.js';
export declare function createInitialCardProgress(cardId: string, deckId: string, now: Date): CardProgress;
/** 스와이프 결과를 immutable progress로 분류한다. */
export declare function classifySwipe(progress: CardProgress, direction: SwipeDirection, now: Date): CardProgress;
export declare const applySwipeToProgress: typeof classifySwipe;
//# sourceMappingURL=progress.d.ts.map