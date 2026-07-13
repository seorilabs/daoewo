export const EMPTY_LEARNING_BACKUP_SNAPSHOT = Object.freeze({ version: 1, freeDecks: [], sessions: [] });
export function mergeLearningBackupSnapshots(first, second, allowMultipleActiveDecks = false) {
    const deckIds = new Set([
        ...first.freeDecks.map(deck => deck.deckId),
        ...second.freeDecks.map(deck => deck.deckId),
    ]);
    const freeDecks = [...deckIds]
        .sort()
        .map(deckId => mergeFreeDecks(first.freeDecks.find(deck => deck.deckId === deckId), second.freeDecks.find(deck => deck.deckId === deckId)));
    const activeDeckId = allowMultipleActiveDecks
        ? null
        : selectSingleActiveDeck(freeDecks);
    return {
        version: 1,
        freeDecks: freeDecks.map(deck => ({
            ...deck,
            active: allowMultipleActiveDecks ? deck.active : deck.deckId === activeDeckId,
        })),
        sessions: mergeItems(first.sessions, second.sessions, session => session.id, session => parseTimestamp(session.completedAt)).map(cloneSession),
    };
}
export function mergeLearningSyncSnapshots(first, second, allowMultipleActiveDecks = false) {
    return {
        backup: mergeLearningBackupSnapshots(first.backup, second.backup, allowMultipleActiveDecks),
        authoritativeProgresses: mergeCardProgresses(first.authoritativeProgresses, second.authoritativeProgresses),
    };
}
export function mergeCardProgresses(first, second) {
    return mergeItems(first, second, progress => `${progress.deckId}:${progress.cardId}`, progress => parseTimestamp(progress.updatedAt)).map(progress => ({ ...progress }));
}
function mergeFreeDecks(first, second) {
    if (first === undefined && second === undefined) {
        throw new Error('Free deck snapshot is required');
    }
    if (first === undefined)
        return cloneFreeDeck(second);
    if (second === undefined)
        return cloneFreeDeck(first);
    if (first.deckVersion !== second.deckVersion) {
        return cloneFreeDeck(first.deckVersion > second.deckVersion ? first : second);
    }
    return {
        deckId: first.deckId,
        deckVersion: first.deckVersion,
        active: first.active || second.active,
        goal: mergeGoal(first.goal, second.goal),
        progresses: mergeItems(first.progresses, second.progresses, progress => `${progress.state.deckId}:${progress.state.cardId}`, progress => parseTimestamp(progress.state.updatedAt)).map(cloneFreeProgress),
    };
}
function mergeGoal(first, second) {
    if (first === null)
        return second === null ? null : cloneGoal(second);
    if (second === null)
        return cloneGoal(first);
    return cloneGoal(stableStringify(first).localeCompare(stableStringify(second)) < 0
        ? second
        : first);
}
function selectSingleActiveDeck(decks) {
    return (decks
        .filter(deck => deck.active)
        .sort((left, right) => {
        const updatedDifference = latestDeckTimestamp(right) - latestDeckTimestamp(left);
        return updatedDifference || left.deckId.localeCompare(right.deckId);
    })[0]?.deckId ?? null);
}
function latestDeckTimestamp(deck) {
    return Math.max(Number.NEGATIVE_INFINITY, ...deck.progresses.map(progress => parseTimestamp(progress.state.updatedAt)));
}
function mergeItems(first, second, keyOf, rankOf) {
    const merged = new Map();
    for (const item of [...first, ...second]) {
        const key = keyOf(item);
        const current = merged.get(key);
        if (current === undefined ||
            rankOf(item) > rankOf(current) ||
            (rankOf(item) === rankOf(current) &&
                stableStringify(item).localeCompare(stableStringify(current)) > 0)) {
            merged.set(key, item);
        }
    }
    return [...merged.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, item]) => item);
}
function parseTimestamp(value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}
function cloneFreeDeck(deck) {
    return {
        ...deck,
        goal: deck.goal === null ? null : cloneGoal(deck.goal),
        progresses: deck.progresses.map(cloneFreeProgress),
    };
}
function cloneFreeProgress(progress) {
    return { cardIndex: progress.cardIndex, state: { ...progress.state } };
}
function cloneGoal(goal) {
    return {
        ...goal,
        assignments: Object.fromEntries(Object.entries(goal.assignments).map(([date, cardIds]) => [
            date,
            [...cardIds],
        ])),
    };
}
function cloneSession(session) {
    return { ...session };
}
function stableStringify(value) {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    if (typeof value === 'object' && value !== null) {
        const record = value;
        return `{${Object.keys(record)
            .sort()
            .map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value) ?? 'undefined';
}
//# sourceMappingURL=sync.js.map