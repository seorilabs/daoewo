import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bundledFreeStorageKey,
  createBundledFreeContentAdapter,
} from '../dist/bundled-free-content.js';
import {
  classifySwipe,
  createInitialCardProgress,
} from '@daoewo/product-core';

const START = new Date('2026-07-12T01:00:00.000Z');

function deckContent(deckId, cardCount) {
  const cards = Array.from({length: cardCount}, (_, index) => ({
    id: `${deckId}-card-${index}`,
    deckId,
    index,
    front: `${deckId} front ${index}`,
    back: `${deckId} back ${index}`,
    tags: [],
    difficulty: 1,
    sourceRefs: ['approved-test-source'],
  }));
  return {
    deckId,
    version: 1,
    chunkSize: 200,
    cardCount,
    publishedAt: '2026-07-12T00:00:00.000Z',
    publicationDigest: `sha256:${'a'.repeat(64)}`,
    chunks: [{chunkIndex: 0, checksum: `sha256:${'b'.repeat(64)}`, cards}],
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    values,
    async getItem(key) {
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      values.set(key, structuredClone(value));
    },
    async removeItem(key) {
      values.delete(key);
    },
  };
}

test('Free bundle은 계정별 목표/진도를 격리하고 활성 1덱·일일 60장을 적용한다', async () => {
  const storage = memoryStorage();
  let ownerId = 'account-a';
  let current = START;
  const firstDeck = deckContent('english-essential-intro', 61);
  const secondDeck = deckContent('driving-license-key-points', 2);
  const adapter = createBundledFreeContentAdapter({
    storage,
    getOwnerId: async () => ownerId,
    now: () => current,
    content: {
      [firstDeck.deckId]: firstDeck,
      [secondDeck.deckId]: secondDeck,
    },
  });

  const goal = await adapter.createGoal({
    deckId: firstDeck.deckId,
    mode: 'daily-count',
    value: 100,
    startDate: '2026-07-12',
  });
  assert.equal(goal.dailyCount, 60);
  assert.deepEqual(Object.values(goal.assignments).map(cards => cards.length), [60, 1]);
  const firstWindow = await adapter.getCardWindow({deckId: firstDeck.deckId, goalKey: goal.key});
  assert.equal(firstWindow.cards.length, 60);

  const unknown = classifySwipe(
    createInitialCardProgress(firstWindow.cards[0].id, firstDeck.deckId, current),
    'unknown',
    current,
  );
  const known = classifySwipe(
    createInitialCardProgress(firstWindow.cards[1].id, firstDeck.deckId, current),
    'known',
    current,
  );
  const outside = classifySwipe(
    createInitialCardProgress(`${firstDeck.deckId}-card-60`, firstDeck.deckId, current),
    'known',
    current,
  );
  await assert.rejects(
    adapter.commitProgressBatch({
      deckId: firstDeck.deckId,
      goalKey: goal.key,
      windowId: firstWindow.id,
      progresses: [outside],
    }),
    /학습 창 밖/,
  );
  await adapter.commitProgressBatch({
    deckId: firstDeck.deckId,
    goalKey: goal.key,
    windowId: firstWindow.id,
    progresses: [unknown, known],
  });
  const repeatedWindow = await adapter.getCardWindow({
    deckId: firstDeck.deckId,
    goalKey: goal.key,
  });
  assert.equal(repeatedWindow.cards.some(card => card.id === known.cardId), false);
  assert.equal(repeatedWindow.cards.some(card => card.id === unknown.cardId), true);
  await assert.rejects(
    adapter.createGoal({
      deckId: secondDeck.deckId,
      mode: 'days',
      value: 5,
      startDate: '2026-07-12',
    }),
    /활성 덱을 1개/,
  );

  current = new Date('2026-07-13T01:00:00.000Z');
  const dueWindow = await adapter.getCardWindow({deckId: firstDeck.deckId, goalKey: goal.key});
  assert.equal(dueWindow.cards[0]?.id, `${firstDeck.deckId}-card-0`);
  assert.equal(dueWindow.cards.some(card => card.id === known.cardId), false);
  assert.equal(
    dueWindow.cards.some(card => card.id === `${firstDeck.deckId}-card-60`),
    true,
  );
  assert.equal(dueWindow.cards.length, 60);

  ownerId = 'account-b';
  await adapter.createGoal({
    deckId: secondDeck.deckId,
    mode: 'days',
    value: 5,
    startDate: '2026-07-13',
  });
  assert.notEqual(bundledFreeStorageKey('account-a'), bundledFreeStorageKey('account-b'));
  assert.equal(storage.values.has(bundledFreeStorageKey('account-a')), true);
  assert.equal(storage.values.has(bundledFreeStorageKey('account-b')), true);
  assert.equal((await adapter.getDeckSummary(firstDeck.deckId)), null);
});

