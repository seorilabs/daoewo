import {
  calculateNextReview,
  classifySwipe,
  createInitialCardProgress,
  evaluateDeckActivation,
  type CardProgress,
  type Entitlement,
  type ReviewRating,
  type SwipeDirection,
} from '@daoewo/product-core';

import type {DaoewoCardView, DaoewoDeckTier, DaoewoDeckView} from './demo-data';

export function classifyDemoCard(
  card: DaoewoCardView,
  direction: SwipeDirection,
  now: Date,
  previous?: CardProgress,
): CardProgress {
  const progress =
    previous ?? createInitialCardProgress(card.id, card.deckId, now);
  return classifySwipe(progress, direction, now);
}

export function reviewDemoCard(
  card: DaoewoCardView,
  rating: ReviewRating,
  now: Date,
  previous?: CardProgress,
): CardProgress {
  const progress =
    previous ?? classifyDemoCard(card, 'unknown', now);
  return calculateNextReview(progress, rating, now);
}

export function canActivateDeck(
  deck: DaoewoDeckView,
  activeDeckIds: readonly string[],
  entitlement: Entitlement,
  now: Date,
) {
  return evaluateDeckActivation({
    deck: {id: deck.id, tier: deck.tier},
    activeDeckIds,
    entitlement,
    now,
  });
}

export interface DaoewoCatalogFilter {
  readonly query: string;
  readonly category?: string;
  readonly tier?: 'all' | DaoewoDeckTier;
}

export function filterDaoewoCatalog(
  decks: readonly DaoewoDeckView[],
  filter: DaoewoCatalogFilter,
): readonly DaoewoDeckView[] {
  const query = filter.query.trim().toLocaleLowerCase('ko-KR');
  const category = filter.category?.trim().toLocaleLowerCase('ko-KR') ?? '';

  return decks
    .filter(
      deck =>
        category.length === 0 ||
        deck.category.toLocaleLowerCase('ko-KR') === category,
    )
    .filter(deck => {
      if (query.length === 0) {
        return true;
      }
      return [deck.title, deck.subtitle, deck.category, deck.locale, ...deck.tags]
        .map(value => value.toLocaleLowerCase('ko-KR'))
        .some(value => value.includes(query));
    })
    .filter(
      deck =>
        filter.tier == null ||
        filter.tier === 'all' ||
        deck.tier === filter.tier,
    );
}
