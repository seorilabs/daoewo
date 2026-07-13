import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { classifySwipe, createInitialCardProgress } from "@daoewo/product-core";

import { DaoewoApp } from "../src/DaoewoApp";
import type { DaoewoCardView } from "../src/demo-data";
import {
  learningStateStorageKey,
  mergeLearningStates,
  saveLearningState,
  saveSettingsState,
  settingsStorageKey,
  type DaoewoLearningState,
  type DaoewoSettingsState,
} from "../src/product-state";
import {
  APPS_IN_TOSS_AUTH_OPTIONS,
  createDemoRuntime,
  type DaoewoRuntime,
  type DaoewoUser,
} from "../src/runtime";

const NOW = new Date("2026-07-12T09:00:00.000Z");
const GUEST: DaoewoUser = {
  id: "local-guest",
  displayName: "게스트",
  isGuest: true,
};
const TARGET: DaoewoUser = {
  id: "linked-user",
  displayName: "연결 사용자",
  email: "linked@example.com",
  isGuest: false,
};

function stateFor(
  cardId: string,
  front: string,
  offsetMs = 0
): DaoewoLearningState {
  const card: DaoewoCardView = {
    id: cardId,
    deckId: "test-deck",
    front,
    back: `${front} 정답`,
    tags: ["연결 테스트"],
    locale: "ko",
  };
  const at = new Date(NOW.getTime() + offsetMs);
  return {
    version: 1,
    progresses: [
      classifySwipe(
        createInitialCardProgress(card.id, card.deckId, at),
        "unknown",
        at
      ),
    ],
    cardSnapshots: [card],
    sessions: [],
  };
}

async function render(
  runtime: DaoewoRuntime,
  initialScreen: "settings" | "paywall",
  authOptions = undefined as typeof APPS_IN_TOSS_AUTH_OPTIONS | undefined
): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(
      <DaoewoApp
        initialScreen={initialScreen}
        runtime={runtime}
        {...(authOptions === undefined ? {} : { authOptions })}
      />
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer!;
}

