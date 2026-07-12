import AsyncStorage from '@react-native-async-storage/async-storage';
import {classifySwipe, createInitialCardProgress, toDateKey} from '@daoewo/product-core';
import type {PublishedDeckContent} from '@daoewo/product-catalog/bundled-free-content';

import {createOfflineMobileRuntime} from '../src/offline-runtime';

function bundledDeck(deckId: string, cardCount: number): PublishedDeckContent {
  const cards = Array.from({length: cardCount}, (_, index) => ({
    id: `${deckId}-card-${index}`,
    deckId,
    index,
    front: `front ${index}`,
    back: `back ${index}`,
    tags: [],
    difficulty: 1 as const,
    sourceRefs: ['approved-test-source'],
  }));
  return {
    deckId,
    version: 1,
    chunkSize: 200,
    cardCount,
    publishedAt: '2026-07-12T00:00:00.000Z',
    publicationDigest: `sha256:${'a'.repeat(64)}`,
    chunks: [{
      chunkIndex: 0,
      checksum: `sha256:${'b'.repeat(64)}`,
      cards,
    }],
  };
}

describe('offline Free bundle runtime', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('게스트도 네트워크 없이 목표·60장 window·진도 commit을 수행한다', async () => {
    const deck = bundledDeck('english-essential-intro', 61);
    const runtime = createOfflineMobileRuntime(undefined, {[deck.deckId]: deck});
    await runtime.auth.continueAsGuest();
    const today = toDateKey(runtime.now());
    const goal = await runtime.content.createGoal({
      deckId: deck.deckId,
      mode: 'daily-count',
      value: 100,
      startDate: today,
    });
    const window = await runtime.content.getCardWindow({
      deckId: deck.deckId,
      goalKey: goal.key,
    });

    expect(goal.dailyCount).toBe(60);
    expect(window.cards).toHaveLength(60);
    const progress = classifySwipe(
      createInitialCardProgress(window.cards[0]!.id, deck.deckId, runtime.now()),
      'unknown',
      runtime.now(),
    );
    await expect(runtime.content.commitProgressBatch({
      deckId: deck.deckId,
      goalKey: goal.key,
      windowId: window.id,
      progresses: [progress],
    })).resolves.toBeUndefined();
    expect((await AsyncStorage.getAllKeys()).some(key =>
      key.includes(encodeURIComponent('mobile-local-guest')),
    )).toBe(true);
  });

  it('현재 generated bundle이 비어 있으면 준비중으로 fail-closed한다', async () => {
    const runtime = createOfflineMobileRuntime();
    await runtime.auth.continueAsGuest();
    await expect(runtime.content.createGoal({
      deckId: 'english-essential-intro',
      mode: 'days',
      value: 30,
      startDate: toDateKey(runtime.now()),
    })).rejects.toThrow('승인된 Free 덱 본문');
  });
});
