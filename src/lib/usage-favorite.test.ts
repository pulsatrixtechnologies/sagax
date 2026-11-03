// The starred subscription of Usage › (src/lib/usage-favorite.ts): one at a
// time, kept per person, and kept for the session when storage refuses it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { USER_PREFERENCE_KEYS } from "../../shared/user-preferences";
import { USAGE_FAVORITE_KEY, parseUsageFavorite, readUsageFavorite, toggleUsageFavorite, writeUsageFavorite } from "./usage-favorite";

describe("usage favorite", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
    writeUsageFavorite(null);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("follows the person on an organization server", () => {
    expect(USER_PREFERENCE_KEYS).toContain(USAGE_FAVORITE_KEY);
  });

  it("keeps one favorite: starring another replaces it, starring it again clears it", () => {
    toggleUsageFavorite("grok");
    expect(store.get(USAGE_FAVORITE_KEY)).toBe("grok");
    toggleUsageFavorite("codex");
    expect(readUsageFavorite()).toBe("codex");
    toggleUsageFavorite("codex");
    expect(readUsageFavorite()).toBeNull();
    expect(store.has(USAGE_FAVORITE_KEY)).toBe(false);
  });

  it("reads nothing from a blank or broken value", () => {
    expect(parseUsageFavorite(null)).toBeNull();
    expect(parseUsageFavorite("  ")).toBeNull();
    expect(parseUsageFavorite("a\u0000b")).toBeNull();
    expect(parseUsageFavorite("x".repeat(201))).toBeNull();
    expect(parseUsageFavorite(" grok ")).toBe("grok");
  });

  it("holds the star for the session when storage refuses it", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); }, removeItem: () => {} });
    toggleUsageFavorite("grok");
    expect(readUsageFavorite()).toBe("grok");
  });
});
