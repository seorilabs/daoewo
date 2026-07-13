import {
  EMPTY_LEARNING_BACKUP_SNAPSHOT,
  isEntitled,
  mergeLearningBackupSnapshots,
  type CardProgress,
  type Entitlement,
  type FreeDeckLearningSnapshot,
  type LearningBackupSnapshot,
  type LearningSyncSnapshot,
  type SyncEnvelope,
} from '@daoewo/product-core';

import type {DaoewoCardView} from './demo-data';
import type {DaoewoSyncPort} from './runtime';

export interface LearningSyncServerState {
  readonly progress?: readonly {
    readonly cards?: Readonly<
      Record<string, {readonly state?: CardProgress} | CardProgress>
    >;
  }[];
  readonly learningBackup?: {
    readonly revision: number;
    readonly updatedAt: string;
    readonly lastMutationId?: string;
    readonly snapshot: LearningBackupSnapshot;
  };
}

export interface LearningSyncPushInput {
  readonly baseRevision: number;
  readonly mutationId: string;
  readonly snapshot: LearningBackupSnapshot;
}

export interface LearningSyncTransport {
  pull(userId: string): Promise<LearningSyncServerState>;
  push(
    userId: string,
    input: LearningSyncPushInput,
  ): Promise<LearningSyncServerState>;
}

export interface LocalFreeLearningAdapter {
  exportLearningBackup(
    ownerId: string,
  ): Promise<readonly FreeDeckLearningSnapshot[]>;
  importLearningBackup(
    ownerId: string,
    freeDecks: readonly FreeDeckLearningSnapshot[],
  ): Promise<void>;
  resolveFreeCardSnapshots(
    cards: readonly {readonly deckId: string; readonly cardId: string}[],
  ): Promise<readonly DaoewoCardView[]>;
}

export function createLearningSyncPort(input: {
  readonly transport: LearningSyncTransport;
  readonly localFree: LocalFreeLearningAdapter;
  readonly getEntitlement: () => Promise<Entitlement>;
  readonly now?: () => Date;
  readonly createMutationId?: () => string;
  readonly canSync?: (userId: string) => Promise<boolean>;
}): DaoewoSyncPort {
  const now = input.now ?? (() => new Date());
  const createMutationId = input.createMutationId ?? defaultMutationId;

  async function allowMultipleActiveDecks(): Promise<boolean> {
    const entitlement = await input.getEntitlement().catch(() => null);
    return entitlement !== null && isEntitled(entitlement, now());
  }

  async function mergeWithLocal(
    userId: string,
    envelope: SyncEnvelope<LearningSyncSnapshot>,
  ): Promise<SyncEnvelope<LearningSyncSnapshot>> {
    const localFreeDecks = await input.localFree.exportLearningBackup(userId);
    const backup = mergeLearningBackupSnapshots(
      envelope.snapshot.backup,
      {version: 1, freeDecks: localFreeDecks, sessions: []},
      await allowMultipleActiveDecks(),
    );
    await input.localFree.importLearningBackup(userId, backup.freeDecks);
    return {
      ...envelope,
      snapshot: {...envelope.snapshot, backup},
    };
  }

  return {
    availability: 'cloud',
    async pull(userId) {
      if (input.canSync !== undefined && !(await input.canSync(userId))) {
        return null;
      }
      const response = await input.transport.pull(userId);
      if (input.canSync !== undefined && !(await input.canSync(userId))) {
        return null;
      }
      return mergeWithLocal(userId, serverStateToEnvelope(response));
    },
    async push(userId, envelope) {
      if (input.canSync !== undefined && !(await input.canSync(userId))) {
        return envelope;
      }
      const local = await mergeWithLocal(userId, envelope);
      if (input.canSync !== undefined && !(await input.canSync(userId))) {
        return envelope;
      }
      const response = await input.transport.push(userId, {
        baseRevision: local.revision,
        mutationId: createMutationId(),
        snapshot: cloneBackup(local.snapshot.backup),
      });
      if (input.canSync !== undefined && !(await input.canSync(userId))) {
        return envelope;
      }
      return mergeWithLocal(userId, serverStateToEnvelope(response));
    },
    resolveFreeCardSnapshots(cards) {
      return input.localFree.resolveFreeCardSnapshots(cards);
    },
  };
}

