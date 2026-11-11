import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { failedTurnTool } from "../../shared/failed-turn.ts";
import { RESTART_TURN_NOTE } from "../../shared/restart-words.ts";
import { INTERRUPTED_OUTWARD } from "../runtime/tree.ts";
import { RUNTIME_RESUME_GRACE_MS, saveInterruptedTurns, TURN_NOT_RESUMED } from "../turns/interrupted-turns.ts";
import { ENGINE_EXITED_SENTENCE } from "../../shared/engine-exit-words.ts";
import { createResumeTurnsCutByRestart, watchDirectResumes } from "./resumeTurnsCutByRestart.ts";
import { isPersonOwnLine } from "../turns/start-turn-prepare-admit.ts";
import { buildNotification, notificationInterrupts } from "../notify.ts";

import { DATA_DIR as dataDir } from "../config.ts";

vi.mock("../config.ts", async (original) => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  return { ...(await original<Record<string, unknown>>()), DATA_DIR: mkdtempSync(join(tmpdir(), "cut-turns-")) };
});

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

// #3217: a chat turn running at a restart, on every path the start takes.
describe("resumeTurnsCutByRestart (#3217)", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100_000); });
  afterEach(() => { vi.useRealTimers(); });

  /** The conversation as the stop left it: the person's request, the bot's
   * first words, a step already done, then the stop's note. */
  function cutConversation(step: { name: string; output?: string }) {
    return [
      { id: "u1", role: "user", kind: "text", text: "Lis le réglage de sauvegarde et dis-moi sa valeur", at: 90_000 },
      { id: "b1", role: "bot", kind: "text", text: "Je lis le réglage sans rien modifier.", at: 91_000 },
      { id: "s1", role: "bot", kind: "activity", tool: { name: step.name, ok: true, itemId: "call-1", ...(step.output ? { output: step.output } : {}) }, at: 92_000 },
      { id: "n1", role: "bot", kind: "activity", tool: { name: RESTART_TURN_NOTE, ok: true }, at: 95_500 },
    ];
  }

  function bootHost(messages: any[], options: { runtimeHoldsAtBoot?: boolean; rootWaits?: boolean } = {}) {
    let holds = options.runtimeHoldsAtBoot === true;
    const host = {
      turnSpeakers: new Map<string, unknown>(),
      runtimeRootWaiting: () => options.rootWaits === true,
      routines: { takeRestartResumes: () => [] },
      coordinator: { continuesAfterRestart: () => false },
      runtimeHoldsRoot: () => holds,
      threadBusy: () => false,
      store: {
        messagesFor: () => messages,
        taskByThread: () => ({ threadId: "t1" }),
        appendMessage: (_threadId: string, message: any) => { messages.push({ ...message, at: Date.now() }); },
      },
      startTurn: vi.fn(async () => { messages.push({ role: "bot", kind: "text", text: "La valeur est 7 jours.", at: Date.now() }); }),
      resumeHeldSteersAfterCrash: vi.fn(),
      botForThread: () => ({ id: "b1" }),
      mirrorBackgroundReply: vi.fn(),
      personAttentionDeps: {},
      release: () => { holds = false; },
    };
    return host;
  }

  it("a turn the runtime held but never ran is resumed with the person's request, and its answer arrives", async () => {
    const messages = cutConversation({ name: "read_setting" });
    saveInterruptedTurns(dataDir, [{ botId: "b1", threadId: "t1", at: 95_000, runtimeHeld: true }]);
    const host = bootHost(messages, { runtimeHoldsAtBoot: true });
    createResumeTurnsCutByRestart(() => host)();
    host.release();
    await vi.advanceTimersByTimeAsync(RUNTIME_RESUME_GRACE_MS);
    expect(host.startTurn).toHaveBeenCalledTimes(1);
    const prompt = String((host.startTurn.mock.calls[0] as unknown[])[1]);
    expect(prompt).toContain("Lis le réglage de sauvegarde et dis-moi sa valeur");
    expect(prompt).toContain("read_setting");
    expect(messages.at(-1)).toMatchObject({ role: "bot", kind: "text", text: "La valeur est 7 jours." });
    await vi.advanceTimersByTimeAsync(RUNTIME_RESUME_GRACE_MS * 3);
    expect(messages.some((m) => m.tool?.name?.includes(TURN_NOT_RESUMED))).toBe(false);
    expect(host.startTurn).toHaveBeenCalledTimes(1);
  });

  it("a runtime-held turn with a speaker gets its answer from the runtime's own rerun, as that person", async () => {
    const messages = cutConversation({ name: "read_setting" });
    const speaker = { origin: "person", principalId: "p1" };
    saveInterruptedTurns(dataDir, [{ botId: "b1", threadId: "t1", at: 95_000, runtimeHeld: true }]);
    const host = bootHost(messages, { runtimeHoldsAtBoot: true });
    // #3609: the thread keeps whom it speaks for (read back at start).
    host.turnSpeakers.set("t1", speaker);
    createResumeTurnsCutByRestart(() => host)();
    // The runtime's rerun (runRootTurn) speaks for turnSpeakers' entry; with
    // none the engine gate fails closed and the turn ends on a failed row.
    const rerun = host.turnSpeakers.get("t1");
    (messages as any[]).push(rerun
      ? { id: "r1", role: "bot", kind: "text", text: "La valeur est 7 jours.", at: Date.now() }
      : { id: "r1", role: "bot", kind: "activity", tool: failedTurnTool(ENGINE_EXITED_SENTENCE), at: Date.now() });
    host.release();
    expect(rerun).toEqual(speaker);
    await vi.advanceTimersByTimeAsync(RUNTIME_RESUME_GRACE_MS * 16);
    expect(messages.at(-1)).toMatchObject({ role: "bot", kind: "text", text: "La valeur est 7 jours." });
    expect(messages.some((m) => m.tool?.ok === false)).toBe(false);
    expect(host.startTurn).not.toHaveBeenCalled();
  });

  it("a held root that waits on its teammates is not run a second time on the watch's last look", async () => {
    const messages = cutConversation({ name: "read_setting" });
    saveInterruptedTurns(dataDir, [{ botId: "b1", threadId: "t1", at: 95_000, runtimeHeld: true }]);
    const host = bootHost(messages, { runtimeHoldsAtBoot: true, rootWaits: true });
    createResumeTurnsCutByRestart(() => host)();
    await vi.advanceTimersByTimeAsync(RUNTIME_RESUME_GRACE_MS * 20);
    expect(host.startTurn).not.toHaveBeenCalled();
    expect(messages.some((m) => m.tool?.ok === false)).toBe(false);
  });

  it("a direct cut turn resumes at once with the request it answers and the steps already done", async () => {
    const messages = cutConversation({ name: "read_setting" });
    saveInterruptedTurns(dataDir, [{ botId: "b1", threadId: "t1", at: 95_000 }]);
    const host = bootHost(messages);
    host.turnSpeakers.set("t1", { origin: "person", principalId: "p1" });
    createResumeTurnsCutByRestart(() => host)();
    expect(host.startTurn).toHaveBeenCalledTimes(1);
    // #3609: as the person its thread keeps
    expect((host.startTurn.mock.calls[0] as unknown[])[2]).toMatchObject({ speaker: { origin: "person", principalId: "p1" } });
    const prompt = String((host.startTurn.mock.calls[0] as unknown[])[1]);
    expect(prompt).toContain("Lis le réglage de sauvegarde et dis-moi sa valeur");
    expect(prompt).toContain("Steps that turn already completed");
    expect(prompt).toContain("read_setting");
    expect(messages.filter((m) => m.tool?.name === "Resuming after a restart")).toHaveLength(1);
  });

  it("a cut turn that already sent something is not run again and says what it did", async () => {
    const messages = cutConversation({ name: "GMAIL_SEND_EMAIL" });
    saveInterruptedTurns(dataDir, [{ botId: "b1", threadId: "t1", at: 95_000 }]);
    const host = bootHost(messages);
    createResumeTurnsCutByRestart(() => host)();
    await vi.advanceTimersByTimeAsync(RUNTIME_RESUME_GRACE_MS * 3);
    expect(host.startTurn).not.toHaveBeenCalled();
    const lines = messages.filter((m) => m.tool?.ok === false).map((m) => String(m.tool!.name));
    expect(lines).toEqual([failedTurnTool(lines[0].slice("error: ".length)).name]);
    expect(lines[0]).toContain(INTERRUPTED_OUTWARD);
    expect(lines[0]).toContain("GMAIL_SEND_EMAIL");
  });
});

