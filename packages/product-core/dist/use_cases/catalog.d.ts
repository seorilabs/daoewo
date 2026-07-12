import type { CatalogDeckMetadata, Deck, Entitlement } from '../domain/entities.js';
export interface CatalogMetadataFilter {
    readonly category?: string;
    readonly locale?: string;
    readonly tags?: readonly string[];
    readonly query?: string;
}
/**
 * 검색 조건만 필터링하고 tier로 항목을 제거하지 않는다. Free 사용자도 Pro 메타데이터를
 * 보고 업그레이드 판단을 할 수 있으며, 본문 접근 가능 여부는 isLocked로 표현한다.
 */
export declare function filterCatalogMetadata(decks: readonly Deck[], filter: CatalogMetadataFilter, entitlement: Entitlement, now: Date): CatalogDeckMetadata[];
//# sourceMappingURL=catalog.d.ts.map