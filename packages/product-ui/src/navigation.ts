export type DaoewoScreen =
  | 'onboarding'
  | 'home'
  | 'deck-detail'
  | 'study'
  | 'quick-review'
  | 'mistakes'
  | 'catalog'
  | 'deck-request'
  | 'statistics'
  | 'paywall'
  | 'settings';

export type {ReviewRating} from '@daoewo/product-core';

export type SubscriptionPlan = 'monthly' | 'annual';

export type GoalMode = import('@daoewo/product-core').StudyGoalMode;
