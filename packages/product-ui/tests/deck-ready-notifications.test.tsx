import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { DaoewoApp } from "../src/DaoewoApp";
import {
  parseSettingsState,
  saveSettingsState,
  settingsStorageKey,
  type DaoewoSettingsState,
} from "../src/product-state";
import {
  createDemoRuntime,
  createUnsupportedDaoewoDeckReadyNotifications,
  type DaoewoDeckReadyNotificationAvailability,
  type DaoewoRuntime,
} from "../src/runtime";

const USER = {
  id: "deck-ready-user",
  displayName: "덱 알림 사용자",
  isGuest: false,
} as const;

const ENABLED_SETTINGS: DaoewoSettingsState = {
  dailyReminder: false,
  reviewReminder: false,
  deckReadyNotification: true,
  ttsEnabled: true,
  voiceGuide: false,
};

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function render(
  runtime: DaoewoRuntime,
  initialScreen: "settings" | "deck-request" = "settings"
): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(
      <DaoewoApp initialScreen={initialScreen} runtime={runtime} />
    );
    await flush();
  });
  return renderer!;
}

function deckReadyRuntime(input?: {
  readonly availability?: DaoewoDeckReadyNotificationAvailability;
  readonly getAvailability?: () => DaoewoDeckReadyNotificationAvailability;
  readonly setEnabled?: (enabled: boolean) => Promise<void>;
  readonly clear?: () => Promise<void>;
  readonly subscribeTransportDisabled?: (listener: () => void) => () => void;
  readonly subscribeAvailabilityChanged?: (listener: () => void) => () => void;
}): DaoewoRuntime {
  const base = createDemoRuntime({ initialUser: USER });
  return {
    ...base,
    tts: {
      ...base.tts,
      availability: "available",
    },
    deckReadyNotifications: {
      get availability() {
        return input?.getAvailability?.() ?? input?.availability ?? "available";
      },
      setEnabled: input?.setEnabled ?? (async () => undefined),
      clear: input?.clear ?? (async () => undefined),
      ...(input?.subscribeTransportDisabled === undefined
        ? {}
        : {
            subscribeTransportDisabled: input.subscribeTransportDisabled,
          }),
      ...(input?.subscribeAvailabilityChanged === undefined
        ? {}
        : {
            subscribeAvailabilityChanged: input.subscribeAvailabilityChanged,
          }),
    },
  };
}

async function toggle(
  renderer: ReactTestRenderer,
  value: boolean
): Promise<void> {
  await act(async () => {
    renderer.root
      .findByProps({ accessibilityLabel: "신규·요청 덱 알림" })
      .props.onValueChange(value);
    await flush();
  });
}

async function submitDeckRequest(
  renderer: ReactTestRenderer,
  topic: string
): Promise<void> {
  await act(async () => {
    renderer.root
      .findByProps({ accessibilityLabel: "외우고 싶은 주제" })
      .props.onChangeText(topic);
  });
  await act(async () => {
    await renderer.root
      .findByProps({ accessibilityLabel: "요청 보내기" })
      .props.onPress();
    await flush();
  });
}

