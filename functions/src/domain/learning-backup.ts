import type {
  LearningBackupEnvelope,
  LearningBackupFreeDeck,
  LearningBackupProgress,
  LearningBackupSession,
  LearningBackupSnapshot,
} from "./types.js";

export const MAX_BACKUP_FREE_DECKS = 6;
export const MAX_BACKUP_PROGRESS_PER_DECK = 2_000;
export const MAX_BACKUP_SESSIONS = 400;
export const MAX_RECENT_BACKUP_MUTATIONS = 32;

export const EMPTY_LEARNING_BACKUP_SNAPSHOT: LearningBackupSnapshot = {
  version: 1,
  freeDecks: [],
  sessions: [],
};

export function emptyLearningBackupEnvelope(): LearningBackupEnvelope {
  return {
    revision: 0,
    updatedAt: "1970-01-01T00:00:00.000Z",
    snapshot: EMPTY_LEARNING_BACKUP_SNAPSHOT,
  };
}

/**
 * 같은 base revision에서 시작한 기기들은 timestamp와 canonical tie-break로
 * 동일한 결과에 수렴한다. 정확히 최신 revision을 본 push만 goal/active intent를
 * 우선하며, 진도와 세션은 언제나 항목별 최신값을 보존한다.
 */
export function mergeLearningBackupSnapshots(
  current: LearningBackupSnapshot,
  incoming: LearningBackupSnapshot,
  incomingMetadataWins: boolean,
): LearningBackupSnapshot {
  const currentByDeck = new Map(
    current.freeDecks.map((deck) => [deck.deckId, deck] as const),
  );
  const incomingByDeck = new Map(
    incoming.freeDecks.map((deck) => [deck.deckId, deck] as const),
  );
  const deckIds = [...new Set([...currentByDeck.keys(), ...incomingByDeck.keys()])]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, MAX_BACKUP_FREE_DECKS);

  const freeDecks = deckIds.map((deckId) => {
    const existing = currentByDeck.get(deckId);
    const next = incomingByDeck.get(deckId);
    if (existing === undefined) return cloneFreeDeck(next!);
    if (next === undefined) return cloneFreeDeck(existing);
    return mergeFreeDeck(existing, next, incomingMetadataWins);
  });

  return {
    version: 1,
    freeDecks,
    sessions: mergeSessions(current.sessions, incoming.sessions),
  };
}

function mergeFreeDeck(
  current: LearningBackupFreeDeck,
  incoming: LearningBackupFreeDeck,
  incomingMetadataWins: boolean,
): LearningBackupFreeDeck {
  if (current.deckVersion !== incoming.deckVersion) {
    return cloneFreeDeck(
      current.deckVersion > incoming.deckVersion ? current : incoming,
    );
  }
  const metadata = incomingMetadataWins
    ? incoming
    : canonicalCompare(
          { active: current.active, goal: current.goal },
          { active: incoming.active, goal: incoming.goal },
        ) >= 0
      ? current
      : incoming;
  return {
    deckId: current.deckId,
    deckVersion: current.deckVersion,
    active: metadata.active,
    goal: metadata.goal === null ? null : cloneGoal(metadata.goal),
    progresses: mergeProgresses(current.progresses, incoming.progresses),
  };
}

function mergeProgresses(
  current: readonly LearningBackupProgress[],
  incoming: readonly LearningBackupProgress[],
): LearningBackupProgress[] {
  const merged = new Map<string, LearningBackupProgress>();
  for (const progress of [...current, ...incoming]) {
    const key = progress.state.cardId;
    const existing = merged.get(key);
    if (
      existing === undefined ||
      compareTimestamped(existing, progress, (item) => item.state.updatedAt) < 0
    ) {
      merged.set(key, progress);
    }
  }
  return [...merged.values()]
    .sort(
      (left, right) =>
        left.cardIndex - right.cardIndex ||
        left.state.cardId.localeCompare(right.state.cardId),
    )
    .slice(0, MAX_BACKUP_PROGRESS_PER_DECK)
    .map((item) => ({ cardIndex: item.cardIndex, state: { ...item.state } }));
}

function mergeSessions(
  current: readonly LearningBackupSession[],
  incoming: readonly LearningBackupSession[],
): LearningBackupSession[] {
  const merged = new Map<string, LearningBackupSession>();
  for (const session of [...current, ...incoming]) {
    const existing = merged.get(session.id);
    if (
      existing === undefined ||
      compareTimestamped(existing, session, (item) => item.completedAt) < 0
    ) {
      merged.set(session.id, session);
    }
  }
  return [...merged.values()]
    .sort(
      (left, right) =>
        Date.parse(right.completedAt) - Date.parse(left.completedAt) ||
        left.id.localeCompare(right.id),
    )
    .slice(0, MAX_BACKUP_SESSIONS)
    .sort(
      (left, right) =>
        Date.parse(left.completedAt) - Date.parse(right.completedAt) ||
        left.id.localeCompare(right.id),
    )
    .map((session) => ({ ...session }));
}

function compareTimestamped<T>(
  current: T,
  incoming: T,
  timestampOf: (item: T) => string,
): number {
  const currentTime = Date.parse(timestampOf(current));
  const incomingTime = Date.parse(timestampOf(incoming));
  if (currentTime !== incomingTime) return currentTime - incomingTime;
  return canonicalCompare(current, incoming);
}

function canonicalCompare(left: unknown, right: unknown): number {
  return stableStringify(left).localeCompare(stableStringify(right));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function cloneFreeDeck(deck: LearningBackupFreeDeck): LearningBackupFreeDeck {
  return {
    deckId: deck.deckId,
    deckVersion: deck.deckVersion,
    active: deck.active,
    goal: deck.goal === null ? null : cloneGoal(deck.goal),
    progresses: deck.progresses.map((progress) => ({
      cardIndex: progress.cardIndex,
      state: { ...progress.state },
    })),
  };
}

function cloneGoal(goal: NonNullable<LearningBackupFreeDeck["goal"]>) {
  return {
    ...goal,
    assignments: Object.fromEntries(
      Object.entries(goal.assignments).map(([date, cardIds]) => [
        date,
        [...cardIds],
      ]),
    ),
  };
}
