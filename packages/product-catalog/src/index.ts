import { PUBLIC_CATALOG } from './catalog.generated.js';
import type {
  CatalogDeckForEntitlement,
  CatalogEntitlement,
  PublicDeckMetadata,
} from './types.js';

export { PUBLIC_CATALOG } from './catalog.generated.js';
export type {
  CatalogAvailability,
  CatalogCategory,
  CatalogDeckForEntitlement,
  CatalogEntitlement,
  CatalogPriority,
  CatalogSourceType,
  CatalogTier,
  ContentLanguage,
  PublicCatalog,
  PublicDeckMetadata,
  PublicLicenseSummary,
} from './types.js';

/** 잠금·준비중 상태를 포함해 14개 메타데이터를 항상 반환한다. */
export function listPublicCatalog(entitlement: CatalogEntitlement = 'free'): readonly CatalogDeckForEntitlement[] {
  const decks: readonly PublicDeckMetadata[] = PUBLIC_CATALOG.decks;
  return decks.map((deck) => ({
    ...deck,
    locked: deck.tier === 'pro' && entitlement !== 'pro',
    available: deck.availability === 'published',
  }));
}

export function getPublicDeckMetadata(deckId: string): PublicDeckMetadata | null {
  const decks: readonly PublicDeckMetadata[] = PUBLIC_CATALOG.decks;
  return decks.find((deck) => deck.id === deckId) ?? null;
}
