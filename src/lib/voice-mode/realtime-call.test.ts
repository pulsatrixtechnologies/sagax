// Why a realtime call dropped, in plain words (0.8.29: every refused call
// socket said only "The call dropped. Try again.").
import { describe, expect, it } from "vitest";

import { REALTIME_DROP_TEXT, RealtimeVoiceCall, realtimeDrop, realtimeStatusUrl } from "./realtime-call";

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
    expect(notes).toEqual([{ text: REALTIME_DROP_TEXT.server, code: "dropped_server" }]);
    expect(notes[0]!.text).not.toMatch(/call dropped/i);
  });

  it("a refused sign-in says so", async () => {
    const { notes, close } = call(async () => 401);
    await close(1006);
    expect(notes).toEqual([{ text: REALTIME_DROP_TEXT.auth, code: "dropped_auth" }]);
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
    expect(notes).toEqual([{ text: REALTIME_DROP_TEXT.network, code: "dropped_network" }]);
  });

  it("the voice refusing the key mid call says to fix the key", () => {
    const { notes, frame } = call();
    frame({ type: "ready", sampleRate: 24_000 });
    frame({ type: "ended", by: "upstream", reason: "key" });
    expect(notes).toEqual([{ text: REALTIME_DROP_TEXT.key, code: "dropped_key" }]);
  });

  it("a hang-up by the person or the bot is no drop", () => {
    const { notes, frame } = call();
    frame({ type: "ready", sampleRate: 24_000 });
    frame({ type: "ended", by: "person" });
    expect(notes).toEqual([]);
  });
});
