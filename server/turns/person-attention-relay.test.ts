import { describe, expect, it } from "vitest";

import type { WireMessage, WireTask } from "../../shared/wire.ts";
import { mirrorLateRunReply, relayPersonAttention, type AttentionBot, type AttentionRelayDeps } from "./person-attention-relay.ts";

const ATLAS: AttentionBot = { id: "bot-atlas", name: "Atlas" };
const REPORT = "- [HUMAIN] **100201** (board 1) : decide which client it belongs to.\n- [HUMAIN] **100202** : set it to Completed by hand.\n\nNo writes.";

function world(opts: { run?: { id: string; routineName: string; status: string } } = {}) {
  const threads = new Map<string, WireMessage[]>();
  const tasks = new Map<string, Partial<WireTask> & { threadId: string; title: string }>();
  tasks.set("main", { threadId: "main", title: "Atlas" });
  tasks.set("work", { threadId: "work", title: "@Nova · work", openedBy: { botId: "bot-nova", name: "Nova", kind: "work", at: 1 } });
  tasks.set("run", { threadId: "run", title: "Hourly pass", routineRunId: "run-1" });
  let next = 0;
  const say = (threadId: string, text: string, turnId = "turn-1") => {
    const list = threads.get(threadId) ?? [];
    list.push({ id: `m${next++}`, at: next, role: "bot", kind: "text", text, turnId } as WireMessage);
    threads.set(threadId, list);
  };
  const notified: Array<{ threadId: string; title: string; body: string }> = [];
  const unread: string[] = [];
  const deps: AttentionRelayDeps<AttentionBot> = {
    task: (_botId, threadId) => tasks.get(threadId) as never,
    messages: (threadId) => threads.get(threadId) ?? [],
    append: (threadId, message) => {
      const list = threads.get(threadId) ?? [];
      const row = { ...message, id: `m${next++}`, at: next } as WireMessage;
      list.push(row);
      threads.set(threadId, list);
      return row;
    },
    markUnread: (_botId, threadId) => { unread.push(threadId); },
    conversation: () => "main",
    agentConversation: () => false,
    routineRun: (threadId) => threadId === "run" ? opts.run ?? null : null,
    ticketUrl: (_threadId, id) => `https://cw.example.com/v4_6_release/services/system_io/router/openrecord.rails?recordType=ServiceFv&recid=${id}`,
    notify: (_bot, threadId, title, body) => { notified.push({ threadId, title, body }); },
  };
  return { deps, say, threads, notified, unread };
}

