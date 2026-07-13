import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { AccessibilityInfo } from "react-native";

import {
  classifySwipe,
  createInitialCardProgress,
  type LearningSyncSnapshot,
  type SyncEnvelope,
} from "@daoewo/product-core";

import { DaoewoApp } from "../src/DaoewoApp";
import {
  createLearningDataExport,
  saveSettingsState,
  serializeLearningDataExport,
  settingsStorageKey,
  type DaoewoLearningState,
} from "../src/product-state";
import {
  createDemoRuntime,
  type DaoewoNotificationPreferences,
  type DaoewoRuntime,
} from "../src/runtime";

const NOW = new Date("2026-07-13T00:00:00.000Z");
const USER = {
  id: "settings-user",
  displayName: "설정 사용자",
  isGuest: false,
};

async function render(
  runtime: DaoewoRuntime,
  initialScreen: "settings" | "study" = "settings"
): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(
      <DaoewoApp initialScreen={initialScreen} runtime={runtime} />
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer!;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function availableRuntime(input?: {
  readonly apply?: (value: DaoewoNotificationPreferences) => Promise<void>;
  readonly clear?: () => Promise<void>;
}): DaoewoRuntime {
  const base = createDemoRuntime({ initialUser: USER, now: () => NOW });
  return {
    ...base,
    tts: {
      ...base.tts,
      availability: "available",
    },
    notifications: {
      availability: "available",
      applyPreferences: input?.apply ?? (async () => undefined),
      clear: input?.clear ?? (async () => undefined),
    },
  };
}

describe("계정별 설정과 실제 adapter 경계", () => {
  it("알림 ON은 adapter 성공 후에만 계정별 storage에 저장한다", async () => {
    const applied: DaoewoNotificationPreferences[] = [];
    const runtime = availableRuntime({
      async apply(value) {
        applied.push(value);
      },
    });
    const renderer = await render(runtime);

    await act(async () => {
      renderer.root
        .findByProps({ accessibilityLabel: "일일 학습 알림" })
        .props.onValueChange(true);
      await flush();
    });

    expect(applied.at(-1)).toMatchObject({ dailyReminder: true });
    expect(
      await runtime.storage.getItem(settingsStorageKey(USER.id))
    ).toMatchObject({ dailyReminder: true });
  });

  it("알림 ON adapter 실패 시 true를 저장하지 않는다", async () => {
    const runtime = availableRuntime({
      async apply(value) {
        if (value.dailyReminder) {
          throw new Error("permission denied");
        }
      },
    });
    const renderer = await render(runtime);

    await act(async () => {
      renderer.root
        .findByProps({ accessibilityLabel: "일일 학습 알림" })
        .props.onValueChange(true);
      await flush();
    });

    expect(
      await runtime.storage.getItem(settingsStorageKey(USER.id))
    ).toBeNull();
    expect(JSON.stringify(renderer.toJSON())).toContain(
      "알림 권한 또는 예약을 적용하지 못해 설정을 변경하지 않았어요"
    );
  });

  it("알림 OFF는 native cancel 실패에도 false를 유지한다", async () => {
    let applyCount = 0;
    const runtime = availableRuntime({
      async apply(value) {
        applyCount += 1;
        if (applyCount > 1 && !value.dailyReminder) {
          throw new Error("cancel failed");
        }
      },
    });
    await saveSettingsState(runtime.storage, USER.id, {
      dailyReminder: true,
      reviewReminder: false,
      deckReadyNotification: false,
      ttsEnabled: true,
      voiceGuide: false,
    });
    const renderer = await render(runtime);

    await act(async () => {
      renderer.root
        .findByProps({ accessibilityLabel: "일일 학습 알림" })
        .props.onValueChange(false);
      await flush();
    });

    expect(
      await runtime.storage.getItem(settingsStorageKey(USER.id))
    ).toMatchObject({ dailyReminder: false });
    expect(
      renderer.root.findByProps({ accessibilityLabel: "일일 학습 알림" }).props
        .value
    ).toBe(false);
  });

  it("두 번째 알림 ON 실패 시 기존 native 알림 설정을 복원한다", async () => {
    const applied: DaoewoNotificationPreferences[] = [];
    const runtime = availableRuntime({
      async apply(value) {
        applied.push(value);
        if (value.reviewReminder) {
          throw new Error("review schedule failed");
        }
      },
    });
    await saveSettingsState(runtime.storage, USER.id, {
      dailyReminder: true,
      reviewReminder: false,
      deckReadyNotification: false,
      ttsEnabled: true,
      voiceGuide: false,
    });
    const renderer = await render(runtime);

    await act(async () => {
      renderer.root
        .findByProps({ accessibilityLabel: "복습 알림" })
        .props.onValueChange(true);
      await flush();
    });

    expect(applied.at(-1)).toMatchObject({
      dailyReminder: true,
      reviewReminder: false,
    });
    expect(
      await runtime.storage.getItem(settingsStorageKey(USER.id))
    ).toMatchObject({ dailyReminder: true, reviewReminder: false });
  });

  it("background 복습 예약 뒤 사용자가 끈 설정을 native 최종 상태로 직렬화한다", async () => {
    const applied: DaoewoNotificationPreferences[] = [];
    let finishBackgroundApply: (() => void) | undefined;
    let markBackgroundApplyStarted: (() => void) | undefined;
    const backgroundApplyStarted = new Promise<void>((resolve) => {
      markBackgroundApplyStarted = resolve;
    });
    let applyCount = 0;
    const base = availableRuntime({
      async apply(value) {
        applied.push(value);
        applyCount += 1;
        if (applyCount === 2) {
          markBackgroundApplyStarted?.();
          await new Promise<void>((resolve) => {
            finishBackgroundApply = resolve;
          });
        }
      },
    });
    let finishPull:
      | ((value: SyncEnvelope<LearningSyncSnapshot>) => void)
      | undefined;
    const pull = new Promise<SyncEnvelope<LearningSyncSnapshot>>((resolve) => {
      finishPull = resolve;
    });
    const remote: SyncEnvelope<LearningSyncSnapshot> = {
      revision: 1,
      updatedAt: NOW.toISOString(),
      snapshot: {
        backup: { version: 1, freeDecks: [], sessions: [] },
        authoritativeProgresses: [],
      },
    };
    const runtime: DaoewoRuntime = {
      ...base,
      sync: {
        availability: "cloud",
        async pull() {
          return pull;
        },
        async push(_userId, envelope) {
          return envelope;
        },
        async resolveFreeCardSnapshots() {
          return [];
        },
      },
    };
    await saveSettingsState(runtime.storage, USER.id, {
      dailyReminder: false,
      reviewReminder: true,
      deckReadyNotification: false,
      ttsEnabled: true,
      voiceGuide: false,
    });
    const renderer = await render(runtime);

    await act(async () => {
      finishPull?.(remote);
      await backgroundApplyStarted;
    });
    await act(async () => {
      renderer.root
        .findByProps({ accessibilityLabel: "복습 알림" })
        .props.onValueChange(false);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(applied).toHaveLength(2);

    await act(async () => {
      finishBackgroundApply?.();
      await flush();
      await flush();
    });

    expect(applied.at(-1)).toMatchObject({ reviewReminder: false });
    expect(
      await runtime.storage.getItem(settingsStorageKey(USER.id))
    ).toMatchObject({ reviewReminder: false });
  });

  it("다른 UID 설정을 읽지 않고 로그아웃 시 예약과 현재 UID 설정을 지운다", async () => {
    let cleared = 0;
    const runtime = availableRuntime({
      async clear() {
        cleared += 1;
      },
    });
    await saveSettingsState(runtime.storage, "other-user", {
      dailyReminder: true,
      reviewReminder: true,
      deckReadyNotification: false,
      ttsEnabled: false,
      voiceGuide: true,
    });
    const renderer = await render(runtime);

    expect(
      renderer.root.findByProps({ accessibilityLabel: "일일 학습 알림" }).props
        .value
    ).toBe(false);
    await act(async () => {
      renderer.root
        .findByProps({ accessibilityLabel: "로그아웃" })
        .props.onPress();
      await flush();
    });

    expect(cleared).toBe(1);
    expect(
      await runtime.storage.getItem(settingsStorageKey(USER.id))
    ).toBeNull();
    expect(
      await runtime.storage.getItem(settingsStorageKey("other-user"))
    ).not.toBeNull();
  });

  it("TTS를 끄면 학습 화면의 발음 버튼도 비활성화한다", async () => {
    const runtime = availableRuntime();
    await saveSettingsState(runtime.storage, USER.id, {
      dailyReminder: false,
      reviewReminder: false,
      deckReadyNotification: false,
      ttsEnabled: false,
      voiceGuide: false,
    });
    const renderer = await render(runtime, "study");

    const button = renderer.root.findByProps({
      accessibilityLabel: "카드 음성 꺼짐",
    });
    expect(button.props.accessibilityState).toMatchObject({ disabled: true });
  });

  it("TTS 미지원 runtime은 저장된 ON을 false로 보정하고 설정·학습 UI를 비활성화한다", async () => {
    const runtime = createDemoRuntime({ initialUser: USER, now: () => NOW });
    await saveSettingsState(runtime.storage, USER.id, {
      dailyReminder: false,
      reviewReminder: false,
      deckReadyNotification: false,
      ttsEnabled: true,
      voiceGuide: false,
    });

    const settings = await render(runtime);
    const ttsSwitch = settings.root.findByProps({
      accessibilityLabel: "카드 음성(TTS)",
    });
    expect(ttsSwitch.props.value).toBe(false);
    expect(ttsSwitch.props.accessibilityState).toEqual({
      checked: false,
      disabled: true,
    });
    expect(JSON.stringify(settings.toJSON())).toContain(
      "이 앱 환경에서는 카드 음성을 지원하지 않아요"
    );
    expect(
      await runtime.storage.getItem(settingsStorageKey(USER.id))
    ).toMatchObject({ ttsEnabled: false });
    await act(async () => settings.unmount());

    const study = await render(runtime, "study");
    const speakButton = study.root.findByProps({
      accessibilityLabel: "카드 음성 꺼짐",
    });
    expect(speakButton.props.accessibilityState).toMatchObject({
      disabled: true,
    });
    await act(async () => study.unmount());
  });

  it("TTS 지원 runtime과 계정 설정이 모두 ON일 때만 발음 버튼을 실행한다", async () => {
    const base = availableRuntime();
    const speak = jest.fn(async () => undefined);
    const runtime: DaoewoRuntime = {
      ...base,
      tts: {
        availability: "available",
        speak,
        async stop() {
          // 테스트에서는 재생 중인 음성이 없다.
        },
      },
    };
    await saveSettingsState(runtime.storage, USER.id, {
      dailyReminder: false,
      reviewReminder: false,
      deckReadyNotification: false,
      ttsEnabled: true,
      voiceGuide: false,
    });
    const renderer = await render(runtime, "study");

    const button = renderer.root.findByProps({
      accessibilityLabel: "◖ 발음 듣기",
    });
    expect(button.props.accessibilityState).toMatchObject({ disabled: false });
    await act(async () => button.props.onPress());
    expect(speak).toHaveBeenCalledTimes(1);
  });
});

describe("접근성 음성 안내", () => {
  it("voiceGuide가 ON이면 스와이프 결과와 세션 완료를 실제 AccessibilityInfo로 안내한다", async () => {
    jest.useFakeTimers();
    const announce = jest
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(() => undefined);
    let renderer: ReactTestRenderer | undefined;

    try {
      const base = availableRuntime();
      const content = base.content;
      const runtime: DaoewoRuntime = {
        ...base,
        content: {
          ...content,
          async getCardWindow(input) {
            const window = await content.getCardWindow(input);
            return {
              ...window,
              cards: window.cards.slice(0, 1),
              targetCount: 1,
            };
          },
        },
      };
      await saveSettingsState(runtime.storage, USER.id, {
        dailyReminder: false,
        reviewReminder: false,
        deckReadyNotification: false,
        ttsEnabled: true,
        voiceGuide: true,
      });
      renderer = await render(runtime, "study");

      await act(async () => {
        renderer!.root
          .findByProps({ accessibilityLabel: "모르겠다" })
          .props.onPress();
        jest.advanceTimersByTime(200);
        await flush();
        await flush();
      });

      expect(announce).toHaveBeenCalledWith("모르겠다로 분류했어요.");
      expect(announce).toHaveBeenCalledWith(
        "오늘 학습을 완료했어요. 바로 복습할 카드 1장이 있어요."
      );
    } finally {
      if (renderer !== undefined) {
        await act(async () => renderer?.unmount());
      }
      announce.mockRestore();
      jest.useRealTimers();
    }
  });
});

describe("학습 데이터 내보내기", () => {
  it("카드 본문과 계정 식별자 없이 deterministic JSON을 만든다", () => {
    const initial = createInitialCardProgress("card-1", "deck-1", NOW);
    const state: DaoewoLearningState = {
      version: 1,
      progresses: [classifySwipe(initial, "unknown", NOW)],
      cardSnapshots: [
        {
          id: "card-1",
          deckId: "deck-1",
          front: "내보내면 안 되는 앞면",
          back: "내보내면 안 되는 뒷면",
          tags: ["private"],
          locale: "ko",
        },
      ],
      sessions: [],
    };

    const serialized = serializeLearningDataExport(
      createLearningDataExport(state, NOW)
    );
    expect(JSON.parse(serialized)).toMatchObject({
      schema: "daoewo-learning-data",
      version: 1,
      exportedAt: NOW.toISOString(),
    });
    expect(serialized).not.toContain("내보내면 안 되는 앞면");
    expect(serialized).not.toContain("내보내면 안 되는 뒷면");
    expect(serialized).not.toContain("settings-user");
  });
});
