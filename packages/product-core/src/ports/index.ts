import type {
  Card,
  CardProgress,
  CatalogDeckMetadata,
  Deck,
  DeckRequest,
  Entitlement,
  ReviewQueueItem,
} from '../domain/entities.js';

export interface StoragePort {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface AuthSession {
  readonly userId: string;
  readonly provider: string;
  readonly isAnonymous: boolean;
}

export interface AuthPort {
  getCurrentSession(): Promise<AuthSession | null>;
  signIn(provider: string): Promise<AuthSession>;
  signOut(): Promise<void>;
}

export interface SyncEnvelope<TSnapshot> {
  readonly revision: number;
  readonly updatedAt: string;
  readonly snapshot: TSnapshot;
}

export interface SyncPort<TSnapshot = unknown> {
  pull(userId: string): Promise<SyncEnvelope<TSnapshot> | null>;
  push(userId: string, envelope: SyncEnvelope<TSnapshot>): Promise<SyncEnvelope<TSnapshot>>;
}

export interface CatalogPort<TMedia = unknown> {
  listMetadata(): Promise<readonly CatalogDeckMetadata[]>;
  getDeck(deckId: string): Promise<Deck | null>;
  getCards(deckId: string, offset: number, limit: number): Promise<readonly Card<TMedia>[]>;
}

export interface DeliveredSession {
  readonly sessionId: string;
  readonly deckId: string;
  readonly cardIds: readonly string[];
  readonly deliveredAt: string;
}

export interface SessionDeliveryPort {
  deliver(input: {
    readonly userId: string;
    readonly deckId: string;
    readonly cardIds: readonly string[];
  }): Promise<DeliveredSession>;
}

export interface ProgressSnapshot {
  readonly progresses: readonly CardProgress[];
  readonly reviewQueue: readonly ReviewQueueItem[];
  readonly updatedAt: string;
}

export interface ProgressSyncPort {
  load(userId: string, deckId: string): Promise<ProgressSnapshot | null>;
  save(userId: string, deckId: string, snapshot: ProgressSnapshot): Promise<void>;
}

export interface DeckRequestPort {
  submit(request: DeckRequest): Promise<DeckRequest>;
  get(requestId: string): Promise<DeckRequest | null>;
}

export interface EntitlementPort {
  get(userId: string): Promise<Entitlement>;
  restore(userId: string): Promise<Entitlement>;
}

export type AnalyticsValue = string | number | boolean | null;

export interface AnalyticsPort {
  track(event: string, properties?: Readonly<Record<string, AnalyticsValue>>): Promise<void> | void;
  identify(userId: string | null): Promise<void> | void;
}

export interface ClockPort {
  now(): Date;
}

export interface RemoteConfigPort {
  getBoolean(key: string, fallback: boolean): boolean;
  getNumber(key: string, fallback: number): number;
  getString(key: string, fallback: string): string;
}

export type NotificationPermission = 'unknown' | 'granted' | 'denied' | 'unsupported';

export interface NotificationSchedule {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly deliverAt: string;
}

export interface NotificationPort {
  getPermission(): Promise<NotificationPermission>;
  requestPermission(): Promise<NotificationPermission>;
  schedule(notification: NotificationSchedule): Promise<void>;
  cancel(notificationId: string): Promise<void>;
}
