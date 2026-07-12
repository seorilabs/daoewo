import { buildDueReviewQueue, createStudyGoal, daysBetweenDateKeys, evaluateDeckActivation, getStudyGoalEndDate, resolveDailyCardLimit, toDateKey, } from '@daoewo/product-core';
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
    version: 1,
    activeDeckId: null,
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
    assertClientSafeContent(content);
    async function ownerContext() {
        const ownerId = requireOwnerId(await options.getOwnerId());
        const key = bundledFreeStorageKey(ownerId);
        return {
            ownerId,
            key,
            state: parseState(await options.storage.getItem(key)),
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
            const activation = evaluateDeckActivation({
                deck: { id: input.deckId, tier: 'free' },
                activeDeckIds: context.state.activeDeckId === null
                    ? []
                    : [context.state.activeDeckId],
                entitlement: FREE_ENTITLEMENT,
                now: now(),
            });
            if (!activation.allowed) {
                throw new Error('Free 플랜은 활성 덱을 1개만 사용할 수 있어요.');
            }
            const cardIds = flattenCards(deckContent).map(card => card.id);
            const dailyLimit = resolveDailyCardLimit(FREE_ENTITLEMENT, cardIds.length, now());
            const value = input.mode === 'daily-count'
                ? Math.min(input.value, dailyLimit)
                : Math.max(input.value, Math.ceil(cardIds.length / dailyLimit));
            const goal = createStudyGoal({ ...input, cardIds, value });
            const nextState = {
                version: 1,
                activeDeckId: input.deckId,
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
            if (goal === undefined || context.state.activeDeckId !== input.deckId) {
                throw new Error('활성화된 Free 학습 목표를 찾을 수 없어요.');
            }
            const current = now();
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
            const limit = resolveDailyCardLimit(FREE_ENTITLEMENT, candidateIds.length, current);
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
                active: context.state.activeDeckId === deckId,
                progress: goal.totalCount === 0
                    ? 0
                    : Math.min(1, completed / goal.totalCount),
                daysLeft: Math.max(0, daysBetweenDateKeys(toDateKey(now()), endDate) + 1),
            };
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
            const activeDeckId = target.activeDeckId ?? source.activeDeckId;
            const merged = {
                version: 1,
                activeDeckId,
                goals: mergeByKey(source.goals, target.goals, item => item.deckId),
                progresses: mergeByKey(source.progresses, target.progresses, item => `${item.deckId}:${item.cardId}`, (left, right) => Date.parse(left.updatedAt) > Date.parse(right.updatedAt)
                    ? left
                    : right),
                windows: target.windows,
            };
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
    if (typeof value !== 'object' ||
        value === null ||
        value.version !== 1 ||
        !Array.isArray(value.goals) ||
        !Array.isArray(value.progresses) ||
        !Array.isArray(value.windows)) {
        return EMPTY_STATE;
    }
    const state = value;
    if (state.activeDeckId !== null && typeof state.activeDeckId !== 'string') {
        return EMPTY_STATE;
    }
    return state;
}
function assertPositiveInteger(value, field) {
    if (!Number.isInteger(value) || value <= 0) {
        throw new RangeError(`${field} must be a positive integer`);
    }
}
function mergeByKey(source, target, keyOf, resolve = (_source, targetValue) => targetValue) {
    const merged = new Map();
    for (const value of source) {
        merged.set(keyOf(value), value);
    }
    for (const value of target) {
        const key = keyOf(value);
        const previous = merged.get(key);
        merged.set(key, previous === undefined ? value : resolve(previous, value));
    }
    return [...merged.values()];
}
//# sourceMappingURL=bundled-free-content.js.map