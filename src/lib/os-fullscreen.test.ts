import { describe, expect, it, vi } from "vitest";

import { readOsFullscreenBridge, setOsFullscreen, subscribeOsFullscreen } from "./os-fullscreen";

describe("readOsFullscreenBridge", () => {
  it("accepts the preload windowFullscreen surface", () => {
    const bridge = {
      set: async () => true,
      state: async () => ({ fullscreen: false }),
      onChanged: () => () => {},
    };
    expect(readOsFullscreenBridge({ windowFullscreen: bridge })).toBe(bridge);
  });

  it("rejects a missing or incomplete bridge", () => {
    expect(readOsFullscreenBridge(undefined)).toBeNull();
    expect(readOsFullscreenBridge({})).toBeNull();
    expect(readOsFullscreenBridge({ windowFullscreen: { set: async () => true } })).toBeNull();
  });
});

describe("setOsFullscreen", () => {
  it("uses Electron setFullScreen through the bridge when present", async () => {
    const set = vi.fn(async () => true);
    await setOsFullscreen(true, {
      bridge: { set, state: async () => ({ fullscreen: false }), onChanged: () => () => {} },
      document: documentStub(),
    });
    expect(set).toHaveBeenCalledWith(true);
  });

  it("falls back to the Fullscreen API in a browser build", async () => {
    const requestFullscreen = vi.fn(async () => {});
    const exitFullscreen = vi.fn(async () => {});
    const doc = documentStub({ requestFullscreen, exitFullscreen, fullscreenElement: null });
    await setOsFullscreen(true, { bridge: null, document: doc });
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    doc.fullscreenElement = doc.documentElement as never;
    await setOsFullscreen(false, { bridge: null, document: doc });
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
  });
});

describe("subscribeOsFullscreen", () => {
  it("reports Electron enter/leave-full-screen through onChanged", () => {
    const listeners = new Set<(fullscreen: boolean) => void>();
    const bridge = {
      set: async () => true,
      state: async () => ({ fullscreen: false }),
      onChanged: (cb: (fullscreen: boolean) => void) => {
        listeners.add(cb);
        return () => { listeners.delete(cb); };
      },
    };
    const seen: boolean[] = [];
    const stop = subscribeOsFullscreen((fullscreen) => { seen.push(fullscreen); }, {
      bridge,
      document: documentStub(),
    });
    for (const listener of listeners) listener(true);
    for (const listener of listeners) listener(false);
    stop();
    expect(seen).toEqual([true, false]);
  });

  it("reports document fullscreenchange when there is no bridge", () => {
    const doc = documentStub();
    const seen: boolean[] = [];
    subscribeOsFullscreen((fullscreen) => { seen.push(fullscreen); }, { bridge: null, document: doc });
    expect(seen).toEqual([false]);
    doc.fullscreenElement = doc.documentElement as never;
    doc.dispatch("fullscreenchange");
    expect(seen).toEqual([false, true]);
  });
});

function documentStub(options: {
  requestFullscreen?: () => Promise<void>;
  exitFullscreen?: () => Promise<void>;
  fullscreenElement?: Element | null;
} = {}) {
  const listeners = new Map<string, Set<() => void>>();
  const stub = {
    fullscreenElement: options.fullscreenElement ?? null as Element | null,
    exitFullscreen: options.exitFullscreen ?? (async () => {}),
    documentElement: { requestFullscreen: options.requestFullscreen ?? (async () => {}) },
    addEventListener: (name: string, fn: () => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(fn);
    },
    removeEventListener: (name: string, fn: () => void) => { listeners.get(name)?.delete(fn); },
    dispatch: (name: string) => { for (const fn of listeners.get(name) ?? []) fn(); },
  };
  return stub;
}