// #3719: a restart announces nothing. The turn a restart cut and the boot
// resumes is never the person's own line, so its end or failure is silent
// (in the chat and the badge, no sound, no banner, no push).
describe("a resumed turn after a restart interrupts nobody (#3719)", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100_000); });
  afterEach(() => { vi.useRealTimers(); });

  it("the boot's resume is not the person's line, so its done and its failure are silent", async () => {
    const messages = [
      { id: "u1", role: "user", kind: "text", text: "Lis le réglage", at: 90_000 },
      { id: "n1", role: "bot", kind: "activity", tool: { name: RESTART_TURN_NOTE, ok: true }, at: 95_500 },
    ];
    saveInterruptedTurns(dataDir, [{ botId: "b1", threadId: "t1", at: 95_000 }]);
    const startTurn = vi.fn(async () => {});
    const host = {
      turnSpeakers: new Map<string, unknown>([["t1", { origin: "person", principalId: "p1" }]]),
      runtimeRootWaiting: () => false,
      routines: { takeRestartResumes: () => [] },
      coordinator: { continuesAfterRestart: () => false },
      runtimeHoldsRoot: () => false,
      threadBusy: () => false,
      store: { messagesFor: () => messages, taskByThread: () => ({ threadId: "t1" }), appendMessage: (_t: string, m: any) => { messages.push({ ...m, at: Date.now() }); } },
      startTurn,
      resumeHeldSteersAfterCrash: vi.fn(),
      botForThread: () => ({ id: "b1" }),
      mirrorBackgroundReply: vi.fn(),
      personAttentionDeps: {},
    };
    createResumeTurnsCutByRestart(() => host)();
    expect(startTurn).toHaveBeenCalledTimes(1);
    const opts = (startTurn.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    const personLine = isPersonOwnLine({ opts, userMessage: {} }, () => false);
    expect(personLine).toBe(false);
    const bot = { id: "b1", name: "Nova", threadId: "t1" };
    for (const kind of ["done", "turn-failed"] as const) {
      const note = buildNotification(kind, bot, "t1", "La valeur est 7 jours.", { personTurn: personLine });
      expect(notificationInterrupts(note!)).toBe(false);
    }
  });
});
