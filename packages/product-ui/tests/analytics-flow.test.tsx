import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {DaoewoApp} from '../src/DaoewoApp';
import type {DaoewoScreen} from '../src/navigation';
import {
  APPS_IN_TOSS_AUTH_OPTIONS,
  createDemoRuntime,
  type DaoewoAnalytics,
  type DaoewoAnalyticsEventMap,
  type DaoewoAnalyticsEventName,
  type DaoewoAnalyticsValue,
  type DaoewoAuthOption,
  type DaoewoRuntime,
} from '../src/runtime';

interface CapturedEvent {
  readonly event: DaoewoAnalyticsEventName;
  readonly properties: Readonly<Record<string, DaoewoAnalyticsValue>>;
}

async function renderTracked(
  initialScreen: DaoewoScreen,
  authOptions?: readonly DaoewoAuthOption[],
): Promise<{
  readonly renderer: ReactTestRenderer;
  readonly events: CapturedEvent[];
  readonly runtime: DaoewoRuntime;
}> {
  const events: CapturedEvent[] = [];
  const base = createDemoRuntime({
    initialUser: {
      id: 'analytics-test-user',
      displayName: '분석 테스트',
      isGuest: false,
    },
    now: () => new Date('2026-07-12T09:00:00.000Z'),
  });
  const analytics: DaoewoAnalytics = {
    async track<Event extends DaoewoAnalyticsEventName>(
      event: Event,
      properties: DaoewoAnalyticsEventMap[Event],
    ) {
      events.push({
        event,
        properties: properties as Readonly<Record<string, DaoewoAnalyticsValue>>,
      });
    },
  };
  const runtime: DaoewoRuntime = {
    ...base,
    analytics,
    purchase: {
      ...base.purchase,
      async getOffers() {
        return [
          {
            plan: 'annual',
            displayPrice: '테스트 가격',
            periodLabel: '년',
            trialDays: 7,
          },
        ];
      },
    },
  };
  let renderer: ReactTestRenderer | undefined;

  await act(async () => {
    renderer = create(
      <DaoewoApp
        authOptions={authOptions}
        initialScreen={initialScreen}
        runtime={runtime}
      />,
    );
    await Promise.resolve();
  });

  return {renderer: renderer!, events, runtime};
}

async function unmount(renderer: ReactTestRenderer): Promise<void> {
  await act(async () => {
    renderer.unmount();
  });
}

function event(
  events: readonly CapturedEvent[],
  name: DaoewoAnalyticsEventName,
): CapturedEvent | undefined {
  return events.find(item => item.event === name);
}

