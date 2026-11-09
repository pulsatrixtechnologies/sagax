import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RUNTIME_RESUME_GRACE_MS, TURN_NOT_RESUMED } from "../turns/interrupted-turns.ts";
import { watchDirectResumes } from "./resumeTurnsCutByRestart.ts";

// #3217: a chat turn the restart cut, resumed at start, that never answers.
function fakeHost(answerOn?: number) {
  const messages: any[] = [];
  const mirrored: any[] = [];
  let starts = 0;
  const host = {
    threadBusy: () => false,
    store: {
      messagesFor: () => messages,
      taskByThread: () => ({ id: "t1" }),
      appendMessage: (_threadId: string, message: any) => { messages.push({ ...message, at: Date.now() }); },
    },
    startTurn: vi.fn(async () => {
      starts += 1;
      if (starts === answerOn) messages.push({ role: "bot", kind: "text", text: "done", at: Date.now() });
    }),
    botForThread: () => ({ id: "b1" }),
    mirrorBackgroundReply: (input: any) => { mirrored.push(input); return true; },
    personAttentionDeps: {},
  };
  return { host, messages, mirrored };
}

describe("watchDirectResumes (#3217)", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10_000); });
  afterEach(() => { vi.useRealTimers(); });

  it("starts a silent resumed turn again and stops once it answers", async () => {
    const { host, messages, mirrored } = fakeHost(1);
    const failed = vi.fn();
    watchDirectResumes(host, [{ botId: "b1", threadId: "t1", at: 5_000, prompt: "resume" }], failed);
    await vi.advanceTimersByTimeAsync(RUNTIME_RESUME_GRACE_MS);
    expect(host.startTurn).toHaveBeenCalledTimes(1);
    expect(host.startTurn).toHaveBeenCalledWith("b1", "resume", expect.objectContaining({ threadId: "t1", cardContinuation: true }));
    expect(messages.filter((m) => m.tool?.name === "Resuming after a restart")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(RUNTIME_RESUME_GRACE_MS * 3);
    expect(host.startTurn).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
    expect(mirrored).toHaveLength(0);
  });

  it("says so in the thread and in the bot's chat when the relaunch is silent too", async () => {
    const { host, mirrored } = fakeHost();
    const failed = vi.fn();
    watchDirectResumes(host, [{ botId: "b1", threadId: "t1", at: 5_000, prompt: "resume" }], failed);
    await vi.advanceTimersByTimeAsync(RUNTIME_RESUME_GRACE_MS * 2);
    expect(host.startTurn).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledWith("t1", TURN_NOT_RESUMED);
    expect(mirrored).toEqual([expect.objectContaining({ threadId: "t1", ok: false })]);
    await vi.advanceTimersByTimeAsync(RUNTIME_RESUME_GRACE_MS * 3);
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it("leaves a turn that answered alone", async () => {
    const { host, messages } = fakeHost();
    messages.push({ role: "bot", kind: "text", text: "back", at: 6_000 });
    const failed = vi.fn();
    watchDirectResumes(host, [{ botId: "b1", threadId: "t1", at: 5_000, prompt: "resume" }], failed);
    await vi.advanceTimersByTimeAsync(RUNTIME_RESUME_GRACE_MS * 3);
    expect(host.startTurn).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
  });
});