async function press(
  renderer: ReactTestRenderer,
  accessibilityLabel: string
): Promise<void> {
  await act(async () => {
    await renderer.root.findByProps({ accessibilityLabel }).props.onPress();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("게스트 계정 연결", () => {
  it("학습 상태 merge가 입력 순서와 재시도에 무관하게 결정적이다", () => {
    const older = stateFor("same-card", "이전 카드");
    const newer = stateFor("same-card", "새 카드", 60_000);
    const first = mergeLearningStates(older, newer);

    expect(first).toEqual(mergeLearningStates(newer, older));
    expect(mergeLearningStates(first, older)).toEqual(first);
    expect(first.cardSnapshots).toHaveLength(1);
    expect(first.progresses[0]?.updatedAt).toBe(
      new Date(NOW.getTime() + 60_000).toISOString()
    );
  });

  it("같은 UID credential link는 기존 local key와 학습 상태를 보존한다", async () => {
    const original = stateFor("guest-card", "게스트 카드");
    const base = createDemoRuntime({ initialUser: GUEST, now: () => NOW });
    const removedKeys: string[] = [];
    const runtime: DaoewoRuntime = {
      ...base,
      storage: {
        ...base.storage,
        async removeItem(key) {
          removedKeys.push(key);
          await base.storage.removeItem(key);
        },
      },
      auth: {
        ...base.auth,
        async signIn() {
          return { ...GUEST, displayName: "연결 완료", isGuest: false };
        },
      },
    };
    await saveLearningState(runtime.storage, GUEST.id, original);
    const renderer = await render(runtime, "settings");

    await press(renderer, "Google 계정 연결");

    expect(
      await runtime.storage.getItem(learningStateStorageKey(GUEST.id))
    ).toEqual(original);
    expect(removedKeys).not.toContain(learningStateStorageKey(GUEST.id));
    expect(JSON.stringify(renderer.toJSON())).toContain("연결 완료");
    expect(JSON.stringify(renderer.toJSON())).not.toContain(
      "게스트 계정 연결 안내"
    );
  });

  it("다른 UID 연결은 guest와 target 상태를 합쳐 target에 저장한 뒤 source를 지운다", async () => {
    const guestState = stateFor("guest-card", "게스트 카드");
    const targetState = stateFor("target-card", "기존 계정 카드", 60_000);
    const base = createDemoRuntime({ initialUser: GUEST, now: () => NOW });
    const runtime: DaoewoRuntime = {
      ...base,
      auth: {
        ...base.auth,
        async signIn() {
          return TARGET;
        },
      },
    };
    await saveLearningState(runtime.storage, GUEST.id, guestState);
    await saveLearningState(runtime.storage, TARGET.id, targetState);
    const renderer = await render(runtime, "settings");

    await press(renderer, "Google 계정 연결");

    expect(
      await runtime.storage.getItem(learningStateStorageKey(GUEST.id))
    ).toBeNull();
    const merged = await runtime.storage.getItem<DaoewoLearningState>(
      learningStateStorageKey(TARGET.id)
    );
    expect(merged?.progresses.map((item) => item.cardId)).toEqual([
      "guest-card",
      "target-card",
    ]);
    expect(merged?.cardSnapshots.map((item) => item.front)).toEqual([
      "게스트 카드",
      "기존 계정 카드",
    ]);
    expect(JSON.stringify(renderer.toJSON())).toContain("연결 사용자");
  });

  it("진행 중인 알림 설정을 완료한 뒤 확정된 guest 설정으로 계정을 연결한다", async () => {
    const events: string[] = [];
    let finishFirstEnable: (() => void) | undefined;
    let enableCount = 0;
    const base = createDemoRuntime({ initialUser: GUEST, now: () => NOW });
    const runtime: DaoewoRuntime = {
      ...base,
      tts: { ...base.tts, availability: "available" },
      deckReadyNotifications: {
        availability: "available",
        async setEnabled(enabled) {
          events.push(`notification:${enabled}`);
          if (enabled && enableCount++ === 0) {
            await new Promise<void>((resolve) => {
              finishFirstEnable = resolve;
            });
          }
        },
        async clear() {},
      },
      auth: {
        ...base.auth,
        async signIn() {
          events.push("auth:signIn");
          return TARGET;
        },
      },
    };
    const initialSettings: DaoewoSettingsState = {
      dailyReminder: false,
      reviewReminder: false,
      deckReadyNotification: false,
      ttsEnabled: true,
      voiceGuide: false,
    };
    await saveSettingsState(runtime.storage, GUEST.id, initialSettings);
    const renderer = await render(runtime, "settings");
    events.length = 0;

    await act(async () => {
      renderer.root
        .findByProps({ accessibilityLabel: "신규·요청 덱 알림" })
        .props.onValueChange(true);
      await Promise.resolve();
    });
    let linking: Promise<void> | undefined;
    await act(async () => {
      linking = renderer.root
        .findByProps({ accessibilityLabel: "Google 계정 연결" })
        .props.onPress();
      await Promise.resolve();
    });

    expect(events).toEqual(["notification:true"]);

    await act(async () => {
      finishFirstEnable?.();
      await linking;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(events).toEqual([
      "notification:true",
      "auth:signIn",
      "notification:true",
    ]);
    expect(
      await runtime.storage.getItem<DaoewoSettingsState>(
        settingsStorageKey(TARGET.id)
      )
    ).toMatchObject({ deckReadyNotification: true });
    expect(
      await runtime.storage.getItem(settingsStorageKey(GUEST.id))
    ).toBeNull();
  });

  it("로그인 실패와 target 저장 실패에서는 guest local state를 지우지 않는다", async () => {
    const guestState = stateFor("guest-card", "보존할 게스트 카드");
    const loginBase = createDemoRuntime({ initialUser: GUEST, now: () => NOW });
    const loginFailure: DaoewoRuntime = {
      ...loginBase,
      auth: {
        ...loginBase.auth,
        async signIn() {
          throw new Error("private login failure");
        },
      },
    };
    await saveLearningState(loginFailure.storage, GUEST.id, guestState);
    const loginRenderer = await render(loginFailure, "settings");

    await press(loginRenderer, "Google 계정 연결");

    expect(
      await loginFailure.storage.getItem(learningStateStorageKey(GUEST.id))
    ).toEqual(guestState);
    expect(JSON.stringify(loginRenderer.toJSON())).toContain(
      "로그인을 완료하지 못했어요"
    );
    expect(JSON.stringify(loginRenderer.toJSON())).not.toContain(
      "private login failure"
    );

    const saveBase = createDemoRuntime({ initialUser: GUEST, now: () => NOW });
    const saveFailure: DaoewoRuntime = {
      ...saveBase,
      storage: {
        ...saveBase.storage,
        async setItem(key, value) {
          if (key === learningStateStorageKey(TARGET.id)) {
            throw new Error("target write failure");
          }
          await saveBase.storage.setItem(key, value);
        },
      },
      auth: {
        ...saveBase.auth,
        async signIn() {
          return TARGET;
        },
      },
    };
    await saveLearningState(saveFailure.storage, GUEST.id, guestState);
    const saveRenderer = await render(saveFailure, "settings");

    await press(saveRenderer, "Google 계정 연결");

    expect(
      await saveFailure.storage.getItem(learningStateStorageKey(GUEST.id))
    ).toEqual(guestState);
    expect(
      await saveFailure.storage.getItem(learningStateStorageKey(TARGET.id))
    ).toBeNull();
    expect(JSON.stringify(saveRenderer.toJSON())).toContain("연결 사용자");
    expect(JSON.stringify(saveRenderer.toJSON())).not.toContain(
      "로그인을 완료하지 못했어요"
    );
  });

  it("runtime가 target 전환 뒤 throw하면 Auth를 재조회해 target owner로 복구한다", async () => {
    const guestState = stateFor("guest-card", "응답 유실에도 보존할 카드");
    const base = createDemoRuntime({ initialUser: GUEST, now: () => NOW });
    let currentUser: DaoewoUser | null = GUEST;
    const runtime: DaoewoRuntime = {
      ...base,
      auth: {
        ...base.auth,
        async getCurrentUser() {
          return currentUser;
        },
        async signIn() {
          currentUser = { ...TARGET, accountMergeStatus: "pending" };
          throw new Error("callable response lost");
        },
      },
    };
    await saveLearningState(runtime.storage, GUEST.id, guestState);
    const renderer = await render(runtime, "settings");

    await press(renderer, "Google 계정 연결");

    expect(
      await runtime.storage.getItem(learningStateStorageKey(GUEST.id))
    ).toEqual(guestState);
    expect(JSON.stringify(renderer.toJSON())).toContain("연결 사용자");
    expect(JSON.stringify(renderer.toJSON())).not.toContain(
      "로그인을 완료하지 못했어요"
    );
  });

  it("계정 연결 중 상태를 표시하고 다른 로그인 CTA를 잠근다", async () => {
    let completeSignIn: ((user: DaoewoUser) => void) | undefined;
    const pendingSignIn = new Promise<DaoewoUser>((resolve) => {
      completeSignIn = resolve;
    });
    const base = createDemoRuntime({ initialUser: GUEST, now: () => NOW });
    const runtime: DaoewoRuntime = {
      ...base,
      auth: {
        ...base.auth,
        async signIn() {
          return pendingSignIn;
        },
      },
    };
    const renderer = await render(runtime, "settings");
    let linking: Promise<void> | undefined;

    act(() => {
      linking = renderer.root
        .findByProps({ accessibilityLabel: "Google 계정 연결" })
        .props.onPress();
    });

    expect(
      renderer.root.findByProps({
        accessibilityLabel: "Google 계정 연결 중…",
      }).props.accessibilityState
    ).toEqual({ disabled: true, busy: true });
    expect(
      renderer.root.findByProps({
        accessibilityLabel: "Apple 계정 연결",
      }).props.accessibilityState
    ).toEqual({ disabled: true, busy: false });

    await act(async () => {
      completeSignIn?.(TARGET);
      await linking;
    });
  });

  it("Paywall과 Settings가 target별 계정 연결 CTA를 제공하고 guest 구매를 차단한다", async () => {
    const mobile = createDemoRuntime({ initialUser: GUEST, now: () => NOW });
    const settings = await render(mobile, "settings");
    expect(
      settings.root.findByProps({ accessibilityLabel: "Google 계정 연결" })
    ).toBeTruthy();
    expect(
      settings.root.findByProps({ accessibilityLabel: "Apple 계정 연결" })
    ).toBeTruthy();

    const ait = createDemoRuntime({ initialUser: GUEST, now: () => NOW });
    const paywall = await render(ait, "paywall", APPS_IN_TOSS_AUTH_OPTIONS);
    expect(
      paywall.root.findByProps({ accessibilityLabel: "토스 계정 연결" })
    ).toBeTruthy();
    expect(
      paywall.root.findByProps({
        accessibilityLabel: "계정 연결 후 구독 가능",
      }).props.accessibilityState
    ).toEqual({ disabled: true, busy: false });
    expect(
      paywall.root.findByProps({
        accessibilityLabel: "계정 연결 후 구매 복원",
      }).props.accessibilityState
    ).toEqual({ disabled: true });
  });
});
