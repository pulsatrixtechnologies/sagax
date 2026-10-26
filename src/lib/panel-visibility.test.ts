import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function memory() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

let store: ReturnType<typeof memory>;
beforeEach(() => {
  vi.resetModules();
  store = memory();
  vi.stubGlobal("localStorage", store);
});
afterEach(() => vi.unstubAllGlobals());

const load = () => import("./panel-visibility");

describe("Suggestions card preference", () => {
  it("is shown until hidden, then hidden for every bot", async () => {
    const m = await load();
    m.migrateSuggestionsChoice();
    expect(store.getItem(m.SHOW_SUGGESTIONS_KEY)).toBeNull();
    m.setShowSuggestions(false);
    expect(store.getItem(m.SHOW_SUGGESTIONS_KEY)).toBe("0");
    m.setShowSuggestions(true);
    expect(store.getItem(m.SHOW_SUGGESTIONS_KEY)).toBe("1");
  });

  it("migrates: any bot with suggestions hidden makes the global preference hidden", async () => {
    store.setItem("sagax.botSuggestions.hidden.v1", JSON.stringify({ b1: [], b2: ["setup:soul"] }));
    const m = await load();
    expect(m.legacyHiddenForAnyBot()).toBe(true);
    m.migrateSuggestionsChoice();
    expect(store.getItem(m.SHOW_SUGGESTIONS_KEY)).toBe("0");
  });

  it("does not override a choice already made, and ignores broken or empty legacy values", async () => {
    const m = await load();
    store.setItem("sagax.botSuggestions.hidden.v1", JSON.stringify({ b1: ["x"] }));
    store.setItem(m.SHOW_SUGGESTIONS_KEY, "1");
    m.migrateSuggestionsChoice();
    expect(store.getItem(m.SHOW_SUGGESTIONS_KEY)).toBe("1");
    for (const value of ["not json", "[]", "{}", JSON.stringify({ b1: [] })]) {
      store.setItem("sagax.botSuggestions.hidden.v1", value);
      expect(m.legacyHiddenForAnyBot()).toBe(false);
    }
  });
});

describe("All history row preference", () => {
  it("is hidden by default and follows the switch", async () => {
    const m = await load();
    expect(store.getItem(m.SHOW_ALL_HISTORY_KEY)).toBeNull();
    m.setShowAllHistory(true);
    expect(store.getItem(m.SHOW_ALL_HISTORY_KEY)).toBe("1");
    m.setShowAllHistory(false);
    expect(store.getItem(m.SHOW_ALL_HISTORY_KEY)).toBe("0");
  });

  it("both keys travel with the person's preferences", async () => {
    const { isUserPreferenceKey } = await import("../../shared/user-preferences");
    const m = await load();
    expect(isUserPreferenceKey(m.SHOW_SUGGESTIONS_KEY)).toBe(true);
    expect(isUserPreferenceKey(m.SHOW_ALL_HISTORY_KEY)).toBe(true);
  });
});

describe("history request from the palette", () => {
  it("reaches the mounted panel of that bot once, and waits for one not mounted yet", async () => {
    const m = await load();
    const seen = vi.fn();
    const stop = m.watchBotHistoryRequests("b1", seen);
    m.requestBotHistory("b2");
    expect(seen).not.toHaveBeenCalled();
    m.requestBotHistory("b1");
    expect(seen).toHaveBeenCalledTimes(1);
    stop();
    m.requestBotHistory("b3");
    const late = vi.fn();
    const stopLate = m.watchBotHistoryRequests("b3", late);
    expect(late).toHaveBeenCalledTimes(1);
    stopLate();
  });
});
