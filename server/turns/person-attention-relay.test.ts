import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { BriefStore, TOPIC_HALF_LIFE_MS } from "../proactive/background-brief.ts";

import type { WireMessage, WireTask } from "../../shared/wire.ts";
import { mirrorBackgroundReply, mirrorLateRunReply, relayPersonAttention, type AttentionBot, type AttentionRelayDeps } from "./person-attention-relay.ts";

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
    patch: (threadId, messageId, patch) => {
      const list = threads.get(threadId) ?? [];
      const at = list.findIndex((row) => row.id === messageId);
      if (at >= 0) list[at] = { ...list[at]!, ...patch };
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
  it("#2694: the feedback given on an attention card quiets or stops the next cards of that kind", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-attention-"));
    try {
      let now = 1_000;
      const briefs = new BriefStore(join(dir, "background-brief.json"), () => now);
      const relay = (choice?: "down" | "less" | "never" | "up") => {
        // the Today card, the chat card and the approval detail all send "attention"
        if (choice) briefs.topicFeedback(ATLAS.id, "attention", choice);
        const w = world();
        w.deps.feedback = (botId, topic) => briefs.wakeLevel(botId, topic);
        w.say("work", REPORT);
        return { w, outcome: relayPersonAttention({ bot: ATLAS, threadId: "work", turnId: "turn-1", ok: true }, w.deps) };
      };
      const first = relay();
      expect(first.outcome.posted).toBe(true);
      expect(first.w.notified).toHaveLength(1);
      // a thumbs-down: the card still comes, quietly (no ring, not unread)
      const quiet = relay("down");
      expect(quiet.outcome.posted).toBe(true);
      expect(quiet.w.threads.get("main")!.at(-1)!.attention).toBeTruthy();
      expect(quiet.w.notified).toEqual([]);
      expect(quiet.w.unread).toEqual([]);
      // "less" twice more: past the mute line, no card at all
      relay("less");
      const muted = relay("less");
      expect(muted.outcome).toEqual({ posted: false, reason: "muted" });
      expect(muted.w.threads.get("main")).toBeUndefined();
      // votes fade: weeks later the cards come back
      now += 6 * TOPIC_HALF_LIFE_MS;
      expect(relay().w.notified).toHaveLength(1);
      // "never" holds until a thumbs-up
      expect(relay("never").outcome).toEqual({ posted: false, reason: "muted" });
      now += 10 * TOPIC_HALF_LIFE_MS;
      expect(relay().outcome).toEqual({ posted: false, reason: "muted" });
      expect(relay("up").outcome.posted).toBe(true);
      // another wake kind's votes do not touch attention cards
      briefs.topicFeedback(ATLAS.id, "heartbeat", "never");
      expect(relay().w.notified).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

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

describe("a run with [HUMAIN] items gives one card, not two", () => {
  it("puts the items on the run's own card already in the chat, and rings once", () => {
    const w = world({ run: { id: "run-1", routineName: "Hourly pass", status: "completed" } });
    w.threads.set("main", [{ id: "run-card", at: 1, role: "bot", kind: "routine.run", text: "Hourly pass", routineRun: { runId: "run-1", routineId: "r1", routineName: "Hourly pass", status: "completed" } } as unknown as WireMessage]);
    w.say("run", REPORT, "turn-late");
    const outcome = relayPersonAttention({ bot: ATLAS, threadId: "run", turnId: "turn-late", ok: true }, w.deps);
    expect(outcome).toMatchObject({ posted: true, onRunCard: true });
    const main = w.threads.get("main")!;
    expect(main).toHaveLength(1);
    expect(main[0]!.attention?.items.map((item) => item.ticketId)).toEqual([100201, 100202]);
    expect(w.notified).toHaveLength(1);
    // the same run's card that already carries items: nothing more, no ring
    w.say("run", REPORT, "turn-later");
    expect(relayPersonAttention({ bot: ATLAS, threadId: "run", turnId: "turn-later", ok: true }, w.deps)).toEqual({ posted: false, reason: "already" });
    expect(w.threads.get("main")!.filter((row) => row.attention)).toHaveLength(1);
    expect(w.notified).toHaveLength(1);
  });
});

describe("#2694: feedback on a run's card, relayed", () => {
  const runCardRow = (wakeTopic?: string) => ({ id: "run-card", at: 1, role: "bot", kind: "routine.run", text: "Mail", routineRun: { runId: "run-1", routineId: "r1", routineName: "Mail", status: "completed", ...(wakeTopic ? { wakeTopic } : {}) } } as unknown as WireMessage);

  it("puts the items on the run's card quietly after a thumbs-down: no ring, not unread", () => {
    const w = world({ run: { id: "run-1", routineName: "Hourly pass", status: "completed" } });
    const asked: string[] = [];
    w.deps.feedback = (_botId, topic) => { asked.push(topic); return "quiet"; };
    w.threads.set("main", [runCardRow()]);
    w.say("run", REPORT, "turn-late");
    const outcome = relayPersonAttention({ bot: ATLAS, threadId: "run", turnId: "turn-late", ok: true }, w.deps);
    expect(outcome).toMatchObject({ posted: true, onRunCard: true });
    expect(w.threads.get("main")![0]!.attention).toBeTruthy();
    expect(w.notified).toEqual([]);
    expect(w.unread).toEqual([]);
    expect(asked).toEqual(["attention"]);
  });

  it("reads the wake's own kind on a proactive run's card, and a muted kind gives nothing", () => {
    const w = world({ run: { id: "run-1", routineName: "Mail", status: "completed" } });
    const asked: string[] = [];
    w.deps.feedback = (_botId, topic) => { asked.push(topic); return topic === "mail" ? "muted" : "normal"; };
    w.threads.set("main", [runCardRow("mail")]);
    w.say("run", REPORT, "turn-late");
    expect(relayPersonAttention({ bot: ATLAS, threadId: "run", turnId: "turn-late", ok: true }, w.deps)).toEqual({ posted: false, reason: "muted" });
    expect(asked).toEqual(["mail"]);
    expect(w.threads.get("main")![0]!.attention).toBeUndefined();
    expect(w.notified).toEqual([]);
  });
});

describe("mirrorBackgroundReply (#2901: nothing invisible)", () => {
  it("copies an MCP send_prompt answer into the bot's chat once, labelled, without ringing", () => {
    const w = world();
    w.deps.relayVia = (_botId, threadId) => threadId === "work" ? "mcp" : undefined;
    w.say("work", "Le lot est prêt.");
    expect(mirrorBackgroundReply({ bot: ATLAS, threadId: "work", turnId: "turn-1", ok: true }, w.deps)).toBe(true);
    expect(mirrorBackgroundReply({ bot: ATLAS, threadId: "work", turnId: "turn-1", ok: true }, w.deps)).toBe(false);
    const copies = (w.threads.get("main") ?? []).filter((row) => row.relayOf);
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ role: "bot", kind: "text", text: "Le lot est prêt.", relayVia: "mcp" });
    expect(w.notified).toHaveLength(0);
    expect(w.unread).toHaveLength(0);
  });

  it("labels a teammate's work and leaves the person's own, confidential and routine threads alone", () => {
    const w = world({ run: { id: "run-1", routineName: "Hourly pass", status: "succeeded" } });
    w.deps.relayVia = (_botId, threadId) => threadId === "work" ? "teammate" : threadId === "run" ? "routine" : undefined;
    w.say("work", "Fini.");
    w.say("main", "Bonjour.");
    w.say("run", "Rapport.");
    expect(mirrorBackgroundReply({ bot: ATLAS, threadId: "work", turnId: "turn-1", ok: true }, w.deps)).toBe(true);
    expect(w.threads.get("main")!.at(-1)).toMatchObject({ relayVia: "teammate", text: "Fini." });
    expect(mirrorBackgroundReply({ bot: ATLAS, threadId: "main", turnId: "turn-1", ok: true }, w.deps)).toBe(false);
    expect(mirrorBackgroundReply({ bot: ATLAS, threadId: "run", turnId: "turn-1", ok: true }, w.deps)).toBe(false);
    const secret = world();
    secret.deps.relayVia = () => "mcp";
    secret.deps.task = (_botId, threadId) => ({ threadId, title: "x", confidential: true }) as never;
    secret.say("work", "Secret.");
    expect(mirrorBackgroundReply({ bot: ATLAS, threadId: "work", turnId: "turn-1", ok: true }, secret.deps)).toBe(false);
  });
});