describe("relayPersonAttention", () => {
  it("carries [HUMAIN] items from a thread another bot opened to the person's conversation, as a card", () => {
    const w = world();
    w.say("work", REPORT);
    const outcome = relayPersonAttention({ bot: ATLAS, threadId: "work", turnId: "turn-1", ok: true }, w.deps);
    expect(outcome.posted).toBe(true);
    const card = w.threads.get("main")!.at(-1)!;
    expect(card.attention).toMatchObject({
      kind: "human", botId: "bot-atlas", threadId: "work", openedBy: { botId: "bot-nova", name: "Nova" },
      items: [{ ticketId: 100201 }, { ticketId: 100202 }],
    });
    expect(card.attention?.items[0]?.ticketUrl).toContain("recid=100201");
    expect(card.threadRef).toEqual({ botId: "bot-atlas", threadId: "work", title: "@Nova · work" });
    expect(card.text).toContain("Atlas needs you");
    expect(w.unread).toEqual(["main"]);
    expect(w.notified).toEqual([{ threadId: "main", title: "Atlas needs you", body: expect.stringContaining("100201 (board 1)") }]);
  });

  it("posts one card per message, never in the person's own conversation, never for a failed turn", () => {
    const w = world();
    w.say("work", REPORT);
    relayPersonAttention({ bot: ATLAS, threadId: "work", turnId: "turn-1", ok: true }, w.deps);
    expect(relayPersonAttention({ bot: ATLAS, threadId: "work", turnId: "turn-1", ok: true }, w.deps)).toEqual({ posted: false, reason: "already" });
    w.say("main", REPORT, "turn-2");
    expect(relayPersonAttention({ bot: ATLAS, threadId: "main", turnId: "turn-2", ok: true }, w.deps)).toEqual({ posted: false, reason: "own-conversation" });
    w.say("work", REPORT, "turn-3");
    expect(relayPersonAttention({ bot: ATLAS, threadId: "work", turnId: "turn-3", ok: false }, w.deps).posted).toBe(false);
    expect(w.notified).toHaveLength(1);
  });

  it("leaves a turn without a structured signal where it is", () => {
    const w = world();
    w.say("work", "All three tickets were assigned. Nothing else.");
    expect(relayPersonAttention({ bot: ATLAS, threadId: "work", turnId: "turn-1", ok: true }, w.deps)).toEqual({ posted: false, reason: "no-signal" });
  });

  it("lets an active routine run report through its own card, and relays one whose run has ended", () => {
    const active = world({ run: { id: "run-1", routineName: "Hourly pass", status: "running" } });
    active.say("run", REPORT);
    expect(relayPersonAttention({ bot: ATLAS, threadId: "run", turnId: "turn-1", ok: true }, active.deps)).toEqual({ posted: false, reason: "run-reports" });
    const settling = world({ run: { id: "run-1", routineName: "Hourly pass", status: "completed" } });
    settling.say("run", REPORT);
    expect(relayPersonAttention({ bot: ATLAS, threadId: "run", turnId: "turn-1", ok: true, runTurn: true }, settling.deps)).toEqual({ posted: false, reason: "run-reports" });
    const ended = world({ run: { id: "run-1", routineName: "Hourly pass", status: "completed" } });
    ended.say("run", REPORT);
    const outcome = relayPersonAttention({ bot: ATLAS, threadId: "run", turnId: "turn-1", ok: true }, ended.deps);
    expect(outcome.posted && outcome.card).toMatchObject({ routineRunId: "run-1", routineName: "Hourly pass" });
  });
});

describe("mirrorLateRunReply", () => {
  it("mirrors the bot's answer in a run's task once the run has ended, once", () => {
    const w = world({ run: { id: "run-1", routineName: "Hourly pass", status: "completed" } });
    w.say("run", "Nova's result is in: the three tickets are assigned.");
    // the turn that completed the run itself: its card reports it
    expect(mirrorLateRunReply({ bot: ATLAS, threadId: "run", turnId: "turn-1", ok: true, runTurn: true }, w.deps)).toBe(false);
    expect(relayPersonAttention({ bot: ATLAS, threadId: "run", turnId: "turn-1", ok: true, runTurn: true }, w.deps).posted).toBe(false);
    expect(mirrorLateRunReply({ bot: ATLAS, threadId: "run", turnId: "turn-1", ok: true }, w.deps)).toBe(true);
    expect(mirrorLateRunReply({ bot: ATLAS, threadId: "run", turnId: "turn-1", ok: true }, w.deps)).toBe(false);
    const row = w.threads.get("main")!.at(-1)!;
    expect(row).toMatchObject({ text: "Nova's result is in: the three tickets are assigned.", threadRef: { threadId: "run" } });
    expect(w.notified).toHaveLength(1);
  });

  it("leaves an active run's task to the run, and a quiet answer unsaid", () => {
    const active = world({ run: { id: "run-1", routineName: "Hourly pass", status: "waiting" } });
    active.say("run", "Still waiting on Nova.");
    expect(mirrorLateRunReply({ bot: ATLAS, threadId: "run", turnId: "turn-1", ok: true }, active.deps)).toBe(false);
    const quiet = world({ run: { id: "run-1", routineName: "Hourly pass", status: "completed" } });
    quiet.say("run", "NOTHING_TO_REPORT");
    expect(mirrorLateRunReply({ bot: ATLAS, threadId: "run", turnId: "turn-1", ok: true }, quiet.deps)).toBe(false);
  });
});
