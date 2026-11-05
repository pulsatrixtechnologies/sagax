import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { USER_PREFERENCE_KEYS } from "../../shared/user-preferences";
import {
  MAX_FAVORITES, MODEL_FAVORITES_KEY, attachModelFavoritesServer, favoriteKey, fromServerFavorites, parseModelFavorites,
  readModelFavorites, serializeModelFavorites, toServerFavorites, toggleModelFavorite, withFavoriteToggled,
} from "./model-favorites";

describe("model favorites", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    void attachModelFavoritesServer(null);
  });

  it("follows the person on an organization server", () => {
    expect(USER_PREFERENCE_KEYS).toContain(MODEL_FAVORITES_KEY);
  });

  it("stores engine and model pairs, and reads them back as the menu's row keys", () => {
    const keys = [favoriteKey("claude", "claude-opus-5-5"), favoriteKey("openrouter", "anthropic/claude-sonnet-5")];
    const raw = serializeModelFavorites(keys);
    expect(JSON.parse(raw)).toEqual([["claude", "claude-opus-5-5"], ["openrouter", "anthropic/claude-sonnet-5"]]);
    expect(parseModelFavorites(raw)).toEqual(keys);
  });

  it("drops broken values and duplicates, and keeps the newest when there are too many", () => {
    expect(parseModelFavorites("{")).toEqual([]);
    expect(parseModelFavorites(JSON.stringify({ a: 1 }))).toEqual([]);
    expect(parseModelFavorites(JSON.stringify([["a", "b"], ["a", "b"], ["", "x"], ["a"], [1, 2]]))).toEqual([favoriteKey("a", "b")]);
    const many = Array.from({ length: MAX_FAVORITES + 5 }, (_, index) => ["e", `m${index}`]);
    const parsed = parseModelFavorites(JSON.stringify(many));
    expect(parsed).toHaveLength(MAX_FAVORITES);
    expect(parsed.at(-1)).toBe(favoriteKey("e", `m${MAX_FAVORITES + 4}`));
  });

  it("adds a model at the end and removes it on a second toggle", () => {
    const opus = favoriteKey("claude", "opus");
    const grok = favoriteKey("grok", "grok-4.7");
    expect(withFavoriteToggled([opus], grok)).toEqual([opus, grok]);
    expect(withFavoriteToggled([opus, grok], opus)).toEqual([grok]);
    expect(withFavoriteToggled([opus], "no separator")).toEqual([opus]);
  });

  it("persists a star in local storage and reads it again", () => {
    const opus = favoriteKey("claude", "opus");
    toggleModelFavorite(opus);
    expect(JSON.parse(store.get(MODEL_FAVORITES_KEY)!)).toEqual([["claude", "opus"]]);
    expect(readModelFavorites()).toEqual([opus]);
    toggleModelFavorite(opus);
    expect(readModelFavorites()).toEqual([]);
  });

  it("keeps the stars for the session when storage refuses them", () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => { throw new Error("full"); }, removeItem: () => {} });
    toggleModelFavorite(favoriteKey("claude", "opus"));
    expect(readModelFavorites()).toEqual([favoriteKey("claude", "opus")]);
  });

  // #2050: the server copy beside the person's model switches
  describe("server copy (/api/me/models favoriteModels)", () => {
    it("translates row keys to <engine>/<model> and back, a slash in the model kept", () => {
      const keys = [favoriteKey("claude", "opus"), favoriteKey("openrouter", "anthropic/claude-sonnet-5")];
      expect(toServerFavorites(keys)).toEqual(["claude/opus", "openrouter/anthropic/claude-sonnet-5"]);
      expect(fromServerFavorites(["claude/opus", "openrouter/anthropic/claude-sonnet-5", "bad", 3])).toEqual(keys);
    });

    it("takes the server's stars when it has some, and pushes every change after that", async () => {
      toggleModelFavorite(favoriteKey("grok", "fast"));
      const save = vi.fn(async () => undefined);
      await attachModelFavoritesServer({ load: async () => ["claude/opus", "claude/sonnet"], save });
      expect(readModelFavorites()).toEqual([favoriteKey("claude", "opus"), favoriteKey("claude", "sonnet")]);
      expect(save, "nothing pushed when the server's list won").not.toHaveBeenCalled();
      toggleModelFavorite(favoriteKey("grok", "fast"));
      expect(save).toHaveBeenCalledWith(["claude/opus", "claude/sonnet", "grok/fast"]);
    });

    it("pushes the local stars when the server has none, loads once, and leaves an old server alone", async () => {
      toggleModelFavorite(favoriteKey("grok", "fast"));
      const save = vi.fn(async () => undefined);
      const load = vi.fn(async () => [] as string[]);
      await attachModelFavoritesServer({ load, save });
      expect(save).toHaveBeenCalledWith(["grok/fast"]);
      await attachModelFavoritesServer({ load, save });
      expect(load, "loaded once per session").toHaveBeenCalledTimes(1);
      void attachModelFavoritesServer(null);
      // an older server answers without the field: the local stars stay
      const older = vi.fn(async () => undefined);
      await attachModelFavoritesServer({ load: async () => undefined, save: older });
      expect(readModelFavorites()).toEqual([favoriteKey("grok", "fast")]);
      expect(older).not.toHaveBeenCalled();
    });

    it("retries a failed load on the next attach and ignores a failed save", async () => {
      const save = vi.fn(async () => { throw new Error("offline"); });
      await attachModelFavoritesServer({ load: async () => { throw new Error("offline"); }, save });
      const load = vi.fn(async () => ["claude/opus"]);
      await attachModelFavoritesServer({ load, save });
      expect(load).toHaveBeenCalledTimes(1);
      expect(readModelFavorites()).toEqual([favoriteKey("claude", "opus")]);
      toggleModelFavorite(favoriteKey("claude", "opus"));
      expect(readModelFavorites()).toEqual([]);
    });
  });
});
