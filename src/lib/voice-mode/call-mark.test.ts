// Call attribution survives the realtime migration: work carries the call
// on the server, and the remaining legacy hook keeps its ownership guards.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { spokenAnswer } from "./answer-budget";
import { markVoiceCall, type VoiceCallMarkDeps } from "./call-mark";

function fakeDeps(language?: string) {
  const ids = new Map<string, string>();
  const sessions: Array<[string, string, Record<string, unknown>]> = [];
  let alive: (() => void) | null = null;
  const stopAlive = vi.fn();
  const deps: VoiceCallMarkDeps = {
    setId: (botId, callId) => ids.set(botId, callId),
    clearId: (botId, callId) => {
      if (ids.get(botId) === callId) ids.delete(botId);
    },
    session: (botId, state, call) => sessions.push([botId, state, call]),
    keepAlive: (fn) => {
      alive = fn;
      return stopAlive;
    },
    language: () => language,
  };
  return { deps, ids, sessions, stopAlive, beat: () => alive?.() };
}

describe("markVoiceCall", () => {
  it("marks the call on the page and on the server, heartbeats it, and ends both", () => {
    const t = fakeDeps("fr");
    const end = markVoiceCall({ botId: "b1", threadId: "t1", callId: "call-1234" }, t.deps);
    expect(t.ids.get("b1")).toBe("call-1234");
    expect(t.sessions).toEqual([["b1", "start", { callId: "call-1234", threadId: "t1", language: "fr" }]]);
    t.beat();
    expect(t.sessions.at(-1)).toEqual(["b1", "alive", { callId: "call-1234", threadId: "t1", language: "fr" }]);
    end();
    expect(t.stopAlive).toHaveBeenCalledOnce();
    expect(t.sessions.at(-1)).toEqual(["b1", "end", { callId: "call-1234", threadId: "t1", language: "fr" }]);
    expect(t.ids.has("b1")).toBe(false);
  });

  it("an automatic language is not sent, and an old call's teardown never clears a newer call", () => {
    const t = fakeDeps("auto");
    const endOld = markVoiceCall({ botId: "b1", threadId: "t1", callId: "call-old-1" }, t.deps);
    expect(t.sessions[0]![2]).toEqual({ callId: "call-old-1", threadId: "t1" });
    markVoiceCall({ botId: "b1", threadId: "t1", callId: "call-new-1" }, t.deps);
    endOld();
    expect(t.ids.get("b1")).toBe("call-new-1");
  });
});

describe("the call views", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

  it("marks realtime work on its authenticated bot and thread and never restores the dictation call", () => {
    // 4cf8c3eb6: the macOS dictation/TTS call was removed on purpose.
    const view = read("../../components/CallView.tsx");
    const host = view.slice(view.indexOf("export function CallEngineHost()"), view.indexOf("export function CallOverlay"));
    expect(host).toContain("if (!realtimeCallReady(voiceMode)) return null;");
    expect(host).toContain("return <RealtimeCallEngine key={bot.id} bot={bot} />;");
    expect(host).not.toMatch(/\bLiveCallEngine\b|\bnew VoiceCall\b/);
    const overlay = view.slice(view.indexOf("export function CallOverlay"), view.indexOf("const CALL_DOCK_EXIT_MS"));
    expect(overlay).toContain("return null;");
    expect(overlay).not.toMatch(/speechStart\(|spokenReply\(|\bnew VoiceCall\b/);

    const engine = read("../../components/voice-mode/RealtimeCall.tsx");
    expect(engine).toContain("voiceModeRealtimeUrl(bot.id, readVoiceModeSettings(), bot.threadId)");
    expect(engine).toContain('engine.on("ended", () => endCall(bot.id))');
    expect(engine).toContain("engine.hangUp();");
    const route = read("../../../server/voice/voice-mode.ts");
    expect(route).toContain("const link = deps.realtime.session(target, auth, callId);");
    expect(route).toMatch(/new RealtimeCallBridge\(\{\s*callId,/);
    const server = read("../../../server/index.ts");
    const start = server.indexOf("  realtime: {");
    const end = server.indexOf("  callSession: {", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const session = server.slice(start, end);
    expect(session).toContain("acceptDirectSend({");
    expect(session).toContain("botId: target.botId, threadId, text,");
    expect(session).toContain("sender: messageSender(auth)");
    expect(session).toContain("speaker: speakerFor(auth)");
    expect(session).toMatch(/via: "call",\s*callId,\s*personPresent: true/);
    expect(session).toContain("respondToCard({ auth, threadId, requestId, behavior, callId })");

    // The remaining pipeline keeps the shared mark, bot hang-up and the
    // spoken-prefix filter: a written follow-up is never read as speech.
    // LiveCall reads as its view plus the hooks it was split into (#1383)
    const legacy = ["../../components/voice-mode/LiveCall.tsx", "../../components/voice-mode/useLiveCallEngineSession.ts",
      "../../components/voice-mode/useLiveCallEngineTurns.ts"].map(read).join("\n");
    expect(legacy).toContain("useVoiceCallMark(bot.id, bot.threadId)");
    expect(legacy).toContain("VOICE_CALL_ENDED_EVENT");
    expect(legacy).toContain('item.kind === "done" ? liveCall.replyDone(item.text)');
    const pipeline = read("./call.ts");
    const replyDone = pipeline.slice(pipeline.indexOf("  replyDone(text: string)"), pipeline.indexOf("  replyDone(text: string)") + 600);
    expect(replyDone).toContain("const kept = spokenAnswer(text).text;");
    expect(spokenAnswer("The change is saved.\n---\nWritten follow-up only.").text).toBe("The change is saved.\n");
  });
});
