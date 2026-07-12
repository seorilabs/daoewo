import {
  classifySwipe,
  createInitialCardProgress,
  type LearningSyncSnapshot,
  type SyncEnvelope,
} from '@daoewo/product-core';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {DaoewoApp} from '../src/DaoewoApp';
import type {DaoewoCardView} from '../src/demo-data';
import {
  learningStateStorageKey,
  saveLearningState,
  type DaoewoLearningState,
} from '../src/product-state';
import {
  createDemoRuntime,
  type DaoewoRuntime,
  type DaoewoUser,
} from '../src/runtime';

const NOW = new Date('2026-07-12T09:00:00.000Z');
const USER_A: DaoewoUser = {
  id: 'sync-user-a',
  displayName: 'A 사용자',
  isGuest: false,
};
const USER_B: DaoewoUser = {
  id: 'sync-user-b',
  displayName: 'B 사용자',
  isGuest: false,
};
const FREE_CARD: DaoewoCardView = {
  id: 'free-card',
  deckId: 'free-deck',
  front: '로컬 bundle 복원 카드',
  back: '로컬 bundle 정답',
  tags: ['복원'],
  locale: 'ko',
};

function cardProgress(card: DaoewoCardView, outcome: 'known' | 'unknown') {
  return classifySwipe(
    createInitialCardProgress(card.id, card.deckId, NOW),
    outcome,
    NOW,
  );
}

function envelope(input?: {
  free?: boolean;
  progress?: ReturnType<typeof cardProgress>;
  sessionId?: string;
}): SyncEnvelope<LearningSyncSnapshot> {
  const progress = input?.progress ?? cardProgress(FREE_CARD, 'unknown');
  return {
    revision: 1,
    updatedAt: NOW.toISOString(),
    snapshot: {
      backup: {
        version: 1,
        freeDecks:
          input?.free === false
            ? []
            : [
                {
                  deckId: progress.deckId,
                  deckVersion: 1,
                  active: true,
                  goal: null,
                  progresses: [{cardIndex: 0, state: progress}],
                },
              ],
        sessions: [
          {
            id: input?.sessionId ?? 'remote-session',
            deckId: progress.deckId,
            date: '2026-07-12',
            target: 1,
            completed: 1,
            known: progress.lastOutcome === 'known' ? 1 : 0,
            unknown: progress.lastOutcome === 'unknown' ? 1 : 0,
            reviewCount: 0,
            elapsedMs: 1000,
            completedAt: NOW.toISOString(),
          },
        ],
      },
      authoritativeProgresses: input?.free === false ? [progress] : [],
    },
  };
}

async function render(runtime: DaoewoRuntime): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(<DaoewoApp initialScreen="home" runtime={runtime} />);
    for (let index = 0; index < 12; index += 1) {
      await Promise.resolve();
    }
  });
  return renderer!;
}

