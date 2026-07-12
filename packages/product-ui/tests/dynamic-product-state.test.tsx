import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {
  classifySwipe,
  createInitialCardProgress,
} from '@daoewo/product-core';

import {DaoewoApp} from '../src/DaoewoApp';
import type {DaoewoCardView, DaoewoDeckView} from '../src/demo-data';
import {
  DAOEWO_LEGACY_LEARNING_STATE_STORAGE_KEY,
  deriveDashboardSummary,
  learningStateStorageKey,
  saveLearningState,
  selectMistakeItems,
  settingsStorageKey,
  type DaoewoLearningState,
} from '../src/product-state';
import {createDemoRuntime, type DaoewoRuntime} from '../src/runtime';

const NOW = new Date('2026-07-12T09:00:00.000Z');
const CARD_KNOWN: DaoewoCardView = {
  id: 'known-card',
  deckId: 'test-deck',
  front: 'known front',
  back: 'known back',
  tags: ['기초'],
  locale: 'ko',
};
const CARD_UNKNOWN: DaoewoCardView = {
  id: 'unknown-card',
  deckId: 'test-deck',
  front: '저장된 오답 카드',
  back: 'snapshot answer',
  tags: ['비밀태그'],
  locale: 'ko',
};

function progress(card: DaoewoCardView, outcome: 'known' | 'unknown') {
  return classifySwipe(
    createInitialCardProgress(card.id, card.deckId, NOW),
    outcome,
    NOW,
  );
}

function learningState(): DaoewoLearningState {
  return {
    version: 1,
    progresses: [progress(CARD_KNOWN, 'known'), progress(CARD_UNKNOWN, 'unknown')],
    cardSnapshots: [CARD_KNOWN, CARD_UNKNOWN],
    sessions: [
      {
        id: 'session-yesterday',
        deckId: 'test-deck',
        date: '2026-07-11',
        target: 2,
        completed: 2,
        known: 1,
        unknown: 1,
        reviewCount: 0,
        elapsedMs: 1_000,
        completedAt: '2026-07-11T09:00:00.000Z',
      },
      {
        id: 'session-today',
        deckId: 'test-deck',
        date: '2026-07-12',
        target: 2,
        completed: 2,
        known: 1,
        unknown: 1,
        reviewCount: 0,
        elapsedMs: 1_000,
        completedAt: NOW.toISOString(),
      },
    ],
  };
}

async function renderApp(
  runtime: DaoewoRuntime,
  initialScreen:
    | 'home'
    | 'statistics'
    | 'mistakes'
    | 'settings'
    | 'paywall'
    | 'study',
): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(
      <DaoewoApp initialScreen={initialScreen} runtime={runtime} />,
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer!;
}

async function runtimeWithState(): Promise<DaoewoRuntime> {
  const runtime = createDemoRuntime({
    initialUser: {id: 'state-user', displayName: '상태 사용자', isGuest: false},
    now: () => NOW,
  });
  await saveLearningState(runtime.storage, 'state-user', learningState());
  return runtime;
}

function oneCardLearningState(card: DaoewoCardView): DaoewoLearningState {
  return {
    version: 1,
    progresses: [progress(card, 'unknown')],
    cardSnapshots: [card],
    sessions: [],
  };
}

