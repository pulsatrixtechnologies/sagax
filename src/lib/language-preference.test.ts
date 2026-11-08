import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hook = vi.hoisted(() => ({
  subscribe: undefined as undefined | ((listener: () => void) => () => void),
  snapshot: undefined as undefined | (() => string | null),
  serverSnapshot: undefined as undefined | (() => string | null),
}));

vi.mock("react", () => ({
  useSyncExternalStore: (
    subscribe: (listener: () => void) => () => void,
    snapshot: () => string | null,
    serverSnapshot: () => string | null,
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

describe("app language preference", () => {
  it("uses the server's language until this device picks one", async () => {
    const preference = await import("./language-preference");
    expect(preference.useLanguageChoice()).toBeNull();
    expect(hook.serverSnapshot!()).toBeNull();
    expect(preference.effectiveLanguage(preference.languageChoice(), "fr")).toBe("fr");
    expect(preference.effectiveLanguage(preference.languageChoice(), undefined)).toBe("");
  });

  it("saves the choice on this device without asking the server", async () => {
    // ticket 262: the picker used to PATCH the shared server config, which a
    // chat-only person may not change. Nothing here reaches the network.
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    let preference = await import("./language-preference");
    preference.setLanguageChoice("de");
    expect(local.getItem(preference.LANGUAGE_KEY)).toBe("de");
    expect(preference.effectiveLanguage(preference.useLanguageChoice(), "fr")).toBe("de");
    expect(fetch).not.toHaveBeenCalled();

    vi.resetModules();
    preference = await import("./language-preference");
    expect(preference.languageChoice()).toBe("de");
  });

  it("keeps an explicit follow-the-system choice over the server's language", async () => {
    const preference = await import("./language-preference");
    preference.setLanguageChoice("");
    expect(preference.languageChoice()).toBe("");
    expect(preference.effectiveLanguage(preference.languageChoice(), "fr")).toBe("");
  });

  it("notifies mounted consumers and follows another window's change", async () => {
    const preference = await import("./language-preference");
    preference.useLanguageChoice();
    const listener = vi.fn();
    const unsubscribe = hook.subscribe!(listener);
    preference.setLanguageChoice("ja");
    expect(listener).toHaveBeenCalledOnce();
    expect(hook.snapshot!()).toBe("ja");

    local.setItem(preference.LANGUAGE_KEY, "es");
    storageEvent(preference.LANGUAGE_KEY);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(hook.snapshot!()).toBe("es");

    storageEvent("other-key");
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("keeps the choice for this session when storage is blocked", async () => {
    local.setItem.mockImplementation(() => { throw new Error("blocked"); });
    const preference = await import("./language-preference");
    preference.setLanguageChoice("uk");
    expect(preference.languageChoice()).toBe("uk");
  });

  describe("in the desktop app", () => {
    // Main's file (electron/desktop-language.mjs), shared by every page of
    // the app; each origin keeps its own localStorage.
    function desktop(initial: string | null = null) {
      let stored = initial;
      return {
        get: vi.fn(() => stored),
        set: vi.fn(async (language: string) => { stored = language; return language; }),
      };
    }

    it("a language chosen on the organization server's page opens the next launch screen in French", async () => {
      // Owner 2026-10-16: Français picked in Settings on the organization's
      // page (another origin, another storage); the launch screen on the
      // local page followed macOS (en-US) instead.
      const bridge = desktop();
      vi.stubGlobal("ogb", { desktopLanguage: bridge });
      const orgPage = await import("./language-preference");
      orgPage.setLanguageChoice("fr");
      expect(bridge.set).toHaveBeenCalledWith("fr");

      // Next launch: the local page, its own empty storage, same desktop.
      vi.resetModules();
      local = memoryStorage();
      vi.stubGlobal("localStorage", local);
      const localPage = await import("./language-preference");
      expect(localPage.effectiveLanguage(localPage.languageChoice(), "en")).toBe("fr");
      const { setLocale, t } = await import("./i18n");
      setLocale(localPage.effectiveLanguage(localPage.languageChoice(), undefined) || "en-US");
      expect(t("launch.continue")).toBe("Continuer");
    });

    it("the desktop's choice wins over this page's storage, which wins over the server", async () => {
      local.setItem("omb-language", "de");
      vi.stubGlobal("ogb", { desktopLanguage: desktop("es") });
      let preference = await import("./language-preference");
      expect(preference.effectiveLanguage(preference.languageChoice(), "fr")).toBe("es");

      vi.resetModules();
      vi.stubGlobal("ogb", { desktopLanguage: desktop(null) });
      preference = await import("./language-preference");
      expect(preference.effectiveLanguage(preference.languageChoice(), "fr")).toBe("de");

      vi.resetModules();
      local.clear();
      preference = await import("./language-preference");
      expect(preference.effectiveLanguage(preference.languageChoice(), "fr")).toBe("fr");
    });

    it("keeps the system choice across pages", async () => {
      const bridge = desktop("fr");
      vi.stubGlobal("ogb", { desktopLanguage: bridge });
      const preference = await import("./language-preference");
      preference.setLanguageChoice("");
      expect(bridge.set).toHaveBeenCalledWith("");
      expect(preference.languageChoice()).toBe("");
    });

    it("leaves a browser without the bridge as before", async () => {
      vi.stubGlobal("ogb", {});
      const preference = await import("./language-preference");
      expect(preference.languageChoice()).toBeNull();
      preference.setLanguageChoice("it");
      expect(local.getItem(preference.LANGUAGE_KEY)).toBe("it");
    });
  });
});
