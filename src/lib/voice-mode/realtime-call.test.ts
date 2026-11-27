// Why a realtime call dropped, in plain words (0.8.29: every refused call
// socket said only "The call dropped. Try again.").
import { afterEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import { DEFAULT_VOICE_MODE_SETTINGS, type VoiceModeSettings } from "../../../shared/voice-mode";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";

import { onVoiceKeyEvent, voiceModeRealtimeUrl, voiceTextLocale, type VoiceKeyEvent } from "./api";
import { voiceKeyFallbackNote } from "./failure";
import { REALTIME_DROP_KEYS, RealtimeVoiceCall, realtimeDrop, realtimeDropText, realtimeRefusalText, realtimeStatusUrl } from "./realtime-call";

class FakeSocket {
  readyState = 0;
  binaryType = "";
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  send(): void {}
  close(): void {}
}

function call(probe?: (url: string) => Promise<number | "offline">) {
  const socket = new FakeSocket();
  const engine = new RealtimeVoiceCall({
    url: "wss://bot.example.test/api/bots/b-1/voice/realtime?language=auto&threadId=t-1",
    createSocket: () => socket as unknown as WebSocket,
    ...(probe ? { probe } : {}),
  });
  const notes: Array<{ text: string; code?: string }> = [];
  engine.on("note", (text, code) => notes.push({ text, code }));
  // the socket alone: no microphone or audio context in this test
  (engine as unknown as { connect(): void }).connect();
  const frame = (value: Record<string, unknown>) => socket.onmessage?.({ data: JSON.stringify(value) });
  const close = async (code: number, reason = "") => {
    socket.onclose?.({ code, reason });
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { engine, notes, frame, close };
}

afterEach(() => setLocale("en"));

describe("realtime call drop reasons", () => {
  it("maps the server's reason, a close code, or the status route's answer", () => {
    expect(realtimeDrop({ ended: "key", ready: true })).toBe("key");
    expect(realtimeDrop({ ended: "server", ready: true })).toBe("server");
    expect(realtimeDrop({ code: 1008, ready: false })).toBe("auth");
    expect(realtimeDrop({ code: 4003, ready: true })).toBe("auth");
    expect(realtimeDrop({ code: 1011, ready: true })).toBe("server");
    expect(realtimeDrop({ code: 1006, ready: true })).toBe("network");
    expect(realtimeDrop({ code: 1006, ready: false, status: "offline" })).toBe("network");
    expect(realtimeDrop({ code: 1006, ready: false, status: 401 })).toBe("auth");
    expect(realtimeDrop({ code: 1006, ready: false, status: 502 })).toBe("server");
    // 0.8.29: the status route answered 200 while the call socket was a 404
    expect(realtimeDrop({ code: 1006, ready: false, status: 200 })).toBe("server");
  });

  it("finds the status route beside the call socket", () => {
    expect(realtimeStatusUrl("wss://bot.example.test/api/bots/b-1/voice/realtime?language=fr")).toBe("https://bot.example.test/api/bots/b-1/voice/status");
    expect(realtimeStatusUrl("ws://127.0.0.1:5173/api/bots/b-1/voice/realtime")).toBe("http://127.0.0.1:5173/api/bots/b-1/voice/status");
    expect(realtimeStatusUrl("wss://bot.example.test/api/other")).toBeNull();
  });

  it("a socket refused before the call was ready says the server could not open it, not only 'dropped'", async () => {
    const asked: string[] = [];
    const { notes, close } = call(async (url) => { asked.push(url); return 200; });
    await close(1006);
    expect(asked).toEqual(["https://bot.example.test/api/bots/b-1/voice/status"]);
    expect(notes).toEqual([{ text: realtimeDropText("server"), code: "dropped_server" }]);
    expect(notes[0]!.text).not.toMatch(/call dropped/i);
  });

  it("a refused sign-in says so", async () => {
    const { notes, close } = call(async () => 401);
    await close(1006);
    expect(notes).toEqual([{ text: realtimeDropText("auth"), code: "dropped_auth" }]);
  });

  it("no network says so", async () => {
    const { notes, close } = call(async () => "offline");
    await close(1006);
    expect(notes[0]!.code).toBe("dropped_network");
  });

  it("a live call the network cut says so without asking the server", async () => {
    let asked = 0;
    const { notes, frame, close } = call(async () => { asked++; return 200; });
    frame({ type: "ready", sampleRate: 24_000 });
    await close(1006);
    expect(asked).toBe(0);
    expect(notes).toEqual([{ text: realtimeDropText("network"), code: "dropped_network" }]);
  });

  it("the voice refusing the key mid call says to fix the key", () => {
    const { notes, frame } = call();
    frame({ type: "ready", sampleRate: 24_000 });
    frame({ type: "ended", by: "upstream", reason: "key" });
    expect(notes).toEqual([{ text: realtimeDropText("key"), code: "dropped_key" }]);
  });

  // #5220: when the refusal only reaches the client as the socket closing on a
  // reason code (the refused frame did not arrive in time), the client has no
  // sentence to pass through. It must not invent its own hardcoded English
  // voice text that pretends to know the cause; it shows the neutral server
  // line instead. This is the socket path that used to force English on a
  // French person for realtime_voice_unknown.
  it("a socket that closed on a refusal code invents no client text of its own", async () => {
    const { notes, close } = call();
    await close(4000, "realtime_voice_unknown");
    expect(notes).toEqual([{ text: realtimeDropText("server"), code: "realtime_voice_unknown" }]);
    expect(notes[0]!.text).not.toMatch(/does not know that voice|ne connaît pas cette voix/i);
  });

  // #5220: the server already writes the refusal in the person's own language.
  // The client knows nothing of that language, so it must render exactly the
  // words it received, for every refusal code. These tests read the sentence
  // the person actually gets (the emitted note), not the internal code.
  it("a French person reads a refused voice name in French", () => {
    const words = "Aucun appel : xAI ne connaît pas cette voix. Recharge la liste des voix et choisis-en une autre.";
    const { notes, frame } = call();
    frame({ type: "refused", code: "realtime_voice_unknown", error: words });
    expect(notes).toEqual([{ text: words, code: "realtime_voice_unknown" }]);
    // the client never lays its own English over the server's French
    expect(notes[0]!.text).not.toMatch(/does not know that voice/i);
  });

  it("an English person reads a refused voice name in English", () => {
    const words = "No call was placed: xAI does not know that voice. Refresh the voice list and choose a voice again.";
    const { notes, frame } = call();
    frame({ type: "refused", code: "realtime_voice_unknown", error: words });
    expect(notes).toEqual([{ text: words, code: "realtime_voice_unknown" }]);
  });

  it("a credits refusal reaches the person as credits, never as the voice or the network", () => {
    const words = "Aucun appel : ton compte Grok connecté n'a plus de crédits. Ajoute du crédit au compte Grok connecté, puis rappelle. La clé xAI de ton organisation n'a plus de crédits.";
    const { notes, frame } = call();
    frame({ type: "refused", code: "realtime_key_refused", error: words });
    expect(notes).toEqual([{ text: words, code: "realtime_key_refused" }]);
    expect(notes[0]!.text).not.toMatch(/service did not answer|ne connaît pas cette voix/i);
  });

  it("renders the server's own sentence unchanged for every refusal code", () => {
    // a refused key, an unreachable service, a missing setup: whatever the
    // server wrote, in the person's language, is exactly what shows
    expect(realtimeRefusalText("Aucun appel : la clé xAI a été refusée. Régle-la dans Réglages > Voix."))
      .toBe("Aucun appel : la clé xAI a été refusée. Régle-la dans Réglages > Voix.");
    expect(realtimeRefusalText("Le service de voix n'a pas répondu. Rappelez dans un instant."))
      .toBe("Le service de voix n'a pas répondu. Rappelez dans un instant.");
    expect(realtimeRefusalText("No realtime voice is set up. Add an xAI key in Settings > Voice."))
      .toBe("No realtime voice is set up. Add an xAI key in Settings > Voice.");
  });

  // #5222: the four close lines are the only voice failure text the client
  // writes. They come out of the catalog, so they read in the person's
  // language like everything else, and no French line carries an English menu
  // path. Read as the person sees them: the emitted note.
  it("each close line reads in French and in English, from the catalog", async () => {
    for (const drop of ["auth", "key", "network", "server"] as const) {
      const key = REALTIME_DROP_KEYS[drop];
      expect(en, key).toHaveProperty(key);
      expect(fr, key).toHaveProperty(key);
      expect(realtimeDropText(drop)).toBe(en[key as keyof typeof en]);
      setLocale("fr");
      const said = realtimeDropText(drop);
      expect(said).toBe(fr[key as keyof typeof fr]);
      // no English menu path inside the French sentence
      expect(said, key).not.toMatch(/Settings|Providers|Voice|Models/i);
      setLocale("en");
    }
  });

  it("a French person whose socket fell reads the French close line", async () => {
    setLocale("fr");
    const { notes, close } = call(async () => "offline");
    await close(1006);
    expect(notes).toEqual([{ text: fr["voiceMode.drop.network" as keyof typeof fr] as string, code: "dropped_network" }]);
    expect(notes[0]!.text).not.toMatch(/connection|network/i);
  });

  it("a French person whose server never opened the call reads the French server line", async () => {
    setLocale("fr");
    const { notes, close } = call(async () => 200);
    await close(1006);
    expect(notes[0]).toEqual({ text: fr["voiceMode.drop.server" as keyof typeof fr] as string, code: "dropped_server" });
  });

  it("a call that went on over another key says which key was refused and why, as the other voice sockets do", () => {
    const told: VoiceKeyEvent[] = [];
    const off = onVoiceKeyEvent((event) => told.push(event));
    try {
      const { notes, frame } = call();
      frame({ type: "ready", sampleRate: 24_000, key: { source: "org-key", last4: "t6Yb" }, skipped: [{ source: "perspicax-key", last4: "c0Je", failure: "quota" }] });
      expect(told).toEqual([{ used: { source: "org-key", last4: "t6Yb" }, skipped: [{ source: "perspicax-key", last4: "c0Je", failure: "quota" }] }]);
      // the pill's own sentence: the key refused, why, the key that serves now
      const said = voiceKeyFallbackNote(told[0]!, (key, params) => `${key} ${JSON.stringify(params ?? {})}`);
      expect(said).toContain("voiceMode.keyFallback");
      expect(said).toContain("voiceMode.keyRefused.quota");
      // it is a notice, never a failure of the call
      expect(notes).toEqual([]);
      // a call that opened on its first key, or one the server has nothing new to say about, says nothing
      const quiet = call();
      quiet.frame({ type: "ready", sampleRate: 24_000, key: { source: "org-key", last4: "t6Yb" } });
      quiet.frame({ type: "ready", sampleRate: 24_000 });
      expect(told).toHaveLength(1);
    } finally {
      off();
    }
  });

  it("a hang-up by the person or the bot is no drop", () => {
    const { notes, frame } = call();
    frame({ type: "ready", sampleRate: 24_000 });
    frame({ type: "ended", by: "person" });
    expect(notes).toEqual([]);
  });

  // #5222 review: the two language notions stay separate on the call socket.
  // `language=` carries the SPOKEN voice language (the voice setting); the text
  // the server writes is chosen from `locale=`, which the client takes from the
  // app's own language (`voiceTextLocale` = the active catalog locale, src/lib/
  // i18n), never from navigator.language. A French app with an English voice
  // still reads a French reason.
  it("a realtime call sends the app language as locale=, apart from the spoken language=", () => {
    setLocale("fr");
    const englishVoice = { ...DEFAULT_VOICE_MODE_SETTINGS, language: "en", forBot: "b-1" } as unknown as VoiceModeSettings;
    const url = new URL(voiceModeRealtimeUrl("b-1", englishVoice, undefined, "http://localhost"));
    // the spoken voice stays English
    expect(url.searchParams.get("language")).toBe("en");
    // the text language follows the app, not the OS
    expect(url.searchParams.get("locale")).toBe(voiceTextLocale());
    expect(url.searchParams.get("locale")).toBe("fr");
    setLocale("en");
    const frenchVoice = { ...DEFAULT_VOICE_MODE_SETTINGS, language: "fr", forBot: "b-1" } as unknown as VoiceModeSettings;
    const back = new URL(voiceModeRealtimeUrl("b-1", frenchVoice, undefined, "http://localhost"));
    expect(back.searchParams.get("language")).toBe("fr");
    expect(back.searchParams.get("locale")).toBe("en");
  });
});
