import {
  createInitialCardProgress,
  type FreeDeckLearningSnapshot,
} from '@daoewo/product-core';

import {
  createLearningSyncPort,
  serverStateToEnvelope,
  type LearningSyncPushInput,
} from '../src/sync-adapter';

const NOW = new Date('2026-07-12T00:00:00.000Z');
const progress = createInitialCardProgress('card-a', 'free-deck', NOW);
const freeDeck: FreeDeckLearningSnapshot = {
  deckId: 'free-deck',
  deckVersion: 1,
  active: true,
  goal: null,
  progresses: [{cardIndex: 0, state: progress}],
};

describe('learning sync adapter', () => {
  it('push wire payload에 카드 본문·UID·device 식별자를 포함하지 않는다', async () => {
    let pushed: LearningSyncPushInput | null = null;
    const exportedOwners: string[] = [];
    const importedOwners: string[] = [];
    const port = createLearningSyncPort({
      transport: {
        async pull() {
          return {
            learningBackup: {
              revision: 1,
              updatedAt: NOW.toISOString(),
              snapshot: {version: 1, freeDecks: [], sessions: []},
            },
            progress: [],
          };
        },
        async push(_userId, input) {
          pushed = input;
          return {
            learningBackup: {
              revision: 2,
              updatedAt: NOW.toISOString(),
              snapshot: input.snapshot,
            },
            progress: [],
          };
        },
      },
      localFree: {
        async exportLearningBackup(ownerId) {
          exportedOwners.push(ownerId);
          return [
            {
              ...freeDeck,
              front: 'LOCAL_FRONT_BODY',
              back: 'LOCAL_BACK_BODY',
            } as unknown as FreeDeckLearningSnapshot,
          ];
        },
        async importLearningBackup(ownerId) {
          importedOwners.push(ownerId);
        },
        async resolveFreeCardSnapshots() {
          return [
            {
              id: 'card-a',
              deckId: 'free-deck',
              front: 'LOCAL_FRONT_BODY',
              back: 'LOCAL_BACK_BODY',
              tags: [],
              locale: 'ko',
            },
          ];
        },
      },
      getEntitlement: async () => ({
        plan: 'free',
        source: 'test',
        validUntil: null,
      }),
      createMutationId: () => 'sync_mutation_1234',
    });

    const pulled = await port.pull('user-a');
    expect(pulled).not.toBeNull();
    await port.push('user-a', pulled!);

    expect(pushed).toMatchObject({
      baseRevision: 1,
      mutationId: 'sync_mutation_1234',
      snapshot: {version: 1, freeDecks: [{deckId: 'free-deck'}]},
    });
    const wire = JSON.stringify(pushed);
    expect(wire).not.toContain('LOCAL_FRONT_BODY');
    expect(wire).not.toContain('LOCAL_BACK_BODY');
    expect(wire).not.toContain('cardSnapshots');
    expect(wire).not.toContain('user-a');
    expect(wire).not.toContain('deviceId');
    expect(exportedOwners.every(ownerId => ownerId === 'user-a')).toBe(true);
    expect(importedOwners.every(ownerId => ownerId === 'user-a')).toBe(true);
  });

  it('기존 authoritative progress cards[*].state를 CardProgress로 펼친다', () => {
    const envelope = serverStateToEnvelope({
      progress: [{cards: {'card-a': {state: progress}}}],
    });

    expect(envelope.revision).toBe(0);
    expect(envelope.snapshot.authoritativeProgresses).toEqual([progress]);
  });

  it('pull 도중 계정이 바뀌면 이전 계정 응답을 local bundle에 import하지 않는다', async () => {
    let currentUserId = 'user-a';
    const importedOwners: string[] = [];
    const port = createLearningSyncPort({
      transport: {
        async pull() {
          currentUserId = 'user-b';
          return {
            learningBackup: {
              revision: 1,
              updatedAt: NOW.toISOString(),
              snapshot: {version: 1, freeDecks: [freeDeck], sessions: []},
            },
          };
        },
        async push() {
          throw new Error('not used');
        },
      },
      localFree: {
        async exportLearningBackup() {
          return [];
        },
        async importLearningBackup(ownerId) {
          importedOwners.push(ownerId);
        },
        async resolveFreeCardSnapshots() {
          return [];
        },
      },
      getEntitlement: async () => ({
        plan: 'free',
        source: 'test',
        validUntil: null,
      }),
      canSync: async userId => currentUserId === userId,
    });

    await expect(port.pull('user-a')).resolves.toBeNull();
    expect(importedOwners).toEqual([]);
  });
});
