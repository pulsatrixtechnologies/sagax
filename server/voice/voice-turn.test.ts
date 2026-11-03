import { describe, expect, it } from "vitest";

import { VOICE_BRIEF_PREAMBLE, VOICE_CONTEXT_BYTES, VoiceTurnSessions, voiceBriefText, voiceQueuePrompt, voiceTranscript, voiceUnseenBlock } from "./voice-turn.ts";

const history = Array.from({ length: 60 }, (_, i) => ({
  id: `m${i}`,
  role: (i % 2 ? "assistant" : "user") as "user" | "assistant",
  text: `${i % 2 ? "answer" : "question"} ${i} ${"about the network ".repeat(30)}`,
}));

describe("voiceTranscript", () => {
  it("keeps the latest turns word for word and a short summary of the rest, inside the call budget", () => {
    const view = voiceTranscript(history, { excludedIds: new Set(["m59"]) });
    const bytes = view.transcript.reduce((n, m) => n + Buffer.byteLength(m.text), 0);
    expect(bytes).toBeLessThan(VOICE_CONTEXT_BYTES + 1_600);
    expect(view.transcript[0]!.text).toMatch(/^\[Earlier conversation summary/);
    expect(view.transcript.at(-1)!.id).toBe("m58");
    expect(view.representedIds).not.toContain("m0");
    expect(view.representedIds).not.toContain("m59");
  });

  it("sends a short conversation whole, with no summary", () => {
    const view = voiceTranscript(history.slice(0, 3).map((m) => ({ ...m, text: "short" })));
    expect(view.transcript.map((m) => m.id)).toEqual(["m0", "m1", "m2"]);
  });
});

describe("voiceBriefText", () => {
  it("puts the short view in front of the words", () => {
    const text = voiceBriefText([{ id: "a", role: "user", text: "hi" }, { id: "b", role: "assistant", text: "hello" }], "and now?");
    expect(text.startsWith(VOICE_BRIEF_PREAMBLE)).toBe(true);
    expect(text).toContain("User: hi\nAssistant: hello");
    expect(text.endsWith("and now?")).toBe(true);
    expect(voiceBriefText([], "alone")).toBe("alone");
  });
});

describe("VoiceTurnSessions", () => {
  const key = { callId: "call-1", instanceId: "claude", model: "claude-haiku-4-5" };

  it("starts one session per call, briefs its first spoken turn and resumes it after", () => {
    const sessions = new VoiceTurnSessions();
    // the warm: first dispatch, nothing handed
    expect(sessions.plan("t", key)).toEqual({ fresh: true, brief: true });
    sessions.dispatched("t", []);
    // the first spoken turn reuses the warm process and carries the brief
    expect(sessions.plan("t", key)).toEqual({ fresh: false, brief: true });
    sessions.dispatched("t", ["m1", "u1"], "u1");
    expect(sessions.noteSession("t", "claude", "sess-voice")).toBe(true);
    // the next turn resumes the call session
    expect(sessions.plan("t", key)).toEqual({ fresh: false, cursor: "sess-voice", brief: false });
    // another engine's session id is not the call's
    expect(sessions.noteSession("t", "grok", "other")).toBe(false);
  });

  it("names what reached the conversation since its last turn", () => {
    const sessions = new VoiceTurnSessions();
    sessions.plan("t", key);
    sessions.dispatched("t", ["u1"], "u1");
    const context = [{ id: "u0" }, { id: "u1" }, { id: "r1" }, { id: "task-result" }, { id: "u2" }];
    sessions.dispatched("t", ["r1"]);
    expect(sessions.unseen("t", context).map((m) => m.id)).toEqual(["task-result", "u2"]);
  });

  it("keeps the session for a new call on the same model, starts again on another, and forgets it at the end", () => {
    const sessions = new VoiceTurnSessions();
    sessions.plan("t", key);
    sessions.dispatched("t", ["u1"], "u1");
    sessions.noteSession("t", "claude", "sess-1");
    // a new call before a hang-up keeps the warm process and short session
    expect(sessions.plan("t", { ...key, callId: "call-2" })).toEqual({ fresh: false, cursor: "sess-1", brief: false });
    // another model starts a new one
    expect(sessions.plan("t", { ...key, callId: "call-2", model: "claude-sonnet-5" })).toEqual({ fresh: true, brief: true });
    expect(sessions.end("t")).toBe("claude");
    expect(sessions.has("t")).toBe(false);
    expect(sessions.noteSession("t", "claude", "sess-2")).toBe(false);
  });
});

describe("voiceQueuePrompt", () => {
  it("answers the newest line and keeps the earlier ones as context", () => {
    expect(voiceQueuePrompt(["only"])).toBe("only");
    const prompt = voiceQueuePrompt(["first  one", "second"]);
    expect(prompt).toContain('- "first one"');
    expect(prompt.endsWith("\n\nsecond")).toBe(true);
  });
});

describe("voiceUnseenBlock", () => {
  it("shows a task's result the call session has not seen, bounded", () => {
    expect(voiceUnseenBlock([])).toBe("");
    const block = voiceUnseenBlock([{ id: "r", role: "assistant", text: "done: ".repeat(1_000) }]);
    expect(block).toContain("Assistant: done:");
    expect(Buffer.byteLength(block)).toBeLessThan(3_000);
  });
});
