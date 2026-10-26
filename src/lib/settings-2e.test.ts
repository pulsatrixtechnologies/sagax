// Parity 2E: the local choices, the accessibility attributes, the
// notification sound plan and the desktop shell hand-over.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyAccessibility, contrastChoice, motionChoice, textSizeChoice } from "./accessibility-preferences";
import { localChoice } from "./local-choice";
import { NOTIFICATION_SOUND_CHOICES, NOTIFICATION_TONES, notificationSoundPlan, playNotificationSound } from "./notification-sound";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => { data.delete(key); },
    setItem: (key, value) => { data.set(key, String(value)); },
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a local choice", () => {
  it("reads the fallback until set, keeps what is allowed, ignores the rest", () => {
    const choice = localChoice("k.v1", ["a", "b"] as const, "a");
    expect(choice.get()).toBe("a");
    choice.set("b");
    expect(choice.get()).toBe("b");
    expect(localStorage.getItem("k.v1")).toBe("b");
    localStorage.setItem("k.v1", "zzz");
    window_storage_event(choice);
    expect(choice.get()).toBe("a");
    choice.set("nope" as "a");
    expect(localStorage.getItem("k.v1")).toBe("zzz");
  });
  it("tells a listener when a bot writes the key (applyBotPreference's storage event)", () => {
    const choice = localChoice("k2.v1", ["x", "y"] as const, "x");
    const seen = vi.fn();
    const target = new EventTarget();
    vi.stubGlobal("window", Object.assign(target, { addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target) }));
    const stop = choice.subscribe(seen);
    localStorage.setItem("k2.v1", "y");
    target.dispatchEvent(Object.assign(new Event("storage"), { key: "k2.v1", storageArea: localStorage }));
    expect(seen).toHaveBeenCalledTimes(1);
    expect(choice.get()).toBe("y");
    stop();
  });
});

function window_storage_event(choice: { subscribe(l: () => void): () => void }): void {
  // a stored value another window changed supersedes the session value
  const target = new EventTarget();
  vi.stubGlobal("window", Object.assign(target, { addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target) }));
  const stop = choice.subscribe(() => {});
  target.dispatchEvent(Object.assign(new Event("storage"), { key: null, storageArea: localStorage }));
  stop();
}

describe("Accessibility", () => {
  it("writes motion, contrast and text size on the root, and clears them on the defaults", () => {
    const attributes = new Map<string, string>();
    const root = { setAttribute: (name: string, value: string) => attributes.set(name, value), removeAttribute: (name: string) => attributes.delete(name) } as unknown as HTMLElement;
    motionChoice.set("reduce");
    contrastChoice.set("high");
    textSizeChoice.set("xlarge");
    applyAccessibility(root);
    expect(Object.fromEntries(attributes)).toEqual({ "data-reduced-motion": "true", "data-contrast": "high", "data-text-size": "xlarge" });
    motionChoice.set("system");
    contrastChoice.set("system");
    textSizeChoice.set("default");
    applyAccessibility(root);
    expect(attributes.size).toBe(0);
  });
});

describe("Notification sound", () => {
  it("has a tone for every choice but the system's", () => {
    for (const id of NOTIFICATION_SOUND_CHOICES) if (id !== "system") expect(NOTIFICATION_TONES[id].length, id).toBeGreaterThan(0);
    expect(Object.keys(NOTIFICATION_TONES).sort()).toEqual(NOTIFICATION_SOUND_CHOICES.filter((id) => id !== "system").sort());
  });
  it("leaves the platform sound to the system choice, mutes it for a tone, and plays nothing when sounds are off", () => {
    expect(notificationSoundPlan(true, "system")).toEqual({ platformSound: true, tone: null });
    expect(notificationSoundPlan(true, "chime-a")).toEqual({ platformSound: false, tone: "chime-a" });
    expect(notificationSoundPlan(false, "blip")).toEqual({ platformSound: false, tone: null });
  });
  it("never throws without audio, and plays no tone for the system sound", () => {
    expect(playNotificationSound("system")).toBe(false);
    expect(playNotificationSound("tick")).toBe(false);
  });
});
