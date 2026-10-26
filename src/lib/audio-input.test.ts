import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUDIO_INPUT_KEY, audioInputsFrom, getUserMediaWithFallback, onPreferredAudioInputChange, openPreferredMicrophone, preferredAudioInputId, setPreferredAudioInputId, withPreferredInput } from "./audio-input";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

const stream = {} as MediaStream;
const failure = (name: string) => Object.assign(new Error(name), { name });

describe("microphone choice", () => {
  it("saves the choice on this computer and tells listeners", () => {
    const heard = vi.fn();
    const off = onPreferredAudioInputChange(heard);
    expect(preferredAudioInputId()).toBeUndefined();
    setPreferredAudioInputId("usb-mic");
    expect(store.get(AUDIO_INPUT_KEY)).toBe("usb-mic");
    expect(preferredAudioInputId()).toBe("usb-mic");
    setPreferredAudioInputId("default");
    expect(preferredAudioInputId()).toBeUndefined();
    expect(heard).toHaveBeenCalledTimes(2);
    off();
  });

  it("adds the saved device to the constraints, exact, unless one is named", () => {
    expect(withPreferredInput({ echoCancellation: true }, "usb-mic")).toEqual({ echoCancellation: true, deviceId: { exact: "usb-mic" } });
    expect(withPreferredInput({ echoCancellation: true }, undefined)).toEqual({ echoCancellation: true });
    expect(withPreferredInput({ deviceId: { exact: "other" } }, "usb-mic")).toEqual({ deviceId: { exact: "other" } });
  });

  it("falls back to the default when the saved microphone is gone, never on a refusal", async () => {
    const calls: MediaStreamConstraints[] = [];
    const gone = async (constraints: MediaStreamConstraints) => {
      calls.push(constraints);
      if ((constraints.audio as MediaTrackConstraints).deviceId) throw failure("OverconstrainedError");
      return stream;
    };
    await expect(getUserMediaWithFallback({ audio: { deviceId: { exact: "usb-mic" }, echoCancellation: true } }, gone)).resolves.toBe(stream);
    expect(calls[1]).toEqual({ audio: { echoCancellation: true } });

    const refused = vi.fn(async () => { throw failure("NotAllowedError"); });
    await expect(getUserMediaWithFallback({ audio: { deviceId: { exact: "usb-mic" } } }, refused)).rejects.toThrow("NotAllowedError");
    expect(refused).toHaveBeenCalledTimes(1);
  });

  it("opens the saved microphone for dictation, voice notes and calls", async () => {
    setPreferredAudioInputId("usb-mic");
    const opened = vi.fn(async () => stream);
    await openPreferredMicrophone({ noiseSuppression: true }, opened);
    expect(opened).toHaveBeenCalledWith({ audio: { noiseSuppression: true, deviceId: { exact: "usb-mic" } }, video: false });
  });

  it("lists audio inputs once each, without the browser's aliases", () => {
    const inputs = audioInputsFrom([
      { deviceId: "default", kind: "audioinput", label: "Default - MacBook Microphone" },
      { deviceId: "communications", kind: "audioinput", label: "Communications" },
      { deviceId: "built-in", kind: "audioinput", label: "MacBook Microphone " },
      { deviceId: "usb-mic", kind: "audioinput", label: "" },
      { deviceId: "usb-mic", kind: "audioinput", label: "" },
      { deviceId: "speakers", kind: "audiooutput", label: "Speakers" },
    ]);
    expect(inputs).toEqual([{ id: "built-in", label: "MacBook Microphone" }, { id: "usb-mic", label: "" }]);
  });
});

describe("a permission prompt that takes a while", () => {
  it("tells the person it is waiting, then still opens the microphone when allowed late", async () => {
    vi.useFakeTimers();
    try {
      let grant: (value: MediaStream) => void = () => undefined;
      const pending = new Promise<MediaStream>((resolve) => { grant = resolve; });
      const waiting = vi.fn();
      const opened = getUserMediaWithFallback({ audio: true }, () => pending, 1_000, waiting);
      await vi.advanceTimersByTimeAsync(999);
      expect(waiting).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(waiting).toHaveBeenCalledTimes(1);
      grant(stream);
      await expect(opened).resolves.toBe(stream);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says nothing when the answer comes in time, or when it is a refusal", async () => {
    vi.useFakeTimers();
    try {
      const waiting = vi.fn();
      await expect(getUserMediaWithFallback({ audio: true }, async () => stream, 1_000, waiting)).resolves.toBe(stream);
      await expect(getUserMediaWithFallback({ audio: true }, async () => { throw failure("NotAllowedError"); }, 1_000, waiting)).rejects.toThrow("NotAllowedError");
      await vi.advanceTimersByTimeAsync(5_000);
      expect(waiting).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