describe('다외워 analytics 실제 사용자 플로우', () => {
  it('카탈로그 분야 탐색과 무료 덱 진입을 기록한다', async () => {
    const {renderer, events} = await renderTracked('catalog');

    expect(event(events, 'memo_catalog_browse')).toEqual({
      event: 'memo_catalog_browse',
      properties: {category: 'all'},
    });

    await act(async () => {
      renderer.root.findByProps({accessibilityLabel: '언어'}).props.onPress();
    });
    expect(events).toContainEqual({
      event: 'memo_catalog_browse',
      properties: {category: '언어'},
    });

    await act(async () => {
      renderer.root
        .findByProps({
          accessibilityLabel: '영어 필수단어 입문, 600장, 무료 덱',
        })
        .props.onPress();
    });
    expect(event(events, 'memo_deck_open')).toEqual({
      event: 'memo_deck_open',
      properties: {
        deck_id: 'english-starter',
        tier: 'free',
        source: 'official',
      },
    });
    await unmount(renderer);
  });

  it('잠긴 Pro 덱 탭에서 premium-deck 페이월 퍼널을 기록한다', async () => {
    const {renderer, events} = await renderTracked('catalog');

    await act(async () => {
      renderer.root
        .findByProps({
          accessibilityLabel: '영어 심화 빈출, 1,250장, Pro 덱, 잠김',
        })
        .props.onPress();
    });

    expect(event(events, 'memo_premium_deck_tap')).toEqual({
      event: 'memo_premium_deck_tap',
      properties: {deck_id: 'english-advanced'},
    });
    expect(event(events, 'memo_paywall_view')).toEqual({
      event: 'memo_paywall_view',
      properties: {trigger: 'premium-deck'},
    });
    await unmount(renderer);
  });

  it('목표 설정과 학습 세션 시작을 정확한 배분값으로 기록한다', async () => {
    const {renderer, events} = await renderTracked('deck-detail');

    await act(async () => {
      renderer.root
        .findByProps({accessibilityLabel: '이 목표로 시작하기'})
        .props.onPress();
    });

    expect(event(events, 'memo_goal_set')).toEqual({
      event: 'memo_goal_set',
      properties: {mode: 'days', days: 30, daily_count: 20},
    });
    expect(event(events, 'memo_session_start')).toEqual({
      event: 'memo_session_start',
      properties: {deck_id: 'english-starter', target_count: 5},
    });
    await unmount(renderer);
  });

  it('오늘 분량 완료와 스트릭 갱신을 기록한다', async () => {
    jest.useFakeTimers();
    const {renderer, events} = await renderTracked('study');

    for (let index = 0; index < 5; index += 1) {
      await act(async () => {
        renderer.root.findByProps({accessibilityLabel: '안다'}).props.onPress();
        jest.advanceTimersByTime(200);
        await Promise.resolve();
      });
    }

    expect(event(events, 'memo_session_complete')).toEqual({
      event: 'memo_session_complete',
      properties: {known: 5, unknown: 0, elapsed_ms: 0},
    });
    expect(event(events, 'memo_streak_extend')).toEqual({
      event: 'memo_streak_extend',
      properties: {streak_days: 1},
    });
    await unmount(renderer);
    jest.useRealTimers();
  });

  it('플립 복습 결과는 outcome만 기록한다', async () => {
    jest.useFakeTimers();
    const {renderer, events} = await renderTracked('study');

    await act(async () => {
      renderer.root
        .findByProps({accessibilityLabel: '모르겠다'})
        .props.onPress();
      jest.advanceTimersByTime(200);
      await Promise.resolve();
    });
    for (let index = 0; index < 4; index += 1) {
      await act(async () => {
        renderer.root.findByProps({accessibilityLabel: '안다'}).props.onPress();
        jest.advanceTimersByTime(200);
        await Promise.resolve();
      });
    }

    await act(async () => {
      renderer.root
        .findByProps({accessibilityLabel: '勉強する, 탭하여 정답 보기'})
        .props.onPress();
    });
    await act(async () => {
      renderer.root
        .findByProps({accessibilityLabel: '맞췄다, 다음 복습 1일 후'})
        .props.onPress();
    });

    expect(event(events, 'memo_review_outcome')).toEqual({
      event: 'memo_review_outcome',
      properties: {outcome: 'easy'},
    });
    await unmount(renderer);
    jest.useRealTimers();
  });

  it('덱 요청 analytics에는 카테고리와 locale만 보낸다', async () => {
    const {renderer, events} = await renderTracked('deck-request');

    await act(async () => {
      renderer.root
        .findByProps({accessibilityLabel: '외우고 싶은 주제'})
        .props.onChangeText('관세사 1차 관세법 핵심 조문');
      renderer.root
        .findByProps({accessibilityLabel: '덱 요청 참고 메모'})
        .props.onChangeText('개인 일정과 참고 링크');
    });
    await act(async () => {
      await renderer.root
        .findByProps({accessibilityLabel: '요청 보내기'})
        .props.onPress();
    });

    expect(event(events, 'memo_deck_request')).toEqual({
      event: 'memo_deck_request',
      properties: {category: '자격증', locale: 'ko'},
    });
    await unmount(renderer);
  });

  it('무료 체험 구독과 통계 공유를 각각 기록한다', async () => {
    const paywall = await renderTracked('paywall');
    await act(async () => {
      await paywall.renderer.root
        .findByProps({accessibilityLabel: '7일 무료로 시작하기'})
        .props.onPress();
    });
    expect(event(paywall.events, 'memo_subscribe')).toEqual({
      event: 'memo_subscribe',
      properties: {plan: 'annual', trial: true},
    });
    await unmount(paywall.renderer);

    const statistics = await renderTracked('statistics');
    await act(async () => {
      statistics.renderer.root
        .findByProps({accessibilityLabel: '이번 주 기록 공유하기'})
        .props.onPress();
    });
    expect(event(statistics.events, 'memo_share')).toEqual({
      event: 'memo_share',
      properties: {type: 'weekly-progress'},
    });
    await unmount(statistics.renderer);
  });

  it('AIT auth options는 Toss 로그인과 게스트만 노출한다', async () => {
    const {renderer, runtime} = await renderTracked(
      'onboarding',
      APPS_IN_TOSS_AUTH_OPTIONS,
    );
    const signIn = jest.spyOn(runtime.auth, 'signIn');

    expect(
      renderer.root.findByProps({accessibilityLabel: '토스로 계속하기'}),
    ).toBeTruthy();
    expect(
      renderer.root.findAllByProps({accessibilityLabel: 'Google로 계속하기'}),
    ).toHaveLength(0);
    expect(
      renderer.root.findAllByProps({accessibilityLabel: 'Apple로 계속하기'}),
    ).toHaveLength(0);
    expect(
      renderer.root.findByProps({accessibilityLabel: '로그인 없이 시작하기'}),
    ).toBeTruthy();
    await act(async () => {
      await renderer.root
        .findByProps({accessibilityLabel: '토스로 계속하기'})
        .props.onPress();
    });
    expect(signIn).toHaveBeenCalledWith('toss');
    await unmount(renderer);
  });
});