describe('local-first cloud hydrate', () => {
  it('Free remote progress를 복원하고 본문은 로컬 resolver에서만 채운다', async () => {
    const base = createDemoRuntime({initialUser: USER_A, now: () => NOW});
    const remote = envelope();
    const runtime: DaoewoRuntime = {
      ...base,
      sync: {
        availability: 'cloud',
        pull: jest.fn(async () => remote),
        push: jest.fn(async () => remote),
        resolveFreeCardSnapshots: jest.fn(async () => [FREE_CARD]),
      },
    };

    const renderer = await render(runtime);
    const stored = await runtime.storage.getItem<DaoewoLearningState>(
      learningStateStorageKey(USER_A.id),
    );

    expect(stored?.progresses.map(item => item.cardId)).toEqual(['free-card']);
    expect(stored?.cardSnapshots.map(item => item.front)).toEqual([
      '로컬 bundle 복원 카드',
    ]);
    expect(JSON.stringify(renderer.toJSON())).toContain('오늘 학습');
    await act(async () => renderer.unmount());
  });

  it('secondary-device pull 오류에서도 기존 local state와 인증 사용자를 보존한다', async () => {
    const base = createDemoRuntime({initialUser: USER_A, now: () => NOW});
    const local: DaoewoLearningState = {
      version: 1,
      progresses: [cardProgress(FREE_CARD, 'unknown')],
      cardSnapshots: [FREE_CARD],
      sessions: [],
    };
    await saveLearningState(base.storage, USER_A.id, local);
    const runtime: DaoewoRuntime = {
      ...base,
      sync: {
        availability: 'cloud',
        async pull() {
          throw new Error('primary-device-mismatch');
        },
        async push(_userId, value) {
          return value;
        },
        async resolveFreeCardSnapshots() {
          return [];
        },
      },
    };

    const renderer = await render(runtime);

    expect(await runtime.auth.getCurrentUser()).toEqual(USER_A);
    expect(
      await runtime.storage.getItem(learningStateStorageKey(USER_A.id)),
    ).toEqual(local);
    expect(JSON.stringify(renderer.toJSON())).toContain('그대로 유지됩니다');
    await act(async () => renderer.unmount());
  });

  it('Pro 새 기기는 authoritative progress와 session을 hydrate하되 본문을 저장하지 않는다', async () => {
    const base = createDemoRuntime({
      initialUser: USER_A,
      initialEntitlement: {
        plan: 'pro',
        source: 'test',
        validUntil: null,
      },
      now: () => NOW,
    });
    const proCard = {...FREE_CARD, id: 'pro-card', deckId: 'pro-deck'};
    const remote = envelope({
      free: false,
      progress: cardProgress(proCard, 'known'),
      sessionId: 'pro-session',
    });
    const runtime: DaoewoRuntime = {
      ...base,
      sync: {
        availability: 'cloud',
        async pull() {
          return remote;
        },
        async push() {
          return remote;
        },
        async resolveFreeCardSnapshots() {
          return [];
        },
      },
    };

    const renderer = await render(runtime);
    const stored = await runtime.storage.getItem<DaoewoLearningState>(
      learningStateStorageKey(USER_A.id),
    );

    expect(stored?.progresses.map(item => item.cardId)).toEqual(['pro-card']);
    expect(stored?.sessions.map(item => item.id)).toEqual(['pro-session']);
    expect(stored?.cardSnapshots).toEqual([]);
    expect(JSON.stringify(stored)).not.toContain('LOCAL_FRONT_BODY');
    await act(async () => renderer.unmount());
  });

  it('이전 계정의 늦은 pull 응답이 새 계정 local state를 덮어쓰지 않는다', async () => {
    let resolveA: ((value: SyncEnvelope<LearningSyncSnapshot>) => void) | undefined;
    const pendingA = new Promise<SyncEnvelope<LearningSyncSnapshot>>(resolve => {
      resolveA = resolve;
    });
    const runtimeA: DaoewoRuntime = {
      ...createDemoRuntime({initialUser: USER_A, now: () => NOW}),
      sync: {
        availability: 'cloud',
        async pull() {
          return pendingA;
        },
        async push(_userId, value) {
          return value;
        },
        async resolveFreeCardSnapshots() {
          return [FREE_CARD];
        },
      },
    };
    const bCard = {...FREE_CARD, id: 'b-card', front: 'B 계정 카드'};
    const runtimeB = createDemoRuntime({initialUser: USER_B, now: () => NOW});
    const bState: DaoewoLearningState = {
      version: 1,
      progresses: [cardProgress(bCard, 'unknown')],
      cardSnapshots: [bCard],
      sessions: [],
    };
    await saveLearningState(runtimeB.storage, USER_B.id, bState);
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<DaoewoApp initialScreen="home" runtime={runtimeA} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      renderer!.update(<DaoewoApp initialScreen="home" runtime={runtimeB} />);
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });
    await act(async () => {
      resolveA?.(envelope());
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });

    expect(
      await runtimeB.storage.getItem(learningStateStorageKey(USER_B.id)),
    ).toEqual(bState);
    expect(JSON.stringify(renderer!.toJSON())).not.toContain(
      '로컬 bundle 복원 카드',
    );
    await act(async () => renderer!.unmount());
  });
});
