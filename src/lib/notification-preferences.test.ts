import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hook = vi.hoisted(() => ({
  subscribe: undefined as undefined | ((listener: () => void) => () => void),
  snapshot: undefined as undefined | (() => boolean),
  serverSnapshot: undefined as undefined | (() => boolean),
}));

vi.mock("react", () => ({
  useSyncExternalStore: (
    subscribe: (listener: () => void) => () => void,
    snapshot: () => boolean,
    serverSnapshot: () => boolean,
  ) => {
    Object.assign(hook, { subscribe, snapshot, serverSnapshot });
    return snapshot();
  },
}));

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  };
}

let local: ReturnType<typeof memoryStorage>;
let browser: EventTarget;

function storageEvent(key: string | null, storageArea: unknown = local) {
  browser.dispatchEvent(Object.assign(new Event("storage"), { key, storageArea }));
}

beforeEach(() => {
  vi.resetModules();
  local = memoryStorage();
  browser = new EventTarget();
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("window", browser);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("notification sounds preference", () => {
  it("defaults on and ignores malformed values without writing anything", async () => {
    const preference = await import("./notification-preferences");
    expect(preference.useNotificationSounds()).toBe(true);
    expect(preference.notificationSoundsEnabled()).toBe(true);
    expect(hook.serverSnapshot!()).toBe(true);
    for (const value of ["", "false", "broken", "1"]) {
      local.setItem(preference.NOTIFICATION_SOUNDS_KEY, value);
      expect(preference.useNotificationSounds()).toBe(true);
    }
    local.setItem.mockClear();
    preference.useNotificationSounds();
    expect(local.setItem).not.toHaveBeenCalled();
  });

  it("persists both choices through a renderer reload", async () => {
    let preference = await import("./notification-preferences");
    preference.setNotificationSounds(false);
    expect(local.getItem(preference.NOTIFICATION_SOUNDS_KEY)).toBe("0");
    expect(preference.useNotificationSounds()).toBe(false);
    // the non-hook read is what the notification path uses
    expect(preference.notificationSoundsEnabled()).toBe(false);

    vi.resetModules();
    preference = await import("./notification-preferences");
    expect(preference.notificationSoundsEnabled()).toBe(false);
    preference.setNotificationSounds(true);
    expect(local.getItem(preference.NOTIFICATION_SOUNDS_KEY)).toBe("1");
    vi.resetModules();
    preference = await import("./notification-preferences");
    expect(preference.useNotificationSounds()).toBe(true);
  });

  it("notifies mounted consumers immediately and unsubscribes cleanly", async () => {
    const preference = await import("./notification-preferences");
    preference.useNotificationSounds();
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = hook.subscribe!(first);
    const unsubscribeSecond = hook.subscribe!(second);
    preference.setNotificationSounds(false);
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(hook.snapshot!()).toBe(false);

    unsubscribeFirst();
    preference.setNotificationSounds(true);
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledTimes(2);
    unsubscribeSecond();
    preference.setNotificationSounds(false);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("follows cross-window changes and clear, ignoring other storage", async () => {
    const preference = await import("./notification-preferences");
    preference.useNotificationSounds();
    const listener = vi.fn();
    const unsubscribe = hook.subscribe!(listener);
    local.setItem(preference.NOTIFICATION_SOUNDS_KEY, "0");
    storageEvent(preference.NOTIFICATION_SOUNDS_KEY);
    expect(listener).toHaveBeenCalledOnce();
    expect(hook.snapshot!()).toBe(false);

    storageEvent("other-key");
    storageEvent(preference.NOTIFICATION_SOUNDS_KEY, memoryStorage());
    expect(listener).toHaveBeenCalledOnce();

    local.clear();
    storageEvent(null);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(hook.snapshot!()).toBe(true);
    unsubscribe();
    storageEvent(null);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("follows another window's choice after Settings has unmounted", async () => {
    const preference = await import("./notification-preferences");
    preference.setNotificationSounds(false);
    expect(preference.notificationSoundsEnabled()).toBe(false);
    local.setItem(preference.NOTIFICATION_SOUNDS_KEY, "1");
    expect(preference.notificationSoundsEnabled()).toBe(true);
  });

  it.each(["getter", "read", "write", "missing"])("keeps the choice usable when storage fails at %s", async (failure) => {
    if (failure === "getter") {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
    } else if (failure === "missing") {
      vi.stubGlobal("localStorage", undefined);
    } else {
      if (failure === "write") local.setItem.mockImplementation(() => { throw new Error("blocked"); });
      if (failure === "read") local.getItem.mockImplementation(() => { throw new Error("blocked"); });
    }
    const preference = await import("./notification-preferences");
    expect(preference.useNotificationSounds()).toBe(true);
    preference.setNotificationSounds(false);
    expect(preference.useNotificationSounds()).toBe(false);
    expect(preference.notificationSoundsEnabled()).toBe(false);
    preference.setNotificationSounds(true);
    expect(preference.useNotificationSounds()).toBe(true);
  });
});

describe("nudge sound preference", () => {
  it("defaults on, persists both choices, and does not touch the notification sounds", async () => {
    let preference = await import("./notification-preferences");
    expect(preference.nudgeSoundEnabled()).toBe(true);
    preference.setNudgeSound(false);
    expect(local.getItem(preference.NUDGE_SOUND_KEY)).toBe("0");
    expect(preference.useNudgeSound()).toBe(false);
    expect(preference.notificationSoundsEnabled()).toBe(true);
    vi.resetModules();
    preference = await import("./notification-preferences");
    expect(preference.nudgeSoundEnabled()).toBe(false);
    preference.setNudgeSound(true);
    expect(local.getItem(preference.NUDGE_SOUND_KEY)).toBe("1");
  });
});

describe("Settings > Notifications defaults", () => {
  it("every switch is on by default, with nothing written", async () => {
    const preference = await import("./notification-preferences");
    expect(preference.attentionSettings()).toEqual({
      sound: true, persistent: true, badge: true, nudgeSound: true, nudgeShake: true,
      bots: true, people: true, groups: true, approvals: true, routines: true,
    });
    expect(local.setItem).not.toHaveBeenCalled();
    expect(preference.useLocalSwitch(preference.persistentNotifications)).toBe(true);
    expect(hook.serverSnapshot!()).toBe(true);
  });

  it("each switch turns off on its own and is kept on this computer", async () => {
    const preference = await import("./notification-preferences");
    preference.persistentNotifications.set(false);
    preference.dockBadge.set(false);
    expect(local.getItem("omb-notification-persistent")).toBe("0");
    expect(local.getItem("omb-dock-badge")).toBe("0");
    expect(preference.attentionSettings()).toEqual({
      sound: true, persistent: false, badge: false, nudgeSound: true, nudgeShake: true,
      bots: true, people: true, groups: true, approvals: true, routines: true,
    });
    preference.nudgeShake.set(false);
    expect(preference.attentionSettings().nudgeShake).toBe(false);
    preference.nudgeShake.set(true);
    expect(preference.attentionSettings().nudgeShake).toBe(true);
    preference.notifyBots.set(false);
    expect(preference.attentionSettings().bots).toBe(false);
  });

  it("another window's change reaches the hook", async () => {
    const preference = await import("./notification-preferences");
    const listener = vi.fn();
    const stop = preference.dockBadge.subscribe(listener);
    local.setItem("omb-dock-badge", "0");
    storageEvent("omb-dock-badge");
    expect(listener).toHaveBeenCalledOnce();
    expect(preference.dockBadge.enabled()).toBe(false);
    stop();
  });

  it("blocked storage keeps the choice for this session", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    });
    const preference = await import("./notification-preferences");
    expect(preference.nudgeShake.enabled()).toBe(true);
    preference.nudgeShake.set(false);
    expect(preference.nudgeShake.enabled()).toBe(false);
  });
});
