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
  learningBackup: LearningBackupEnvelope;
}

/**
 * 클라이언트의 Free 번들 목표는 서버 delivery goal과 식별자 체계가 다르므로
 * 별도 wire type으로 유지한다. 카드 본문은 이 계약에 들어올 수 없다.
 */
export interface ClientStudyGoal {
  key: string;
  deckId: string;
  mode: "days" | "daily-count";
  startDate: string;
  totalCount: number;
  days: number;
  dailyCount: number;
  assignments: Record<string, string[]>;
}

export interface LearningBackupProgress {
  cardIndex: number;
  state: CardProgress;
}

export interface LearningBackupFreeDeck {
  deckId: string;
  deckVersion: number;
  active: boolean;
  goal: ClientStudyGoal | null;
  progresses: LearningBackupProgress[];
}

export interface LearningBackupSession {
  id: string;
  deckId: string;
  date: string;
  target: number;
  completed: number;
  known: number;
  unknown: number;
  reviewCount: number;
  elapsedMs: number;
  completedAt: string;
}

export interface LearningBackupSnapshot {
  version: 1;
  freeDecks: LearningBackupFreeDeck[];
  sessions: LearningBackupSession[];
}

export interface LearningBackupEnvelope {
  revision: number;
  updatedAt: string;
  lastMutationId?: string;
  snapshot: LearningBackupSnapshot;
}

export interface PushLearningBackupInput {
  deviceId: string;
  baseRevision: number;
  mutationId: string;
  snapshot: LearningBackupSnapshot;
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
  status: "queued" | "ready";
  priority: "normal" | "pro";
  createdAt: string;
  updatedAt: string;
  readyDeckId?: string;
  readyRevision?: number;
  readyAt?: string;
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};
