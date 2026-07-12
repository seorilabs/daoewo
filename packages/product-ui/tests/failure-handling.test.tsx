import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {DaoewoApp} from '../src/DaoewoApp';
import type {DaoewoScreen} from '../src/navigation';
import {
  createDemoRuntime,
  type DaoewoRuntime,
} from '../src/runtime';

async function renderWithRuntime(
  runtime: DaoewoRuntime,
  initialScreen?: DaoewoScreen,
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

async function unmount(renderer: ReactTestRenderer): Promise<void> {
  await act(async () => {
    renderer.unmount();
  });
}

describe('fail-closed adapter 오류 처리', () => {
  it('로그인과 게스트 오류를 일반 안내로 표시하고 내부 메시지를 숨긴다', async () => {
    const base = createDemoRuntime();
    const runtime: DaoewoRuntime = {
      ...base,
      auth: {
        ...base.auth,
        async signIn() {
          throw new Error('secret oauth configuration');
        },
        async continueAsGuest() {
          throw new Error('secret anonymous auth configuration');
        },
      },
    };
    const renderer = await renderWithRuntime(runtime, 'onboarding');

    await act(async () => {
      await renderer.root
        .findByProps({accessibilityLabel: 'Google로 계속하기'})
        .props.onPress();
    });
    expect(JSON.stringify(renderer.toJSON())).toContain(
      '로그인을 완료하지 못했어요',
    );
    expect(JSON.stringify(renderer.toJSON())).not.toContain('secret oauth');

    await act(async () => {
      await renderer.root
        .findByProps({accessibilityLabel: '로그인 없이 시작하기'})
        .props.onPress();
    });
    expect(JSON.stringify(renderer.toJSON())).toContain(
      '게스트 시작을 완료하지 못했어요',
    );
    expect(JSON.stringify(renderer.toJSON())).not.toContain('secret anonymous');
    await unmount(renderer);
  });

  it('초기 계정 조회 실패도 onboarding에서 복구 가능한 안내로 표시한다', async () => {
    const base = createDemoRuntime();
    const runtime: DaoewoRuntime = {
      ...base,
      auth: {
        ...base.auth,
        async getCurrentUser() {
          throw new Error('private endpoint response');
        },
      },
    };
    const renderer = await renderWithRuntime(runtime);
    const output = JSON.stringify(renderer.toJSON());

    expect(output).toContain('계정 상태를 확인하지 못했어요');
    expect(output).not.toContain('private endpoint');
    await unmount(renderer);
  });

  it('구독과 복원 미지원 오류를 generic 페이월 안내로 처리한다', async () => {
    const base = createDemoRuntime({
      initialUser: {id: 'purchase-test', displayName: '구매 테스트', isGuest: false},
    });
    const runtime: DaoewoRuntime = {
      ...base,
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
        async purchase() {
          throw new Error('secret StoreKit product id');
        },
        async restore() {
          throw new Error('secret sandbox unsupported');
        },
      },
    };
    const renderer = await renderWithRuntime(runtime, 'paywall');

    await act(async () => {
      await renderer.root
        .findByProps({accessibilityLabel: '7일 무료로 시작하기'})
        .props.onPress();
    });
    expect(JSON.stringify(renderer.toJSON())).toContain(
      '현재 환경에서 사용할 수 없거나 설정이 준비되지 않았을 수 있어요',
    );
    expect(JSON.stringify(renderer.toJSON())).not.toContain('StoreKit');

    await act(async () => {
      await renderer.root
        .findByProps({accessibilityLabel: '구매 복원'})
        .props.onPress();
    });
    expect(JSON.stringify(renderer.toJSON())).toContain(
      '구매 내역을 복원하지 못했어요',
    );
    expect(JSON.stringify(renderer.toJSON())).not.toContain('sandbox unsupported');
    await unmount(renderer);
  });

  it('로그아웃 실패를 설정 화면 안에서 처리한다', async () => {
    const base = createDemoRuntime({
      initialUser: {id: 'auth-test', displayName: '계정 테스트', isGuest: false},
    });
    const runtime: DaoewoRuntime = {
      ...base,
      auth: {
        ...base.auth,
        async signOut() {
          throw new Error('secret revoke response');
        },
      },
    };
    const renderer = await renderWithRuntime(runtime, 'settings');

    await act(async () => {
      await renderer.root
        .findByProps({accessibilityLabel: '로그아웃'})
        .props.onPress();
    });
    expect(JSON.stringify(renderer.toJSON())).toContain(
      '로그아웃을 완료하지 못했어요',
    );
    expect(JSON.stringify(renderer.toJSON())).not.toContain('secret revoke');
    await unmount(renderer);
  });

  it('빈 catalog와 catalog 조회 실패를 안전한 상태로 표시하고 재시도한다', async () => {
    const emptyBase = createDemoRuntime();
    const emptyRuntime: DaoewoRuntime = {
      ...emptyBase,
      content: {
        ...emptyBase.content,
        async listCatalog() {
          return [];
        },
      },
    };
    const emptyRenderer = await renderWithRuntime(emptyRuntime, 'home');
    expect(JSON.stringify(emptyRenderer.toJSON())).toContain(
      '아직 표시할 콘텐츠가 없어요',
    );
    await unmount(emptyRenderer);

    const retryBase = createDemoRuntime();
    let attempts = 0;
    const retryRuntime: DaoewoRuntime = {
      ...retryBase,
      content: {
        ...retryBase.content,
        async listCatalog() {
          attempts += 1;
          if (attempts === 1) {
            throw new Error('private catalog callable response');
          }
          return retryBase.content.listCatalog();
        },
      },
    };
    const retryRenderer = await renderWithRuntime(retryRuntime, 'home');
    expect(JSON.stringify(retryRenderer.toJSON())).toContain(
      '콘텐츠를 불러오지 못했어요',
    );
    expect(JSON.stringify(retryRenderer.toJSON())).not.toContain('private catalog');
    await act(async () => {
      await retryRenderer.root
        .findByProps({accessibilityLabel: '다시 시도하기'})
        .props.onPress();
      await Promise.resolve();
    });
    expect(
      retryRenderer.root.findByProps({accessibilityLabel: '오늘 분량 이어하기'}),
    ).toBeTruthy();
    await unmount(retryRenderer);
  });

  it('목표 생성, 카드 window, 덱 요청 실패를 generic UI로 처리한다', async () => {
    const goalBase = createDemoRuntime();
    const goalRuntime: DaoewoRuntime = {
      ...goalBase,
      content: {
        ...goalBase.content,
        async createGoal() {
          throw new Error('private goal callable response');
        },
      },
    };
    const goalRenderer = await renderWithRuntime(goalRuntime, 'deck-detail');
    await act(async () => {
      await goalRenderer.root
        .findByProps({accessibilityLabel: '이 목표로 시작하기'})
        .props.onPress();
    });
    expect(JSON.stringify(goalRenderer.toJSON())).toContain(
      '목표를 만들지 못했어요',
    );
    expect(JSON.stringify(goalRenderer.toJSON())).not.toContain('private goal');
    await unmount(goalRenderer);

    const windowBase = createDemoRuntime();
    const getWindow = jest.fn(async () => {
      throw new Error('private content window response');
    });
    const windowRuntime: DaoewoRuntime = {
      ...windowBase,
      content: {...windowBase.content, getCardWindow: getWindow},
    };
    const windowRenderer = await renderWithRuntime(windowRuntime, 'study');
    expect(JSON.stringify(windowRenderer.toJSON())).toContain(
      '콘텐츠를 불러오지 못했어요',
    );
    expect(JSON.stringify(windowRenderer.toJSON())).not.toContain('private content');
    await act(async () => {
      await windowRenderer.root
        .findByProps({accessibilityLabel: '다시 시도하기'})
        .props.onPress();
      await Promise.resolve();
    });
    expect(getWindow).toHaveBeenCalledTimes(2);
    await unmount(windowRenderer);

    const emptyWindowBase = createDemoRuntime();
    const emptyWindowRuntime: DaoewoRuntime = {
      ...emptyWindowBase,
      content: {
        ...emptyWindowBase.content,
        async getCardWindow(input) {
          return {
            id: 'empty-window',
            deckId: input.deckId,
            cards: [],
            targetCount: 0,
          };
        },
      },
    };
    const emptyWindowRenderer = await renderWithRuntime(
      emptyWindowRuntime,
      'study',
    );
    expect(JSON.stringify(emptyWindowRenderer.toJSON())).toContain(
      '아직 표시할 콘텐츠가 없어요',
    );
    await unmount(emptyWindowRenderer);

    const requestBase = createDemoRuntime();
    const requestRuntime: DaoewoRuntime = {
      ...requestBase,
      content: {
        ...requestBase.content,
        async submitDeckRequest() {
          throw new Error('private request callable response');
        },
      },
    };
    const requestRenderer = await renderWithRuntime(
      requestRuntime,
      'deck-request',
    );
    await act(async () => {
      requestRenderer.root
        .findByProps({accessibilityLabel: '외우고 싶은 주제'})
        .props.onChangeText('관세법 핵심');
    });
    await act(async () => {
      await requestRenderer.root
        .findByProps({accessibilityLabel: '요청 보내기'})
        .props.onPress();
    });
    expect(JSON.stringify(requestRenderer.toJSON())).toContain(
      '요청을 저장하지 못했어요',
    );
    expect(JSON.stringify(requestRenderer.toJSON())).not.toContain('private request');
    await unmount(requestRenderer);
  });

  it('progress batch 실패를 학습 완료 후 generic 동기화 안내로 표시한다', async () => {
    jest.useFakeTimers();
    const base = createDemoRuntime();
    const runtime: DaoewoRuntime = {
      ...base,
      content: {
        ...base.content,
        async getCardWindow(input) {
          const window = await base.content.getCardWindow(input);
          return {...window, cards: window.cards.slice(0, 1), targetCount: 1};
        },
        async commitProgressBatch() {
          throw new Error('private progress batch response');
        },
      },
    };
    const renderer = await renderWithRuntime(runtime, 'study');

    await act(async () => {
      renderer.root.findByProps({accessibilityLabel: '안다'}).props.onPress();
      jest.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(JSON.stringify(renderer.toJSON())).toContain(
      '학습 기록을 동기화하지 못했어요',
    );
    expect(JSON.stringify(renderer.toJSON())).not.toContain('private progress');
    await unmount(renderer);
    jest.useRealTimers();
  });
});