describe('저장된 학습 상태 기반 UI', () => {
  it('core 통계와 SRS queue를 사용해 홈 요약과 오답을 계산한다', () => {
    const catalog: readonly DaoewoDeckView[] = [
      {
        id: 'test-deck',
        title: '테스트 덱',
        subtitle: '동적 상태',
        category: '언어',
        locale: '한국어',
        tier: 'free',
        source: 'official',
        availability: 'published',
        cardCount: 10,
        tags: ['기초'],
        progress: 0.2,
      },
    ];
    const state = learningState();
    const summary = deriveDashboardSummary(state, catalog, NOW);
    const mistakes = selectMistakeItems(state, NOW);

    expect(summary).toMatchObject({
      streak: {current: 2, longest: 2},
      todayCompleted: 2,
      todayTarget: 2,
      dueCount: 1,
      memorizedCount: 1,
      learningCount: 1,
      memorizationRate: 50,
    });
    expect(summary.weaknessTags).toEqual([
      {label: '비밀태그', rate: 100},
    ]);
    expect(summary.estimatedCompletionDate).not.toBeNull();
    expect(mistakes).toHaveLength(1);
    expect(mistakes[0]?.card.front).toBe('저장된 오답 카드');
    expect(mistakes[0]?.isDue).toBe(true);
  });

  it('저장 데이터가 없으면 숫자를 꾸며내지 않는다', () => {
    const summary = deriveDashboardSummary(
      {version: 1, progresses: [], cardSnapshots: [], sessions: []},
      [],
      NOW,
    );
    expect(summary).toMatchObject({
      streak: {current: 0, longest: 0},
      todayCompleted: 0,
      todayTarget: 0,
      dueCount: 0,
      memorizedCount: 0,
      learningCount: 0,
      memorizationRate: 0,
      estimatedCompletionDate: null,
      weaknessTags: [],
    });
  });

  // 공유 runner의 React Native renderer cold start를 포함한 통합 UI 테스트다.
  it('홈과 오답노트가 저장된 완료 기록·snapshot을 표시한다', async () => {
    const runtime = await runtimeWithState();
    const home = await renderApp(runtime, 'home');
    expect(
      home.root.findByProps({
        accessibilityLabel: '오늘 학습 2장 완료, 목표 2장',
      }),
    ).toBeTruthy();
    expect(
      home.root.findByProps({
        accessibilityLabel: '복습 대기 1장, 오답노트 열기',
      }),
    ).toBeTruthy();
    expect(
      home.root.findByProps({accessibilityLabel: '현재 스트릭 2일'}),
    ).toBeTruthy();

    await act(async () => {
      home.root
        .findByProps({
          accessibilityLabel: '복습 대기 1장, 오답노트 열기',
        })
        .props.onPress();
    });
    expect(JSON.stringify(home.toJSON())).toContain('저장된 오답 카드');
    expect(JSON.stringify(home.toJSON())).not.toContain('勉強する');
    await act(async () => home.unmount());
  }, 15_000);

  it('Free 통계 접근성 트리에 Pro 실제 값을 렌더하지 않는다', async () => {
    const runtime = await runtimeWithState();
    const renderer = await renderApp(runtime, 'statistics');
    const output = JSON.stringify(renderer.toJSON());

    expect(output).toContain('Pro 고급 통계 잠김');
    expect(output).not.toContain('#비밀태그');
    expect(output).not.toContain('71%');
    expect(output).not.toContain('612');
  });

  it('설정을 계정별로 저장하고 미지원 알림은 fail-closed하며 본문 없는 데이터를 공유한다', async () => {
    const base = await runtimeWithState();
    const shares: Array<{readonly title: string; readonly message: string}> = [];
    const runtime: DaoewoRuntime = {
      ...base,
      sharing: {
        availability: 'available',
        async shareText(input) {
          shares.push(input);
        },
      },
    };
    const renderer = await renderApp(runtime, 'settings');

    const dailyReminder = renderer.root.findByProps({
      accessibilityLabel: '일일 학습 알림',
    });
    expect(dailyReminder.props.value).toBe(false);
    expect(dailyReminder.props.accessibilityState).toEqual({
      checked: false,
      disabled: true,
    });

    await act(async () => {
      renderer.root
        .findByProps({accessibilityLabel: '카드 음성(TTS)'})
        .props.onValueChange(false);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      await runtime.storage.getItem(settingsStorageKey('state-user')),
    ).toMatchObject({dailyReminder: false, ttsEnabled: false});

    await act(async () => {
      renderer.root
        .findByProps({
          accessibilityLabel: '클라우드 백업·동기화, 이 기기에만',
        })
        .props.onPress();
    });
    expect(JSON.stringify(renderer.toJSON())).toContain(
      '현재 앱 환경에서는 학습 기록을 이 기기에만 저장해요',
    );

    await act(async () => {
      renderer.root
        .findByProps({
          accessibilityLabel: '학습 데이터 내보내기, JSON 공유',
        })
        .props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(shares).toHaveLength(1);
    expect(shares[0]?.title).toBe('다외워 학습 데이터');
    expect(JSON.parse(shares[0]?.message ?? '{}')).toMatchObject({
      schema: 'daoewo-learning-data',
      version: 1,
    });
    expect(shares[0]?.message).not.toContain('저장된 오답 카드');
    expect(shares[0]?.message).not.toContain('state-user');

    const cloudBase = await runtimeWithState();
    const cloud = await renderApp(
      {
        ...cloudBase,
        sync: {...cloudBase.sync, availability: 'cloud'},
      },
      'settings',
    );
    await act(async () => {
      cloud.root
        .findByProps({accessibilityLabel: '클라우드 백업·동기화, 자동'})
        .props.onPress();
    });
    expect(JSON.stringify(cloud.toJSON())).toContain(
      '네트워크 연결 시 자동으로 동기화돼요',
    );
  });

  it('스토어 offer와 게시 링크가 없으면 가격·체험·문서를 fail-closed한다', async () => {
    const runtime = await runtimeWithState();
    const renderer = await renderApp(runtime, 'paywall');
    const output = JSON.stringify(renderer.toJSON());

    expect(output).toContain('스토어 상품 확인이 필요해요');
    expect(output).not.toContain('₩4,900');
    expect(output).not.toContain('₩39,000');
    expect(output).not.toContain('7일 무료');
    expect(
      renderer.root.findByProps({
        accessibilityLabel: '스토어 상품 확인 필요',
      }).props.accessibilityState,
    ).toEqual({disabled: true, busy: false});
    expect(
      renderer.root.findByProps({accessibilityLabel: '이용약관'}).props
        .accessibilityState,
    ).toEqual({disabled: true});
    expect(output).toContain('링크를 비활성화했습니다');
  });

  it('로그인 직후 기존 Pro entitlement를 다시 읽는다', async () => {
    const base = createDemoRuntime({now: () => NOW});
    let entitlementCalls = 0;
    const runtime: DaoewoRuntime = {
      ...base,
      purchase: {
        ...base.purchase,
        async getEntitlement() {
          entitlementCalls += 1;
          return entitlementCalls === 1
            ? {plan: 'free', source: 'test', validUntil: null}
            : {
                plan: 'pro',
                source: 'test',
                validUntil: '2099-12-31T00:00:00.000Z',
              };
        },
      },
    };
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<DaoewoApp runtime={runtime} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await renderer!.root
        .findByProps({accessibilityLabel: 'Google로 계속하기'})
        .props.onPress();
      await Promise.resolve();
    });

    expect(entitlementCalls).toBe(2);
    expect(JSON.stringify(renderer!.toJSON())).toContain(
      '활성 덱을 제한 없이 학습 중이에요',
    );
  });

  it('A 로그아웃 뒤 B 계정 상태만 hydrate하고 legacy·A key를 제거한다', async () => {
    const aCard: DaoewoCardView = {
      ...CARD_UNKNOWN,
      id: 'a-secret-card',
      front: 'A 계정 비밀 카드',
    };
    const bCard: DaoewoCardView = {
      ...CARD_UNKNOWN,
      id: 'b-only-card',
      front: 'B 계정 전용 카드',
    };
    const runtime = createDemoRuntime({
      initialUser: {id: 'account-a', displayName: 'A 사용자', isGuest: false},
      now: () => NOW,
    });
    await saveLearningState(
      runtime.storage,
      'account-a',
      oneCardLearningState(aCard),
    );
    await saveLearningState(
      runtime.storage,
      'demo-google',
      oneCardLearningState(bCard),
    );
    await runtime.storage.setItem(
      DAOEWO_LEGACY_LEARNING_STATE_STORAGE_KEY,
      oneCardLearningState(aCard),
    );

    const renderer = await renderApp(runtime, 'settings');
    await act(async () => {
      await renderer.root
        .findByProps({accessibilityLabel: '로그아웃'})
        .props.onPress();
      await Promise.resolve();
    });

    expect(
      await runtime.storage.getItem(learningStateStorageKey('account-a')),
    ).toBeNull();
    expect(
      await runtime.storage.getItem(
        DAOEWO_LEGACY_LEARNING_STATE_STORAGE_KEY,
      ),
    ).toBeNull();

    await act(async () => {
      await renderer.root
        .findByProps({accessibilityLabel: 'Google로 계속하기'})
        .props.onPress();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const reviewBanner = renderer.root.findByProps({
      accessibilityLabel: '복습 대기 1장, 오답노트 열기',
    });
    await act(async () => reviewBanner.props.onPress());
    const output = JSON.stringify(renderer.toJSON());
    expect(output).toContain('B 계정 전용 카드');
    expect(output).not.toContain('A 계정 비밀 카드');
    expect(
      await runtime.storage.getItem(learningStateStorageKey('demo-google')),
    ).not.toBeNull();
  });

  it('회원탈퇴 API 성공 뒤 현재 UID의 local key를 제거한다', async () => {
    const events: string[] = [];
    const base = createDemoRuntime({
      initialUser: {id: 'delete-user', displayName: '탈퇴 사용자', isGuest: false},
      now: () => NOW,
    });
    await saveLearningState(
      base.storage,
      'delete-user',
      oneCardLearningState(CARD_UNKNOWN),
    );
    const runtime: DaoewoRuntime = {
      ...base,
      storage: {
        ...base.storage,
        async removeItem(key: string) {
          events.push(`remove:${key}`);
          await base.storage.removeItem(key);
        },
      },
      auth: {
        ...base.auth,
        async deleteAccount() {
          events.push('auth:delete');
          await base.auth.deleteAccount();
        },
      },
    };
    const renderer = await renderApp(runtime, 'settings');
    await act(async () => {
      await renderer.root
        .findByProps({accessibilityLabel: '회원탈퇴'})
        .props.onPress();
    });
    await act(async () => {
      await renderer.root
        .findByProps({accessibilityLabel: '정말 탈퇴하기'})
        .props.onPress();
      await Promise.resolve();
    });

    const scopedRemoval = events.indexOf(
      `remove:${learningStateStorageKey('delete-user')}`,
    );
    const remoteDelete = events.indexOf('auth:delete');
    expect(scopedRemoval).toBeGreaterThanOrEqual(0);
    expect(scopedRemoval).toBeGreaterThan(remoteDelete);
  });

  it('Pro window 본문은 저장하지 않고 review 완료·재시작 뒤 메모리에 남기지 않는다', async () => {
    jest.useFakeTimers();
    const secretCard: DaoewoCardView = {
      id: 'pro-secret-card',
      deckId: 'pro-secret-deck',
      front: 'PRO_SECRET_FRONT_BODY',
      back: 'PRO_SECRET_BACK_BODY',
      tags: ['pro-secret'],
      locale: 'ko',
    };
    const proDeck: DaoewoDeckView = {
      id: 'pro-secret-deck',
      title: 'Pro 보안 덱',
      subtitle: '본문 비영속 검증',
      category: '직무',
      locale: '한국어',
      tier: 'pro',
      source: 'official',
      availability: 'published',
      cardCount: 1,
      tags: ['보안'],
      progress: 0,
    };
    const base = createDemoRuntime({
      initialUser: {id: 'pro-user', displayName: 'Pro 사용자', isGuest: false},
      initialEntitlement: {
        plan: 'pro',
        source: 'test',
        validUntil: '2099-12-31T00:00:00.000Z',
      },
      now: () => NOW,
    });
    const runtime: DaoewoRuntime = {
      ...base,
      content: {
        ...base.content,
        async listCatalog() {
          return [proDeck];
        },
        async getDeck() {
          return proDeck;
        },
        async getCardWindow() {
          return {
            id: 'pro-window',
            deckId: proDeck.id,
            cards: [secretCard],
            targetCount: 1,
          };
        },
      },
    };

    const renderer = await renderApp(runtime, 'study');
    await act(async () => {
      renderer.root
        .findByProps({accessibilityLabel: '모르겠다'})
        .props.onPress();
      jest.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });
    const storedAfterSwipe = await runtime.storage.getItem<DaoewoLearningState>(
      learningStateStorageKey('pro-user'),
    );
    expect(storedAfterSwipe?.progresses).toHaveLength(1);
    expect(storedAfterSwipe?.cardSnapshots).toEqual([]);
    expect(JSON.stringify(storedAfterSwipe)).not.toContain('PRO_SECRET');

    await act(async () => {
      renderer.root
        .findByProps({
          accessibilityLabel: 'PRO_SECRET_FRONT_BODY, 탭하여 정답 보기',
        })
        .props.onPress();
    });
    await act(async () => {
      renderer.root
        .findByProps({accessibilityLabel: '몰랐다, 다음 복습 잠시 후'})
        .props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(JSON.stringify(renderer.toJSON())).not.toContain('PRO_SECRET');
    expect(
      (
        await runtime.storage.getItem<DaoewoLearningState>(
          learningStateStorageKey('pro-user'),
        )
      )?.cardSnapshots,
    ).toEqual([]);
    await act(async () => renderer.unmount());

    const restarted = await renderApp(runtime, 'mistakes');
    expect(JSON.stringify(restarted.toJSON())).not.toContain('PRO_SECRET');
    expect(JSON.stringify(restarted.toJSON())).toContain('복습할 오답이 없어요');
    await act(async () => restarted.unmount());
    jest.useRealTimers();
  });
});
