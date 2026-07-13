import { buildDueReviewQueue, createStudyGoal, daysBetweenDateKeys, evaluateDeckActivation, getStudyGoalEndDate, isEntitled, mergeLearningBackupSnapshots, resolveDailyCardLimit, toDateKey, } from '@daoewo/product-core';
import { BUNDLED_FREE_DECK_CONTENT } from './bundled-free-content.generated.js';
import { PUBLIC_CATALOG } from './catalog.generated.js';
const STORAGE_PREFIX = 'daoewo:bundled-free-content:v1';
const FREE_ENTITLEMENT = Object.freeze({
    plan: 'free',
    source: 'bundled-free-content',
    validUntil: null,
});
export { BUNDLED_FREE_DECK_CONTENT } from './bundled-free-content.generated.js';
const EMPTY_STATE = Object.freeze({
    version: 2,
    activeDeckIds: [],
    goals: [],
    progresses: [],
    windows: [],
});
/**
 * 앱에 번들된 Free 본문 전용 로컬 adapter다. Pro 본문/entitlement/server window는
 * 이 경계로 들어올 수 없다.
 */
export function createBundledFreeContentAdapter(options) {
    const content = options.content ?? BUNDLED_FREE_DECK_CONTENT;
    const now = options.now ?? (() => new Date());
    const getEntitlement = options.getEntitlement ?? (async () => FREE_ENTITLEMENT);
    assertClientSafeContent(content);
    async function ownerContext(expectedOwnerId) {
        const ownerId = requireOwnerId(expectedOwnerId ?? await options.getOwnerId());
        const key = bundledFreeStorageKey(ownerId);
        const raw = await options.storage.getItem(key);
        const state = parseState(raw);
        if (!isBundledFreeStateV2(raw)) {
            await options.storage.setItem(key, state);
        }
        return {
            ownerId,
            key,
            state,
        };
    }
    return {
        hasDeck(deckId) {
            return getContent(content, deckId) !== null;
        },
        async createGoal(input) {
            const deckContent = requireContent(content, input.deckId);
            assertPositiveInteger(input.value, 'value');
            const context = await ownerContext();
            const entitlement = await getEntitlement();
            const activation = evaluateDeckActivation({
                deck: { id: input.deckId, tier: 'free' },
                activeDeckIds: context.state.activeDeckIds,
                entitlement,
                now: now(),
            });
            if (!activation.allowed) {
                throw new Error('Free 플랜은 활성 덱을 1개만 사용할 수 있어요.');
            }
            const cardIds = flattenCards(deckContent).map(card => card.id);
            const dailyLimit = resolveDailyCardLimit(entitlement, cardIds.length, now());
            const value = input.mode === 'daily-count'
                ? Math.min(input.value, dailyLimit)
                : Math.max(input.value, Math.ceil(cardIds.length / dailyLimit));
            const goal = createStudyGoal({ ...input, cardIds, value });
            const nextState = {
                version: 2,
                activeDeckIds: isEntitled(entitlement, now())
                    ? mergeUnique(context.state.activeDeckIds, [input.deckId])
                    : [input.deckId],
                goals: [
                    ...context.state.goals.filter(item => item.deckId !== input.deckId),
                    goal,
                ],
                progresses: context.state.progresses,
                windows: context.state.windows.filter(item => item.deckId !== input.deckId),
            };
            await options.storage.setItem(context.key, nextState);
            return goal;
        },
        async getCardWindow(input) {
            const deckContent = requireContent(content, input.deckId);
            const context = await ownerContext();
            const goal = context.state.goals.find(item => item.deckId === input.deckId &&
                (input.goalKey === undefined || item.key === input.goalKey));
            if (goal === undefined ||
                !context.state.activeDeckIds.includes(input.deckId)) {
                throw new Error('활성화된 Free 학습 목표를 찾을 수 없어요.');
            }
            const current = now();
            const entitlement = await getEntitlement();
            const date = toDateKey(current);
            const dueIds = buildDueReviewQueue(context.state.progresses.filter(item => item.deckId === input.deckId), current).map(item => item.cardId);
            const progressedIds = new Set(context.state.progresses
                .filter(item => item.deckId === input.deckId)
                .map(item => item.cardId));
            // due 카드가 60장 한도를 차지해 당일 신규 카드가 밀려도 다음 날 backlog로 회수한다.
            const assignedIds = Object.entries(goal.assignments)
                .filter(([assignmentDate]) => assignmentDate <= date)
                .sort(([left], [right]) => left.localeCompare(right))
                .flatMap(([, cardIds]) => cardIds)
                .filter(cardId => !progressedIds.has(cardId));
            const candidateIds = [...new Set([...dueIds, ...assignedIds])];
            const limit = resolveDailyCardLimit(entitlement, candidateIds.length, current);
            const cardsById = new Map(flattenCards(deckContent).map(card => [card.id, card]));
            const cards = candidateIds
                .slice(0, limit)
                .map(cardId => cardsById.get(cardId))
                .filter((card) => card !== undefined);
            const window = {
                id: `bundled-free:${input.deckId}:${date}`,
                deckId: input.deckId,
                goalKey: goal.key,
                date,
                cardIds: cards.map(card => card.id),
            };
            await options.storage.setItem(context.key, {
                ...context.state,
                windows: [
                    ...context.state.windows.filter(item => !(item.deckId === input.deckId && item.date === date)),
                    window,
                ],
            });
            return { ...window, cards, targetCount: cards.length };
        },
        async commitProgressBatch(batch) {
            const deckContent = requireContent(content, batch.deckId);
            const context = await ownerContext();
            const window = context.state.windows.find(item => item.id === batch.windowId && item.deckId === batch.deckId);
            if (window === undefined) {
                throw new Error('Free 학습 창을 찾을 수 없어요.');
            }
            if (batch.goalKey !== undefined && batch.goalKey !== window.goalKey) {
                throw new Error('Free 학습 목표와 학습 창이 일치하지 않아요.');
            }
            const knownCardIds = new Set(flattenCards(deckContent).map(card => card.id));
            const windowCardIds = new Set(window.cardIds);
            const progressIds = batch.progresses.map(progress => progress.cardId);
            if (batch.progresses.some(progress => progress.deckId !== batch.deckId ||
                !knownCardIds.has(progress.cardId) ||
                !windowCardIds.has(progress.cardId)) ||
                new Set(progressIds).size !== progressIds.length) {
                throw new Error('Free 학습 창 밖의 진도는 저장할 수 없어요.');
            }
            const accepted = batch.progresses;
            const replacementKeys = new Set(accepted.map(progress => `${progress.deckId}:${progress.cardId}`));
            const progresses = [
                ...context.state.progresses.filter(progress => !replacementKeys.has(`${progress.deckId}:${progress.cardId}`)),
                ...accepted,
            ];
            await options.storage.setItem(context.key, {
                ...context.state,
                progresses,
            });
        },
        async getDeckSummary(deckId) {
            requireContent(content, deckId);
            const context = await ownerContext();
            const goal = context.state.goals.find(item => item.deckId === deckId);
            if (goal === undefined) {
                return null;
            }
            const completed = new Set(context.state.progresses
                .filter(item => item.deckId === deckId && item.firstSeenAt !== null)
                .map(item => item.cardId)).size;
            const endDate = getStudyGoalEndDate(goal);
            return {
                active: context.state.activeDeckIds.includes(deckId),
                progress: goal.totalCount === 0
                    ? 0
                    : Math.min(1, completed / goal.totalCount),
                daysLeft: Math.max(0, daysBetweenDateKeys(toDateKey(now()), endDate) + 1),
            };
        },
        async exportLearningBackup(ownerId) {
            const context = await ownerContext(ownerId);
            return stateToFreeDecks(context.state, content);
        },
        async importLearningBackup(freeDecks, ownerId) {
            const context = await ownerContext(ownerId);
            validateFreeDeckSnapshots(freeDecks, content);
            const entitlement = await getEntitlement();
            const merged = mergeLearningBackupSnapshots({
                version: 1,
                freeDecks: stateToFreeDecks(context.state, content),
                sessions: [],
            }, { version: 1, freeDecks, sessions: [] }, isEntitled(entitlement, now()));
            await options.storage.setItem(context.key, freeDecksToState(merged.freeDecks, context.state.windows));
        },
        async getCardsByIds(cards) {
            return cards.flatMap(({ deckId, cardId }) => {
                const deck = getContent(content, deckId);
                if (deck === null)
                    return [];
                const card = flattenCards(deck).find(item => item.id === cardId);
                return card === undefined ? [] : [card];
            });
        },
        async mergeOwnerState(sourceOwnerId, targetOwnerId) {
            const sourceKey = bundledFreeStorageKey(sourceOwnerId);
            const targetKey = bundledFreeStorageKey(targetOwnerId);
            if (sourceKey === targetKey) {
                return;
            }
            const [source, target] = await Promise.all([
                options.storage.getItem(sourceKey).then(parseState),
                options.storage.getItem(targetKey).then(parseState),
            ]);
            const entitlement = await getEntitlement();
            const mergedBackup = mergeLearningBackupSnapshots({ version: 1, freeDecks: stateToFreeDecks(source, content), sessions: [] }, { version: 1, freeDecks: stateToFreeDecks(target, content), sessions: [] }, isEntitled(entitlement, now()));
            const merged = freeDecksToState(mergedBackup.freeDecks, target.windows);
            await options.storage.setItem(targetKey, merged);
            await options.storage.removeItem(sourceKey);
        },
        async removeOwnerState(ownerId) {
            await options.storage.removeItem(bundledFreeStorageKey(ownerId));
        },
    };
}
export function getBundledFreeDeckContent(deckId) {
    return getContent(BUNDLED_FREE_DECK_CONTENT, deckId);
}
export function bundledFreeStorageKey(ownerId) {
    return `${STORAGE_PREFIX}:${encodeURIComponent(requireOwnerId(ownerId))}`;
}
function requireOwnerId(ownerId) {
    const normalized = ownerId?.trim() ?? '';
    if (normalized.length === 0) {
        throw new Error('Free 학습 기록 소유자 식별자가 필요해요.');
    }
    return normalized;
}
function getContent(content, deckId) {
    const normalized = deckId.trim();
    return normalized.length === 0 ? null : content[normalized] ?? null;
}
function requireContent(content, deckId) {
    const found = getContent(content, deckId);
    if (found === null) {
        throw new Error('승인된 Free 덱 본문이 아직 준비되지 않았어요.');
    }
    return found;
}
function flattenCards(content) {
    return content.chunks.flatMap(chunk => chunk.cards);
}
function assertClientSafeContent(content) {
    const tierByDeckId = new Map(PUBLIC_CATALOG.decks.map(deck => [deck.id, deck.tier]));
    for (const [deckId, deckContent] of Object.entries(content)) {
        if (tierByDeckId.get(deckId) !== 'free') {
            throw new Error(`client-safe bundle에는 Free 덱만 포함할 수 있어요: ${deckId}`);
        }
        const cards = flattenCards(deckContent);
        if (deckContent.deckId !== deckId ||
            cards.length !== deckContent.cardCount ||
            cards.some((card, index) => card.deckId !== deckId || card.index !== index) ||
            new Set(cards.map(card => card.id)).size !== cards.length) {
            throw new Error(`client-safe Free 덱 본문이 검증 결과와 다릅니다: ${deckId}`);
        }
    }
}
function parseState(value) {
    if (isBundledFreeStateV2(value)) {
        return value;
    }
    if (isBundledFreeStateV1(value)) {
        return {
            version: 2,
            activeDeckIds: value.activeDeckId === null ? [] : [value.activeDeckId],
            goals: value.goals,
            progresses: value.progresses,
            windows: value.windows,
        };
    }
    return EMPTY_STATE;
}
function isBundledFreeStateV1(value) {
    if (typeof value !== 'object' ||
        value === null ||
        value.version !== 1 ||
        !Array.isArray(value.goals) ||
        !Array.isArray(value.progresses) ||
        !Array.isArray(value.windows)) {
        return false;
    }
    const state = value;
    if (state.activeDeckId !== null && typeof state.activeDeckId !== 'string') {
        return false;
    }
    return true;
}
function isBundledFreeStateV2(value) {
    return (typeof value === 'object' &&
        value !== null &&
        value.version === 2 &&
        Array.isArray(value.activeDeckIds) &&
        value.activeDeckIds.every(item => typeof item === 'string') &&
        Array.isArray(value.goals) &&
        Array.isArray(value.progresses) &&
        Array.isArray(value.windows));
}
function assertPositiveInteger(value, field) {
    if (!Number.isInteger(value) || value <= 0) {
        throw new RangeError(`${field} must be a positive integer`);
    }
}
function stateToFreeDecks(state, content) {
    const deckIds = new Set([
        ...state.activeDeckIds,
        ...state.goals.map(goal => goal.deckId),
        ...state.progresses.map(progress => progress.deckId),
    ]);
    return [...deckIds]
        .sort()
        .flatMap(deckId => {
        const deck = getContent(content, deckId);
        if (deck === null)
            return [];
        const indexById = new Map(flattenCards(deck).map(card => [card.id, card.index]));
        return [{
                deckId,
                deckVersion: deck.version,
                active: state.activeDeckIds.includes(deckId),
                goal: state.goals.find(goal => goal.deckId === deckId) ?? null,
                progresses: state.progresses
                    .filter(progress => progress.deckId === deckId)
                    .flatMap(progress => {
                    const cardIndex = indexById.get(progress.cardId);
                    return cardIndex === undefined ? [] : [{ cardIndex, state: progress }];
                }),
            }];
    });
}
function freeDecksToState(freeDecks, windows) {
    const goals = freeDecks.flatMap(deck => deck.goal === null ? [] : [deck.goal]);
    const goalKeys = new Set(goals.map(goal => goal.key));
    return {
        version: 2,
        activeDeckIds: freeDecks
            .filter(deck => deck.active)
            .map(deck => deck.deckId),
        goals,
        progresses: freeDecks.flatMap(deck => deck.progresses.map(progress => progress.state)),
        windows: windows.filter(window => goalKeys.has(window.goalKey)),
    };
}
function validateFreeDeckSnapshots(freeDecks, content) {
    const seen = new Set();
    for (const snapshot of freeDecks) {
        if (seen.has(snapshot.deckId)) {
            throw new Error('Free sync snapshot에 중복 덱이 있어요.');
        }
        seen.add(snapshot.deckId);
        const deck = requireContent(content, snapshot.deckId);
        if (deck.version !== snapshot.deckVersion) {
            throw new Error('Free sync snapshot의 덱 버전이 현재 bundle과 달라요.');
        }
        if (snapshot.goal !== null && snapshot.goal.deckId !== snapshot.deckId) {
            throw new Error('Free sync snapshot의 목표 덱이 일치하지 않아요.');
        }
        const cards = flattenCards(deck);
        for (const progress of snapshot.progresses) {
            const card = cards[progress.cardIndex];
            if (card === undefined ||
                card.id !== progress.state.cardId ||
                progress.state.deckId !== snapshot.deckId) {
                throw new Error('Free sync snapshot의 카드 index와 진도가 일치하지 않아요.');
            }
        }
    }
}
function mergeUnique(first, second) {
    return [...new Set([...first, ...second])];
}
//# sourceMappingURL=bundled-free-content.js.map