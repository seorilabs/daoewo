import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {createStudyGoal} from '@daoewo/product-core';

import {DaoewoApp} from '../src/DaoewoApp';
import type {DaoewoCardView, DaoewoDeckView} from '../src/demo-data';
import type {DaoewoScreen} from '../src/navigation';
import {
  createDemoRuntime,
  type DaoewoContentPort,
  type DaoewoRuntime,
} from '../src/runtime';

const ADAPTER_DECK: DaoewoDeckView = {
  id: 'adapter-deck',
  title: '실제 어댑터 덱',
  subtitle: '주입된 catalog metadata',
  category: '교양',
  locale: '한국어',
  tier: 'free',
  source: 'official',
  availability: 'published',
  cardCount: 1,
  tags: ['adapter'],
  progress: 0.25,
  daysLeft: 7,
};

const ADAPTER_CARD: DaoewoCardView = {
  id: 'adapter-card',
  deckId: ADAPTER_DECK.id,
  front: '주입된 카드 앞면',
  back: '주입된 카드 뒷면',
  tags: ['adapter'],
  locale: 'ko-KR',
};

const COMING_SOON_DECK: DaoewoDeckView = {
  ...ADAPTER_DECK,
  id: 'coming-soon-deck',
  title: '준비 중인 덱',
  tier: 'pro',
  availability: 'coming-soon',
  cardCount: null,
  progress: undefined,
  daysLeft: undefined,
};

function createAdapterRuntime(): {
  readonly runtime: DaoewoRuntime;
  readonly content: jest.Mocked<DaoewoContentPort>;
} {
  const base = createDemoRuntime({
    initialUser: {
      id: 'adapter-user',
      displayName: '어댑터 사용자',
      isGuest: false,
    },
    now: () => new Date('2026-07-12T09:00:00.000Z'),
  });
  const content: jest.Mocked<DaoewoContentPort> = {
    listCatalog: jest.fn(async () => [ADAPTER_DECK]),
    getDeck: jest.fn(async (_deckId: string) => ADAPTER_DECK),
    createGoal: jest.fn(async input =>
      createStudyGoal({
        deckId: input.deckId,
        cardIds: [ADAPTER_CARD.id],
        startDate: input.startDate,
        mode: input.mode,
        value: input.value,
      }),
    ),
    getCardWindow: jest.fn(async input => ({
      id: 'adapter-window',
      deckId: input.deckId,
      ...(input.goalKey ? {goalKey: input.goalKey} : {}),
      cards: [ADAPTER_CARD],
      targetCount: 1,
    })),
    commitProgressBatch: jest.fn(async (_batch: Parameters<DaoewoContentPort['commitProgressBatch']>[0]) => undefined),
    submitDeckRequest: jest.fn(async (_request: Parameters<DaoewoContentPort['submitDeckRequest']>[0]) => undefined),
  };
  return {runtime: {...base, content}, content};
}

async function render(
  runtime: DaoewoRuntime,
  initialScreen: DaoewoScreen,
): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(
      <DaoewoApp initialScreen={initialScreen} runtime={runtime} />,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer!;
}

describe('DaoewoApp content adapter 통합', () => {
  it('주입된 catalog/deck/goal/window/progress batch만 소비한다', async () => {
    jest.useFakeTimers();
    const {runtime, content} = createAdapterRuntime();
    const renderer = await render(runtime, 'home');

    expect(
      renderer.root.findByProps({
        accessibilityLabel: '실제 어댑터 덱, 진행률 25퍼센트, 7일 남음',
      }),
    ).toBeTruthy();
    expect(JSON.stringify(renderer.toJSON())).not.toContain('영어 필수단어 입문');

    await act(async () => {
      await renderer.root
        .findByProps({
          accessibilityLabel: '실제 어댑터 덱, 진행률 25퍼센트, 7일 남음',
        })
        .props.onPress();
      await Promise.resolve();
    });
    expect(content.getDeck).toHaveBeenCalledWith('adapter-deck');

    await act(async () => {
      await renderer.root
        .findByProps({accessibilityLabel: '이 목표로 시작하기'})
        .props.onPress();
      await Promise.resolve();
    });
    expect(content.createGoal).toHaveBeenCalledWith({
      deckId: 'adapter-deck',
      mode: 'days',
      value: 30,
      startDate: '2026-07-12',
    });
    expect(content.getCardWindow).toHaveBeenCalledWith({
      deckId: 'adapter-deck',
      goalKey: 'adapter-deck',
    });
    expect(
      renderer.root.findByProps({accessibilityLabel: '주입된 카드 앞면'}),
    ).toBeTruthy();

    await act(async () => {
      renderer.root.findByProps({accessibilityLabel: '안다'}).props.onPress();
      jest.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(content.commitProgressBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        deckId: 'adapter-deck',
        goalKey: 'adapter-deck',
        windowId: 'adapter-window',
        progresses: [expect.objectContaining({cardId: 'adapter-card'})],
      }),
    );

    await act(async () => renderer.unmount());
    jest.useRealTimers();
  });

  it('덱 요청 자유 입력은 content adapter로만 전달한다', async () => {
    const {runtime, content} = createAdapterRuntime();
    const renderer = await render(runtime, 'deck-request');

    await act(async () => {
      renderer.root
        .findByProps({accessibilityLabel: '외우고 싶은 주제'})
        .props.onChangeText('관세법 핵심 조문');
      renderer.root
        .findByProps({accessibilityLabel: '덱 요청 참고 메모'})
        .props.onChangeText('시험 일정 참고');
    });
    await act(async () => {
      await renderer.root
        .findByProps({accessibilityLabel: '요청 보내기'})
        .props.onPress();
    });

    expect(content.submitDeckRequest).toHaveBeenCalledWith({
      topic: '관세법 핵심 조문',
      category: '자격증',
      locale: 'ko',
      note: '시험 일정 참고',
    });
    await act(async () => renderer.unmount());
  });

  it('coming-soon metadata는 카드 수를 왜곡하지 않고 목표를 차단한다', async () => {
    const {runtime, content} = createAdapterRuntime();
    content.listCatalog.mockResolvedValue([COMING_SOON_DECK]);
    content.getDeck.mockResolvedValue(COMING_SOON_DECK);
    const renderer = await render(runtime, 'catalog');

    expect(
      renderer.root.findByProps({
        accessibilityLabel:
          '준비 중인 덱, 카드 수 준비 중, Pro 덱, 준비 중',
      }),
    ).toBeTruthy();
    expect(JSON.stringify(renderer.toJSON())).not.toContain('null장');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('0장');

    await act(async () => {
      await renderer.root
        .findByProps({
          accessibilityLabel:
            '준비 중인 덱, 카드 수 준비 중, Pro 덱, 준비 중',
        })
        .props.onPress();
      await Promise.resolve();
    });

    expect(content.getDeck).toHaveBeenCalledWith('coming-soon-deck');
    expect(content.createGoal).not.toHaveBeenCalled();
    expect(content.getCardWindow).not.toHaveBeenCalled();
    expect(
      renderer.root.findByProps({accessibilityLabel: '준비 중인 덱이에요'})
        .props.accessibilityState,
    ).toEqual({disabled: true, busy: false});
    expect(
      renderer.root.findByProps({accessibilityLabel: '이 덱 요청하기'}),
    ).toBeTruthy();
    expect(
      renderer.root.findAllByProps({
        accessibilityLabel: '7일 무료로 시작하기',
      }),
    ).toHaveLength(0);
    await act(async () => renderer.unmount());
  });
});
