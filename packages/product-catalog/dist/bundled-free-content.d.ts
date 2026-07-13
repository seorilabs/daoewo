import { type CardProgress, type Entitlement, type FreeDeckLearningSnapshot, type LocalDateKey, type StudyGoal, type StudyGoalMode } from '@daoewo/product-core';
import type { PublishedCard, PublishedDeckContent } from './types.js';
export { BUNDLED_FREE_DECK_CONTENT } from './bundled-free-content.generated.js';
export type { PublishedCard, PublishedCardMedia, PublishedDeckChunk, PublishedDeckContent, } from './types.js';
export interface BundledFreeStorage {
    getItem<T>(key: string): Promise<T | null>;
    setItem<T>(key: string, value: T): Promise<void>;
    removeItem(key: string): Promise<void>;
}
export interface BundledFreeGoalInput {
    readonly deckId: string;
    readonly mode: StudyGoalMode;
    readonly value: number;
    readonly startDate: LocalDateKey;
}
export interface BundledFreeCardWindow {
    readonly id: string;
    readonly deckId: string;
    readonly goalKey: string;
    readonly cards: readonly PublishedCard[];
    readonly targetCount: number;
}
export interface BundledFreeProgressBatch {
    readonly deckId: string;
    readonly goalKey?: string;
    readonly windowId: string;
    readonly progresses: readonly CardProgress[];
}
export interface BundledFreeDeckSummary {
    readonly active: boolean;
    readonly progress: number;
    readonly daysLeft: number;
}
export interface BundledFreeContentAdapter {
    hasDeck(deckId: string): boolean;
    createGoal(input: BundledFreeGoalInput): Promise<StudyGoal>;
    getCardWindow(input: {
        readonly deckId: string;
        readonly goalKey?: string;
    }): Promise<BundledFreeCardWindow>;
    commitProgressBatch(batch: BundledFreeProgressBatch): Promise<void>;
    getDeckSummary(deckId: string): Promise<BundledFreeDeckSummary | null>;
    exportLearningBackup(ownerId?: string): Promise<readonly FreeDeckLearningSnapshot[]>;
    importLearningBackup(freeDecks: readonly FreeDeckLearningSnapshot[], ownerId?: string): Promise<void>;
    getCardsByIds(cards: readonly {
        readonly deckId: string;
        readonly cardId: string;
    }[]): Promise<readonly PublishedCard[]>;
    mergeOwnerState(sourceOwnerId: string, targetOwnerId: string): Promise<void>;
    removeOwnerState(ownerId: string): Promise<void>;
}
export interface CreateBundledFreeContentAdapterOptions {
    readonly storage: BundledFreeStorage;
    /** 매 호출 시 현재 계정을 다시 읽어 계정 전환 중 stale cache를 공유하지 않는다. */
    readonly getOwnerId: () => Promise<string | null>;
    readonly getEntitlement?: () => Promise<Entitlement>;
    readonly now?: () => Date;
    /** 테스트에서만 승인 완료 Free fixture를 주입한다. production 기본값은 generated bundle이다. */
    readonly content?: Readonly<Record<string, PublishedDeckContent>>;
}
/**
 * 앱에 번들된 Free 본문 전용 로컬 adapter다. Pro 본문/entitlement/server window는
 * 이 경계로 들어올 수 없다.
 */
export declare function createBundledFreeContentAdapter(options: CreateBundledFreeContentAdapterOptions): BundledFreeContentAdapter;
export declare function getBundledFreeDeckContent(deckId: string): PublishedDeckContent | null;
export declare function bundledFreeStorageKey(ownerId: string): string;
//# sourceMappingURL=bundled-free-content.d.ts.map