import type { CardProgress, Entitlement, ReviewRating } from "@daoewo/product-core";

export type DeckTier = "free" | "pro";
export type DeckStatus = "draft" | "published" | "archived";

export interface DeckMetadata {
  id: string;
  title: string;
  description: string;
  category: string;
  language: string;
  tier: DeckTier;
  status: DeckStatus;
  version: number;
  cardCount: number;
  chunkSize: number;
  coverImageUrl?: string;
  tags: string[];
  publishedAt: string;
  updatedAt: string;
}

export interface CatalogDeck extends DeckMetadata {
  locked: boolean;
}

export interface StudyCard {
  id: string;
  index: number;
  front: string;
  back: string;
  hint?: string;
  example?: string;
  tags?: string[];
}

export interface StudyGoal {
  id: string;
  uid: string;
  deckId: string;
  deckVersion: number;
  active: boolean;
  targetCount: number;
  dailyTarget?: number;
  startDate: string;
  endDate?: string;
  timezone: string;
  assignments: Record<string, number[]>;
  createdAt: string;
  updatedAt: string;
  lastResetAt?: string;
  revision: number;
}

export interface SyncState {
  goals: StudyGoal[];
  progress: DeckProgress[];
}

export interface DeckProgress {
  uid: string;
  deckId: string;
  deckVersion: number;
  cards: Record<string, StoredCardProgress>;
  deliveredCardIds: string[];
  recentBatches: Record<string, ProgressBatchReceipt>;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface StoredCardProgress {
  cardIndex: number;
  state: CardProgress;
}

export interface ProgressBatchReceipt {
  submittedAt: string;
  updatedCount: number;
  windowId: string;
}

export interface DeliveryWindow {
  id: string;
  uid: string;
  goalId: string;
  deckId: string;
  deckVersion: number;
  dateKey: string;
  quotaDateKey: string;
  premium: boolean;
  deviceHash: string;
  cardIds: string[];
  cardIndexes: number[];
  issuedAt: string;
  expiresAt: string;
  completedAt?: string;
  batchId?: string;
}

export interface ProgressAnswer {
  cardId: string;
  rating: ReviewRating;
}

export interface EntitlementRecord {
  entitlement: Entitlement;
  source: "google-play" | "app-store" | "apps-in-toss" | "admin";
  productId: string;
  originalTransactionId: string;
  verifiedAt: string;
  updatedAt: string;
}

export interface DeckRequestRecord {
  id: string;
  uid: string;
  topic: string;
  category: string;
  language: string;
  note?: string;
  status: "queued";
  priority: "normal" | "pro";
  createdAt: string;
  updatedAt: string;
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};
