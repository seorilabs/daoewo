import type { CatalogDeckMetadata, Deck, Entitlement } from '../domain/entities.js';
import { isEntitled } from './entitlement.js';

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
export function filterCatalogMetadata(
  decks: readonly Deck[],
  filter: CatalogMetadataFilter,
  entitlement: Entitlement,
  now: Date,
): CatalogDeckMetadata[] {
  const pro = isEntitled(entitlement, now);
  const category = normalized(filter.category);
  const locale = normalized(filter.locale);
  const query = normalized(filter.query);
  const tags = (filter.tags ?? []).map((tag) => normalized(tag)).filter((tag) => tag.length > 0);

  return decks
    .filter((deck) => category.length === 0 || normalized(deck.category) === category)
    .filter((deck) => locale.length === 0 || normalized(deck.locale) === locale)
    .filter((deck) => {
      const deckTags = new Set(deck.tags.map((tag) => normalized(tag)));
      return tags.every((tag) => deckTags.has(tag));
    })
    .filter((deck) => {
      if (query.length === 0) {
        return true;
      }

      return [deck.title, deck.category, deck.level, ...deck.tags]
        .map((value) => normalized(value))
        .some((value) => value.includes(query));
    })
    .map((deck) => ({
      ...deck,
      isLocked: deck.tier === 'pro' && !pro,
    }));
}

function normalized(value: string | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? '';
}
