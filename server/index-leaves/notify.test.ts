import { describe, expect, it } from "vitest";

import { createNotify } from "./notify.ts";

/** #3480: what a bot in quiet mode rings. */
function world(quiet: boolean) {
  const sent: Array<Record<string, unknown>> = [];
  const host = {
    store: { isConfidentialThread: () => false },
    notificationInHiddenThread: () => false,
    notificationIsInterBotChatter: () => false,
    notificationInAgentConversation: () => false,
    notificationQuietOnPhones: () => false,
    lastPersonMessage: () => undefined,
    voiceCalls: { active: () => false },
    QUIET_TURN_NEWS: new Set<string>(),
    quietTurnThreads: new Set<string>(),
    botQuietMode: (botId: string) => quiet && botId === "nova",
    broadcast: (frame: { notification: Record<string, unknown> }) => { sent.push(frame.notification); },
  };
  const notify = createNotify(() => host);
  const frame = (kind: string, extra: Record<string, unknown> = {}) => ({ kind, botId: "nova", botName: "Nova", threadId: "main", title: "t", body: "b", ...extra });
  return { notify, sent, frame };
}

describe("notify and quiet mode (#3480)", () => {
  it("a run's result, a problem and a wake ring nothing", () => {
    const { notify, sent, frame } = world(true);
    notify(frame("done", { routineRunId: "r1" }));
    notify(frame("routine-failed"));
    notify(frame("routine-deferred"));
    notify(frame("incident"));
    notify(frame("proposal"));
    notify(frame("delegation-settled"));
    expect(sent).toEqual([]);
  });

  it("a question or an approval keeps its frame, without a sound", () => {
    const { notify, sent, frame } = world(true);
    notify(frame("question"));
    notify(frame("approval"));
    expect(sent.map((note) => [note.kind, note.notify])).toEqual([["question", false], ["approval", false]]);
  });

  it("another bot, or quiet mode off, rings as before", () => {
    const off = world(false);
    off.notify(off.frame("routine-failed"));
    expect(off.sent.map((note) => [note.kind, note.notify])).toEqual([["routine-failed", undefined]]);
    const other = world(true);
    other.notify({ ...other.frame("routine-failed"), botId: "atlas" });
    expect(other.sent).toHaveLength(1);
  });
});
