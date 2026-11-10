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

describe("local thread visibility", () => {
  it("sends say whether this client shows one stream", async () => {
    const preference = await import("./thread-preferences");
    expect(preference.singleStreamTurnField()).toEqual({ singleStream: true });
    preference.setShowThreads(true);
    expect(preference.singleStreamTurnField()).toEqual({ singleStream: false });
  });

  it("unset means off (the single stream, 2026-10-17), without writing anything", async () => {
    const preference = await import("./thread-preferences");
    expect(local.getItem(preference.SHOW_THREADS_KEY)).toBeNull();
    expect(preference.useShowThreads()).toBe(false);
    expect(hook.serverSnapshot!()).toBe(false);
    expect(local.setItem).not.toHaveBeenCalled();
  });

  it("an explicit on stays on, and any stored value other than 1 is a recorded off", async () => {
    const preference = await import("./thread-preferences");
    for (const value of ["", "false", "broken", "0"]) {
      local.setItem(preference.SHOW_THREADS_KEY, value);
      expect(preference.useShowThreads()).toBe(false);
    }
    local.setItem(preference.SHOW_THREADS_KEY, "1");
    expect(preference.useShowThreads()).toBe(true);
    local.removeItem(preference.SHOW_THREADS_KEY);
    expect(preference.useShowThreads()).toBe(false);
    local.setItem.mockClear();
    preference.useShowThreadsChoice();
    expect(local.setItem).not.toHaveBeenCalled();
  });

  it("persists both choices through a renderer reload", async () => {
    let preference = await import("./thread-preferences");
    expect(preference.useShowThreads()).toBe(false);
    preference.setShowThreads(false);
    expect(local.getItem(preference.SHOW_THREADS_KEY)).toBe("0");
    expect(preference.useShowThreadsChoice()).toBe(false);

    vi.resetModules();
    preference = await import("./thread-preferences");
    expect(preference.useShowThreadsChoice()).toBe(false);
    preference.setShowThreads(true);
    expect(local.getItem(preference.SHOW_THREADS_KEY)).toBe("1");
    vi.resetModules();
    preference = await import("./thread-preferences");
    expect(preference.useShowThreadsChoice()).toBe(true);
  });

  it("notifies mounted consumers immediately and unsubscribes cleanly", async () => {
    const preference = await import("./thread-preferences");
    preference.useShowThreadsChoice();
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = hook.subscribe!(first);
    const unsubscribeSecond = hook.subscribe!(second);
    preference.setShowThreads(false);
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(hook.snapshot!()).toBe(false);

    unsubscribeFirst();
    preference.setShowThreads(true);
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledTimes(2);
    unsubscribeSecond();
    preference.setShowThreads(false);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("follows cross-window changes and clear, ignoring other storage", async () => {
    const preference = await import("./thread-preferences");
    preference.useShowThreadsChoice();
    const listener = vi.fn();
    const unsubscribe = hook.subscribe!(listener);
    local.setItem(preference.SHOW_THREADS_KEY, "0");
    storageEvent(preference.SHOW_THREADS_KEY);
    expect(listener).toHaveBeenCalledOnce();
    expect(hook.snapshot!()).toBe(false);

    storageEvent("other-key");
    storageEvent(preference.SHOW_THREADS_KEY, memoryStorage());
    expect(listener).toHaveBeenCalledOnce();

    local.setItem(preference.SHOW_THREADS_KEY, "1");
    storageEvent(preference.SHOW_THREADS_KEY);
    expect(hook.snapshot!()).toBe(true);
    local.clear();
    storageEvent(null);
    expect(listener).toHaveBeenCalledTimes(3);
    expect(hook.snapshot!()).toBe(false);
    unsubscribe();
    storageEvent(null);
    expect(listener).toHaveBeenCalledTimes(3);
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
    const preference = await import("./thread-preferences");
    expect(preference.useShowThreadsChoice()).toBe(false);
    preference.setShowThreads(true);
    expect(preference.useShowThreadsChoice()).toBe(true);
    preference.setShowThreads(false);
    expect(preference.useShowThreadsChoice()).toBe(false);
    preference.setShowThreads(true);
    expect(preference.useShowThreadsChoice()).toBe(true);
  });
});

describe("threads in Simple mode", () => {
  // Simple mode never hides threads the person chose; unset is the single
  // stream in both modes (docs/code/chat.md, "Single stream is the default").
  it.each([
    [true, true, true],
    [true, false, true],
    [false, true, false],
    [false, false, false],
  ])("shows threads whenever chosen, in either mode (chosen %s, advanced %s: %s)", async (chosen, advanced, shown) => {
    vi.doMock("./interface-mode", () => ({ useAdvancedMode: () => advanced }));
    const preference = await import("./thread-preferences");
    local.setItem(preference.SHOW_THREADS_KEY, chosen ? "1" : "0");
    expect(preference.useShowThreads()).toBe(shown);
    vi.doUnmock("./interface-mode");
  });

  it("leaves the stored choice alone and keeps an unset choice off in Simple mode", async () => {
    vi.doMock("./interface-mode", () => ({ useAdvancedMode: () => false }));
    const preference = await import("./thread-preferences");
    local.setItem.mockClear();
    expect(preference.useShowThreads()).toBe(false);
    expect(preference.useShowThreadsChoice()).toBe(false);
    expect(local.setItem).not.toHaveBeenCalled();
    vi.doUnmock("./interface-mode");
  });
});

// One choice, one reader: Settings > Conversation threads as a single mode
// every surface asks (the sidebar rows, the chat header, the store).
describe("conversation threads mode", () => {
  it("maps the stored switch and place onto the three modes", async () => {
    const { threadsModeOf } = await import("./thread-preferences");
    expect(threadsModeOf(false, "header")).toBe("one");
    expect(threadsModeOf(false, "sidebar")).toBe("one");
    expect(threadsModeOf(true, "header")).toBe("header");
    expect(threadsModeOf(true, "sidebar")).toBe("sidebar");
  });
});
