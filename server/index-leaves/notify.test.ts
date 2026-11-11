import { describe, expect, it } from "vitest";

import { createNotify } from "./notify.ts";

/** #3581: quiet mode is retired: what rings is the same for every bot. */
function world() {
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
    // a host that still answered the retired switch is never read (#3480)
    botQuietMode: () => true,
    broadcast: (frame: { notification: Record<string, unknown> }) => { sent.push(frame.notification); },
  };
  const notify = createNotify(() => host);
  const frame = (kind: string, extra: Record<string, unknown> = {}) => ({ kind, botId: "nova", botName: "Nova", threadId: "main", title: "t", body: "b", ...extra });
  return { notify, sent, frame };
}

describe("notify with quiet mode retired (#3581)", () => {
  it("a run's result, a problem and a wake ring as for any bot", () => {
    const { notify, sent, frame } = world();
    notify(frame("done", { routineRunId: "r1" }));
    notify(frame("routine-failed"));
    notify(frame("incident"));
    expect(sent.map((note) => [note.kind, note.notify])).toEqual([["done", undefined], ["routine-failed", undefined], ["incident", undefined]]);
  });

  it("a question or an approval keeps its sound", () => {
    const { notify, sent, frame } = world();
    notify(frame("question"));
    notify(frame("approval"));
    expect(sent.map((note) => [note.kind, note.notify])).toEqual([["question", undefined], ["approval", undefined]]);
  });
});
