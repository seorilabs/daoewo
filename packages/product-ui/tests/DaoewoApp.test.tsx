import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {DaoewoApp} from '../src/DaoewoApp';
import {createDemoRuntime} from '../src/runtime';
import type {DaoewoScreen} from '../src/navigation';

describe('DaoewoApp', () => {
  it('게스트가 온보딩에서 홈으로 진입할 수 있다', async () => {
    const runtime = createDemoRuntime();
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<DaoewoApp runtime={runtime} />);
      await Promise.resolve();
    });

    const guestButton = renderer!.root.findByProps({
      accessibilityLabel: '로그인 없이 시작하기',
    });
    expect(
      renderer!.root.findByProps({accessibilityLabel: 'Google로 계속하기'}),
    ).toBeTruthy();
    expect(
      renderer!.root.findByProps({accessibilityLabel: 'Apple로 계속하기'}),
    ).toBeTruthy();

    await act(async () => {
      await guestButton.props.onPress();
    });

    expect(renderer!.root.findByProps({testID: 'continue-study'})).toBeTruthy();
  });

  it('홈의 대표 행동과 하단 탭에 접근성 이름이 있다', async () => {
    const runtime = createDemoRuntime({
      initialUser: {
        id: 'test-user',
        displayName: '테스트',
        isGuest: false,
      },
    });
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(<DaoewoApp initialScreen="home" runtime={runtime} />);
      await Promise.resolve();
    });

    expect(
      renderer!.root.findByProps({accessibilityLabel: '오늘 분량 이어하기'}),
    ).toBeTruthy();
    expect(renderer!.root.findByProps({accessibilityLabel: '통계 탭'})).toBeTruthy();
    expect(renderer!.root.findByProps({accessibilityLabel: '설정 탭'})).toBeTruthy();
  });

  it.each<DaoewoScreen>([
    'onboarding',
    'home',
    'deck-detail',
    'study',
    'quick-review',
    'mistakes',
    'catalog',
    'deck-request',
    'statistics',
    'paywall',
    'settings',
  ])('%s 화면이 demo runtime에서 렌더된다', async initialScreen => {
    const runtime = createDemoRuntime({
      initialUser: {
        id: 'screen-test-user',
        displayName: '화면 테스트',
        isGuest: false,
      },
    });
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(
        <DaoewoApp initialScreen={initialScreen} runtime={runtime} />,
      );
      await Promise.resolve();
    });

    expect(renderer!.toJSON()).toBeTruthy();
    await act(async () => {
      renderer!.unmount();
    });
  });
});
