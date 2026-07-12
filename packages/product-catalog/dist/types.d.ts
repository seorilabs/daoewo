export type CatalogTier = 'free' | 'pro';
export type CatalogPriority = 'P1' | 'P2' | 'P3';
export type CatalogAvailability = 'coming-soon' | 'published';
export type ContentLanguage = 'ko' | 'en' | 'ja';
export type CatalogCategory = 'language' | 'certification' | 'career' | 'general-knowledge' | 'k12-secondary';
export type CatalogSourceType = 'curated-import' | 'ai-assisted-operator-batch';
export type CatalogEntitlement = 'free' | 'pro';
export interface PublicLicenseSummary {
    readonly ids: readonly string[];
    readonly attributions: readonly string[];
    readonly distributionNotice: string;
}
/**
 * 잠금 덱까지 포함해 클라이언트와 서버가 공통으로 볼 수 있는 공개 메타데이터다.
 * 본문, 검수자 이름, source URI/commit, 생성 prompt는 포함하지 않는다.
 */
export interface PublicDeckMetadata {
    readonly id: string;
    readonly displayOrder: number;
    readonly title: string;
    readonly description: string;
    readonly category: CatalogCategory;
    readonly locale: string;
    readonly contentLanguage: ContentLanguage;
    readonly tier: CatalogTier;
    readonly priority: CatalogPriority;
    readonly sourceType: CatalogSourceType;
    readonly availability: CatalogAvailability;
    readonly version: number;
    readonly cardCount: number | null;
    readonly chunkSize: 200;
    readonly tags: readonly string[];
    readonly license: PublicLicenseSummary;
    readonly publishedAt: string | null;
}
export interface PublicCatalog {
    readonly schemaVersion: 1;
    readonly catalogId: 'daoewo-v1';
    readonly version: number;
    readonly sourceDigest: `sha256:${string}`;
    readonly decks: readonly PublicDeckMetadata[];
}
export interface CatalogDeckForEntitlement extends PublicDeckMetadata {
    /** 메타데이터는 노출하되 Free 사용자가 Pro 본문을 열 수 없으면 true다. */
    readonly locked: boolean;
    /** 승인·발행된 본문이 실제로 존재할 때만 true다. */
    readonly available: boolean;
}
export interface PublishedCardMedia {
    readonly kind: 'image' | 'audio';
    readonly uri: string;
    readonly alt: string;
    readonly licenseRef: string;
}
export interface PublishedCard {
    readonly id: string;
    readonly deckId: string;
    readonly index: number;
    readonly front: string;
    readonly back: string;
    readonly hint?: string;
    readonly reading?: string;
    readonly example?: string;
    readonly exampleMeaning?: string;
    readonly media?: PublishedCardMedia;
    readonly tags: readonly string[];
    readonly difficulty: 1 | 2 | 3 | 4 | 5;
    readonly sourceRefs: readonly string[];
}
export interface PublishedDeckChunk {
    readonly chunkIndex: number;
    readonly checksum: `sha256:${string}`;
    readonly cards: readonly PublishedCard[];
}
/** `@daoewo/product-catalog/published-content` server-only subpath의 값이다. */
export interface PublishedDeckContent {
    readonly deckId: string;
    readonly version: number;
    readonly chunkSize: 200;
    readonly cardCount: number;
    readonly publishedAt: string;
    readonly publicationDigest: `sha256:${string}`;
    readonly chunks: readonly PublishedDeckChunk[];
}
//# sourceMappingURL=types.d.ts.map