test('adapter는 Pro ID를 client-safe content로 주입하는 것도 거부한다', () => {
  const pro = deckContent('english-toeic-advanced', 1);
  assert.throws(
    () => createBundledFreeContentAdapter({
      storage: memoryStorage(),
      getOwnerId: async () => 'account-a',
      content: {[pro.deckId]: pro},
    }),
    /Free 덱만/,
  );
});

test('v1 state를 v2 activeDeckIds로 마이그레이션하고 sync payload에는 본문을 넣지 않는다', async () => {
  const storage = memoryStorage();
  const deck = deckContent('english-essential-intro', 2);
  const goal = {
    key: deck.deckId,
    deckId: deck.deckId,
    mode: 'days',
    startDate: '2026-07-12',
    totalCount: 2,
    days: 1,
    dailyCount: 2,
    assignments: {'2026-07-12': deck.chunks[0].cards.map(card => card.id)},
  };
  const progress = classifySwipe(
    createInitialCardProgress(deck.chunks[0].cards[0].id, deck.deckId, START),
    'unknown',
    START,
  );
  storage.values.set(bundledFreeStorageKey('account-a'), {
    version: 1,
    activeDeckId: deck.deckId,
    goals: [goal],
    progresses: [progress],
    windows: [],
  });
  const adapter = createBundledFreeContentAdapter({
    storage,
    getOwnerId: async () => 'account-a',
    content: {[deck.deckId]: deck},
  });

  const backup = await adapter.exportLearningBackup();
  assert.deepEqual(
    storage.values.get(bundledFreeStorageKey('account-a')).activeDeckIds,
    [deck.deckId],
  );
  assert.equal(storage.values.get(bundledFreeStorageKey('account-a')).version, 2);
  assert.equal(backup[0].progresses[0].cardIndex, 0);
  assert.equal(JSON.stringify(backup).includes('front 0'), false);
  assert.equal(JSON.stringify(backup).includes('back 0'), false);
  assert.equal(
    (await adapter.getCardsByIds([{deckId: deck.deckId, cardId: progress.cardId}]))[0]
      .front,
    `${deck.deckId} front 0`,
  );
});

test('Pro entitlement는 여러 bundled Free 덱을 동시에 활성화하고 restore한다', async () => {
  const storage = memoryStorage();
  const first = deckContent('english-essential-intro', 61);
  const second = deckContent('driving-license-key-points', 2);
  const content = {[first.deckId]: first, [second.deckId]: second};
  const adapter = createBundledFreeContentAdapter({
    storage,
    getOwnerId: async () => 'pro-user',
    getEntitlement: async () => ({plan: 'pro', source: 'test', validUntil: null}),
    content,
  });
  const proGoal = await adapter.createGoal({
    deckId: first.deckId,
    mode: 'daily-count',
    value: 100,
    startDate: '2026-07-12',
  });
  assert.equal(proGoal.dailyCount, 61);
  assert.equal(
    (await adapter.getCardWindow({deckId: first.deckId, goalKey: proGoal.key}))
      .cards.length,
    61,
  );
  await adapter.createGoal({
    deckId: second.deckId,
    mode: 'days',
    value: 1,
    startDate: '2026-07-12',
  });
  const backup = await adapter.exportLearningBackup();
  assert.deepEqual(
    backup.filter(deck => deck.active).map(deck => deck.deckId),
    [second.deckId, first.deckId],
  );

  const restoredStorage = memoryStorage();
  const restored = createBundledFreeContentAdapter({
    storage: restoredStorage,
    getOwnerId: async () => 'pro-user',
    getEntitlement: async () => ({plan: 'pro', source: 'test', validUntil: null}),
    content,
  });
  await restored.importLearningBackup(backup);
  assert.deepEqual(await restored.exportLearningBackup(), backup);
});