describe("신규·요청 덱 알림 설정", () => {
  it("기존 설정은 덱 준비 알림을 false로 파싱하고 명시 값만 보존한다", () => {
    expect(
      parseSettingsState({
        dailyReminder: true,
        reviewReminder: false,
        ttsEnabled: true,
        voiceGuide: false,
      }).deckReadyNotification
    ).toBe(false);
    expect(
      parseSettingsState({
        ...ENABLED_SETTINGS,
        deckReadyNotification: true,
      }).deckReadyNotification
    ).toBe(true);
  });

  it("demo helper는 unsupported이며 ON 요청을 fail-closed한다", async () => {
    const notifications = createUnsupportedDaoewoDeckReadyNotifications();

    expect(notifications.availability).toBe("unsupported");
    await expect(notifications.setEnabled(true)).rejects.toThrow(
      "DECK_READY_NOTIFICATIONS_UNSUPPORTED"
    );
    await expect(notifications.setEnabled(false)).resolves.toBeUndefined();
    await expect(notifications.clear()).resolves.toBeUndefined();
  });

  it("unsupported 상태에서는 저장된 true를 false로 정리하고 switch를 비활성화한다", async () => {
    const setEnabled = jest.fn(async (_enabled: boolean) => undefined);
    const runtime = deckReadyRuntime({
      availability: "unsupported",
      setEnabled,
    });
    await saveSettingsState(runtime.storage, USER.id, ENABLED_SETTINGS);

    const renderer = await render(runtime);
    const switchControl = renderer.root.findByProps({
      accessibilityLabel: "신규·요청 덱 알림",
    });

    expect(switchControl.props.value).toBe(false);
    expect(switchControl.props.accessibilityState).toEqual({
      checked: false,
      disabled: true,
    });
    expect(JSON.stringify(renderer.toJSON())).toContain(
      "이 앱 환경에서는 신규·요청 덱 알림을 지원하지 않아요"
    );
    expect(setEnabled).toHaveBeenCalledTimes(1);
    expect(setEnabled).toHaveBeenCalledWith(false);
    expect(
      await runtime.storage.getItem<DaoewoSettingsState>(
        settingsStorageKey(USER.id)
      )
    ).toMatchObject({ deckReadyNotification: false });
  });

  it("disabled-by-config는 adapter만 정리하고 저장된 사용자 opt-in은 보존한다", async () => {
    const setEnabled = jest.fn(async (_enabled: boolean) => undefined);
    const runtime = deckReadyRuntime({
      availability: "disabled-by-config",
      setEnabled,
    });
    await saveSettingsState(runtime.storage, USER.id, ENABLED_SETTINGS);

    const renderer = await render(runtime);
    const switchControl = renderer.root.findByProps({
      accessibilityLabel: "신규·요청 덱 알림",
    });

    expect(switchControl.props.value).toBe(true);
    expect(switchControl.props.accessibilityState).toEqual({
      checked: true,
      disabled: true,
    });
    expect(JSON.stringify(renderer.toJSON())).toContain(
      "현재 운영 설정에서 신규·요청 덱 알림을 제공하지 않아요"
    );
    expect(setEnabled).toHaveBeenCalledTimes(1);
    expect(setEnabled).toHaveBeenCalledWith(false);
    expect(
      await runtime.storage.getItem<DaoewoSettingsState>(
        settingsStorageKey(USER.id)
      )
    ).toMatchObject({ deckReadyNotification: true });
  });

  it("resolving에서 RC false가 확정돼도 저장된 opt-in을 유지한다", async () => {
    let availability: DaoewoDeckReadyNotificationAvailability = "resolving";
    const enabled: boolean[] = [];
    const runtime = deckReadyRuntime({
      getAvailability: () => availability,
      async setEnabled(value) {
        enabled.push(value);
        if (value) {
          availability = "disabled-by-config";
          throw new Error("remote config disabled");
        }
      },
    });
    await saveSettingsState(runtime.storage, USER.id, ENABLED_SETTINGS);

    const renderer = await render(runtime);
    const switchControl = renderer.root.findByProps({
      accessibilityLabel: "신규·요청 덱 알림",
    });

    expect(enabled).toEqual([true, false]);
    expect(switchControl.props.value).toBe(true);
    expect(switchControl.props.accessibilityState).toEqual({
      checked: true,
      disabled: true,
    });
    expect(
      await runtime.storage.getItem<DaoewoSettingsState>(
        settingsStorageKey(USER.id)
      )
    ).toMatchObject({ deckReadyNotification: true });
  });

  it("저장된 OFF에서는 RC 판정을 기다리지 않고 final availability를 구독해 갱신한다", async () => {
    let availability: DaoewoDeckReadyNotificationAvailability = "resolving";
    let availabilityChanged: (() => void) | undefined;
    const runtime = deckReadyRuntime({
      getAvailability: () => availability,
      subscribeAvailabilityChanged(listener) {
        availabilityChanged = listener;
        return () => {
          availabilityChanged = undefined;
        };
      },
    });
    const renderer = await render(runtime);

    expect(JSON.stringify(renderer.toJSON())).toContain(
      "신규·요청 덱 알림 사용 가능 여부를 확인하고 있어요"
    );

    await act(async () => {
      availability = "disabled-by-config";
      availabilityChanged?.();
      await flush();
    });

    expect(JSON.stringify(renderer.toJSON())).toContain(
      "현재 운영 설정에서 신규·요청 덱 알림을 제공하지 않아요"
    );
  });

  it("transport 재시도 소진 event는 저장 설정과 switch를 false로 수렴시킨다", async () => {
    let transportDisabledListener: (() => void) | undefined;
    const runtime = deckReadyRuntime({
      subscribeTransportDisabled(listener) {
        transportDisabledListener = listener;
        return () => {
          transportDisabledListener = undefined;
        };
      },
    });
    await saveSettingsState(runtime.storage, USER.id, ENABLED_SETTINGS);
    const renderer = await render(runtime);

    await act(async () => {
      transportDisabledListener?.();
      await flush();
    });

    expect(
      await runtime.storage.getItem<DaoewoSettingsState>(
        settingsStorageKey(USER.id)
      )
    ).toMatchObject({ deckReadyNotification: false });
    expect(
      renderer.root.findByProps({ accessibilityLabel: "신규·요청 덱 알림" })
        .props.value
    ).toBe(false);
  });

  it("다른 UID의 opt-in을 현재 계정이 읽지 않는다", async () => {
    const setEnabled = jest.fn(async (_enabled: boolean) => undefined);
    const runtime = deckReadyRuntime({ setEnabled });
    await saveSettingsState(runtime.storage, "another-user", ENABLED_SETTINGS);

    const renderer = await render(runtime);

    expect(
      renderer.root.findByProps({ accessibilityLabel: "신규·요청 덱 알림" })
        .props.value
    ).toBe(false);
    expect(setEnabled).toHaveBeenCalledTimes(1);
    expect(setEnabled).toHaveBeenCalledWith(false);
    expect(
      await runtime.storage.getItem<DaoewoSettingsState>(
        settingsStorageKey("another-user")
      )
    ).toMatchObject({ deckReadyNotification: true });
  });

  it("로그인 사용자가 없으면 cold start에서 stale installation을 clear한다", async () => {
    const base = createDemoRuntime();
    const clear = jest.fn(async () => undefined);
    const runtime: DaoewoRuntime = {
      ...base,
      deckReadyNotifications: {
        availability: "available",
        setEnabled: jest.fn(async (_enabled: boolean) => undefined),
        clear,
      },
    };

    await render(runtime);

    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("hydrate의 늦은 enable 완료가 account epoch를 넘으면 즉시 disable한다", async () => {
    let finishEnable: (() => void) | undefined;
    const enabled: boolean[] = [];
    const runtime = deckReadyRuntime({
      async setEnabled(value) {
        enabled.push(value);
        if (value) {
          await new Promise<void>((resolve) => {
            finishEnable = resolve;
          });
        }
      },
    });
    await saveSettingsState(runtime.storage, USER.id, ENABLED_SETTINGS);
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <DaoewoApp initialScreen="settings" runtime={runtime} />
      );
      await flush();
    });
    expect(enabled).toEqual([true]);

    await act(async () => {
      renderer!.unmount();
    });
    await act(async () => {
      finishEnable?.();
      await flush();
    });

    expect(enabled).toEqual([true, false]);
  });

  it("ON은 adapter 성공 뒤에만 true를 저장한다", async () => {
    const events: string[] = [];
    const base = deckReadyRuntime({
      async setEnabled(enabled) {
        events.push(`adapter:${enabled}`);
      },
    });
    const originalStorage = base.storage;
    const runtime: DaoewoRuntime = {
      ...base,
      storage: {
        ...originalStorage,
        async setItem<T>(key: string, value: T) {
          const setting = value as Partial<DaoewoSettingsState>;
          if (key === settingsStorageKey(USER.id)) {
            events.push(`storage:${setting.deckReadyNotification}`);
          }
          await originalStorage.setItem(key, value);
        },
      },
    };
    const renderer = await render(runtime);
    events.length = 0;

    await toggle(renderer, true);

    expect(events).toEqual(["adapter:true", "storage:true"]);
    expect(
      await runtime.storage.getItem<DaoewoSettingsState>(
        settingsStorageKey(USER.id)
      )
    ).toMatchObject({ deckReadyNotification: true });
  });

  it("ON adapter 실패 시 false를 유지하고 partial enable도 정리한다", async () => {
    const enabled: boolean[] = [];
    const runtime = deckReadyRuntime({
      async setEnabled(value) {
        enabled.push(value);
        if (value) {
          throw new Error("permission denied");
        }
      },
    });
    const renderer = await render(runtime);
    enabled.length = 0;

    await toggle(renderer, true);

    expect(enabled).toEqual([true, false]);
    expect(
      await runtime.storage.getItem(settingsStorageKey(USER.id))
    ).toBeNull();
    expect(
      renderer.root.findByProps({ accessibilityLabel: "신규·요청 덱 알림" })
        .props.value
    ).toBe(false);
  });

  it("ON 저장 실패 시 adapter를 다시 끄고 erroneous true를 남기지 않는다", async () => {
    const enabled: boolean[] = [];
    const base = deckReadyRuntime({
      async setEnabled(value) {
        enabled.push(value);
      },
    });
    const originalStorage = base.storage;
    const runtime: DaoewoRuntime = {
      ...base,
      storage: {
        ...originalStorage,
        async setItem<T>(key: string, value: T) {
          const setting = value as Partial<DaoewoSettingsState>;
          if (
            key === settingsStorageKey(USER.id) &&
            setting.deckReadyNotification
          ) {
            throw new Error("disk full");
          }
          await originalStorage.setItem(key, value);
        },
      },
    };
    const renderer = await render(runtime);
    enabled.length = 0;

    await toggle(renderer, true);

    expect(enabled).toEqual([true, false]);
    expect(
      await runtime.storage.getItem(settingsStorageKey(USER.id))
    ).toBeNull();
    expect(
      renderer.root.findByProps({ accessibilityLabel: "신규·요청 덱 알림" })
        .props.value
    ).toBe(false);
  });

  it("OFF는 false 저장 뒤 disable을 시도하고 실패해도 false를 유지한다", async () => {
    const events: string[] = [];
    const base = deckReadyRuntime({
      async setEnabled(enabled) {
        events.push(`adapter:${enabled}`);
        if (!enabled) {
          throw new Error("unregister failed");
        }
      },
    });
    await saveSettingsState(base.storage, USER.id, ENABLED_SETTINGS);
    const originalStorage = base.storage;
    const runtime: DaoewoRuntime = {
      ...base,
      storage: {
        ...originalStorage,
        async setItem<T>(key: string, value: T) {
          const setting = value as Partial<DaoewoSettingsState>;
          if (key === settingsStorageKey(USER.id)) {
            events.push(`storage:${setting.deckReadyNotification}`);
          }
          await originalStorage.setItem(key, value);
        },
      },
    };
    const renderer = await render(runtime);
    events.length = 0;

    await toggle(renderer, false);

    expect(events).toEqual(["storage:false", "adapter:false"]);
    expect(
      await runtime.storage.getItem<DaoewoSettingsState>(
        settingsStorageKey(USER.id)
      )
    ).toMatchObject({ deckReadyNotification: false });
    expect(
      renderer.root.findByProps({ accessibilityLabel: "신규·요청 덱 알림" })
        .props.value
    ).toBe(false);
  });

  it("로그아웃 정리에서 deck-ready installation clear를 호출한다", async () => {
    const clear = jest.fn(async () => undefined);
    const runtime = deckReadyRuntime({ clear });
    const renderer = await render(runtime);

    await act(async () => {
      renderer.root
        .findByProps({ accessibilityLabel: "로그아웃" })
        .props.onPress();
      await flush();
    });

    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("늦은 ON과 로그아웃을 직렬화해 rollback 뒤 clear·signOut한다", async () => {
    const events: string[] = [];
    let finishEnable: (() => void) | undefined;
    const base = deckReadyRuntime({
      async setEnabled(enabled) {
        events.push(`set:${enabled}`);
        if (enabled) {
          await new Promise<void>((resolve) => {
            finishEnable = resolve;
          });
        }
      },
      async clear() {
        events.push("clear");
      },
    });
    const runtime: DaoewoRuntime = {
      ...base,
      auth: {
        ...base.auth,
        async signOut() {
          events.push("auth:signOut");
          await base.auth.signOut();
        },
      },
    };
    const renderer = await render(runtime);
    events.length = 0;

    await act(async () => {
      renderer.root
        .findByProps({ accessibilityLabel: "신규·요청 덱 알림" })
        .props.onValueChange(true);
      await Promise.resolve();
    });
    await act(async () => {
      renderer.root
        .findByProps({ accessibilityLabel: "로그아웃" })
        .props.onPress();
      await Promise.resolve();
    });
    expect(events).toEqual(["set:true"]);

    await act(async () => {
      finishEnable?.();
      await flush();
      await flush();
    });

    expect(events).toEqual(["set:true", "set:false", "clear", "auth:signOut"]);
    expect(
      await runtime.storage.getItem(settingsStorageKey(USER.id))
    ).toBeNull();
  });

  it("회원탈퇴는 인증 삭제 전에 queue를 drain하고 installation을 clear한다", async () => {
    const events: string[] = [];
    let finishEnable: (() => void) | undefined;
    const base = deckReadyRuntime({
      async setEnabled(enabled) {
        events.push(`set:${enabled}`);
        if (enabled) {
          await new Promise<void>((resolve) => {
            finishEnable = resolve;
          });
        }
      },
      async clear() {
        events.push("clear");
      },
    });
    const runtime: DaoewoRuntime = {
      ...base,
      auth: {
        ...base.auth,
        async deleteAccount() {
          events.push("auth:deleteAccount");
          await base.auth.deleteAccount();
        },
      },
    };
    const renderer = await render(runtime);
    events.length = 0;

    await act(async () => {
      await renderer.root
        .findByProps({ accessibilityLabel: "회원탈퇴" })
        .props.onPress();
      await flush();
    });
    await act(async () => {
      renderer.root
        .findByProps({ accessibilityLabel: "신규·요청 덱 알림" })
        .props.onValueChange(true);
      await Promise.resolve();
    });
    await act(async () => {
      renderer.root
        .findByProps({ accessibilityLabel: "정말 탈퇴하기" })
        .props.onPress();
      await Promise.resolve();
    });
    expect(events).toEqual(["set:true"]);

    await act(async () => {
      finishEnable?.();
      await flush();
      await flush();
    });

    expect(events).toEqual([
      "set:true",
      "set:false",
      "clear",
      "auth:deleteAccount",
    ]);
  });
});

describe("덱 요청 완료 안내", () => {
  it("capability 또는 opt-in이 없으면 알림이나 상태 화면을 약속하지 않는다", async () => {
    const runtime = createDemoRuntime({ initialUser: USER });
    const renderer = await render(runtime, "deck-request");

    await submitDeckRequest(renderer, "행정법 핵심");

    const output = JSON.stringify(renderer.toJSON());
    expect(output).toContain("덱 요청을 검토 큐에 등록했어요");
    expect(output).not.toContain("준비되면 알림으로 알려 드릴게요");
    expect(output).not.toContain("앱에서 확인");
  });

  it("available capability와 opt-in이 모두 있으면 알림을 약속한다", async () => {
    const runtime = deckReadyRuntime();
    await saveSettingsState(runtime.storage, USER.id, ENABLED_SETTINGS);
    const renderer = await render(runtime, "deck-request");

    await submitDeckRequest(renderer, "행정법 핵심");

    const output = JSON.stringify(renderer.toJSON());
    expect(output).toContain("준비되면 알림으로 알려 드릴게요");
    expect(output).not.toContain("덱 요청을 검토 큐에 등록했어요");
  });
});