export function serverStateToEnvelope(
  state: LearningSyncServerState,
): SyncEnvelope<LearningSyncSnapshot> {
  const learningBackup = state.learningBackup;
  const backup = learningBackup?.snapshot ?? EMPTY_LEARNING_BACKUP_SNAPSHOT;
  assertLearningBackupSnapshot(backup);
  const authoritativeProgresses = (state.progress ?? []).flatMap(item =>
    Object.values(item.cards ?? {}).flatMap(value => {
      const candidate = isStoredProgress(value) ? value.state : value;
      return isCardProgress(candidate) ? [cloneCardProgress(candidate)] : [];
    }),
  );
  return {
    revision: learningBackup?.revision ?? 0,
    updatedAt: learningBackup?.updatedAt ?? '1970-01-01T00:00:00.000Z',
    snapshot: {backup: cloneBackup(backup), authoritativeProgresses},
  };
}

function assertLearningBackupSnapshot(
  value: LearningBackupSnapshot,
): void {
  if (
    value.version !== 1 ||
    !Array.isArray(value.freeDecks) ||
    !Array.isArray(value.sessions)
  ) {
    throw new Error('학습 백업 응답 형식을 확인할 수 없어요.');
  }
}

function cloneBackup(value: LearningBackupSnapshot): LearningBackupSnapshot {
  return {
    version: 1,
    freeDecks: value.freeDecks.map(deck => ({
      deckId: deck.deckId,
      deckVersion: deck.deckVersion,
      active: deck.active,
      goal:
        deck.goal === null
          ? null
          : {
              key: deck.goal.key,
              deckId: deck.goal.deckId,
              mode: deck.goal.mode,
              startDate: deck.goal.startDate,
              totalCount: deck.goal.totalCount,
              days: deck.goal.days,
              dailyCount: deck.goal.dailyCount,
              assignments: Object.fromEntries(
                Object.entries(deck.goal.assignments).map(([date, ids]) => [
                  date,
                  [...ids],
                ]),
              ),
            },
      progresses: deck.progresses.map(progress => ({
        cardIndex: progress.cardIndex,
        state: cloneCardProgress(progress.state),
      })),
    })),
    sessions: value.sessions.map(session => ({
      id: session.id,
      deckId: session.deckId,
      date: session.date,
      target: session.target,
      completed: session.completed,
      known: session.known,
      unknown: session.unknown,
      reviewCount: session.reviewCount,
      elapsedMs: session.elapsedMs,
      completedAt: session.completedAt,
    })),
  };
}

function isStoredProgress(
  value: {readonly state?: CardProgress} | CardProgress,
): value is {readonly state: CardProgress} {
  return 'state' in value && value.state !== undefined;
}

function isCardProgress(value: unknown): value is CardProgress {
  if (typeof value !== 'object' || value === null) return false;
  const progress = value as Partial<CardProgress>;
  return (
    typeof progress.cardId === 'string' &&
    typeof progress.deckId === 'string' &&
    typeof progress.updatedAt === 'string' &&
    typeof progress.knownCount === 'number' &&
    typeof progress.unknownCount === 'number' &&
    typeof progress.reviewCount === 'number'
  );
}

function cloneCardProgress(progress: CardProgress): CardProgress {
  return {
    cardId: progress.cardId,
    deckId: progress.deckId,
    status: progress.status,
    knownCount: progress.knownCount,
    unknownCount: progress.unknownCount,
    reviewCount: progress.reviewCount,
    streak: progress.streak,
    nextReviewAt: progress.nextReviewAt,
    lastOutcome: progress.lastOutcome,
    firstSeenAt: progress.firstSeenAt,
    lastSeenAt: progress.lastSeenAt,
    updatedAt: progress.updatedAt,
  };
}

function defaultMutationId(): string {
  const random = `${Math.random().toString(36).slice(2)}${Math.random()
    .toString(36)
    .slice(2)}`;
  return `sync_${Date.now().toString(36)}_${random}`.slice(0, 80);
}
