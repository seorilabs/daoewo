import type { CatalogDeckForEntitlement, CatalogEntitlement, PublicDeckMetadata } from './types.js';
export { PUBLIC_CATALOG } from './catalog.generated.js';
export type { CatalogAvailability, CatalogCategory, CatalogDeckForEntitlement, CatalogEntitlement, CatalogPriority, CatalogSourceType, CatalogTier, ContentLanguage, PublicCatalog, PublicDeckMetadata, PublicLicenseSummary, } from './types.js';
/** 잠금·준비중 상태를 포함해 23개 메타데이터를 항상 반환한다. */
export declare function listPublicCatalog(entitlement?: CatalogEntitlement): readonly CatalogDeckForEntitlement[];
export declare function getPublicDeckMetadata(deckId: string): PublicDeckMetadata | null;
//# sourceMappingURL=index.d.ts.map