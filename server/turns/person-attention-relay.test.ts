import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { BriefStore, TOPIC_HALF_LIFE_MS } from "../proactive/background-brief.ts";

import type { WireMessage, WireTask } from "../../shared/wire.ts";
import { routineRunMayWriteRow } from "../routines/routine-report.ts";
import { askedWords, mirrorBackgroundReply, mirrorLateRunReply, RELAY_GROUP_MS, RELAY_RECENT_ROWS, RELAY_TEXT_MAX, relayPersonAttention, type AttentionBot, type AttentionRelayDeps } from "./person-attention-relay.ts";

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
  it("#2915: an archived teammate thread the owner continues still rings the person", () => {
    const w = world();
    const work = w.deps.task("atlas", "work") as Partial<WireTask>;
    w.deps.task = (_botId, threadId) => (threadId === "work" ? { ...work, archivedAt: 5 } : { threadId, title: "Atlas" }) as never;
    w.say("work", REPORT);
    expect(relayPersonAttention({ bot: ATLAS, threadId: "work", turnId: "turn-1", ok: true }, w.deps)).toMatchObject({ posted: true, threadId: "main" });
    expect(w.notified).toHaveLength(1);
    expect(w.unread).toEqual(["main"]);
  });

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

/** #3581: a run's card, as the routine's card write builds it. */
function withRunCard(w: ReturnType<typeof world>, postsResults = false) {
  w.deps.runCard = (_runThreadId, _target, report) => ({ text: `Hourly pass: ${report}`, routineRun: { runId: "run-1", routineId: "rt-1", routineName: "Hourly pass", status: "completed", summary: report } });
  // the server's one row gate (server/index.ts runRowAllowed)
  w.deps.runRowAllowed = (_runThreadId, late, existing) => routineRunMayWriteRow({
    status: "completed", quiet: late.quiet, ...(late.problem ? { problems: "late" } : {}), postResults: postsResults, byStreak: true, existing,
  });
  return w;
}

describe("mirrorLateRunReply (#3581: one result, one card)", () => {
  it("puts the bot's late answer onto the run's own card in the chat: patched in place, no new row, once", () => {
    const w = withRunCard(world({ run: { id: "run-1", routineName: "Hourly pass", status: "completed" } }), true);
    w.threads.set("main", [{ id: "card", at: 1, role: "bot", kind: "routine.run", text: "Hourly pass: waiting on Nova.", routineRun: { runId: "run-1", routineId: "rt-1", routineName: "Hourly pass", status: "completed", summary: "Waiting on Nova." } } as WireMessage]);
    w.say("run", "Nova's result is in: the three tickets are assigned.");
    // the turn that completed the run itself: its card reports it
    expect(mirrorLateRunReply({ bot: ATLAS, threadId: "run", turnId: "turn-1", ok: true, runTurn: true }, w.deps)).toBe(false);
    expect(relayPersonAttention({ bot: ATLAS, threadId: "run", turnId: "turn-1", ok: true, runTurn: true }, w.deps).posted).toBe(false);
    expect(mirrorLateRunReply({ bot: ATLAS, threadId: "run", turnId: "turn-1", ok: true }, w.deps)).toBe(true);
    expect(mirrorLateRunReply({ bot: ATLAS, threadId: "run", turnId: "turn-1", ok: true }, w.deps)).toBe(false);
    const rows = w.threads.get("main")!;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "card", kind: "routine.run", routineRun: { runId: "run-1", summary: "Nova's result is in: the three tickets are assigned." } });
    expect(rows.some((row) => row.kind === "text")).toBe(false);
    expect(w.notified).toHaveLength(1);
  });

  it("a run with no card in the chat posts its late answer as the rule says for any result", () => {
    const kept = withRunCard(world({ run: { id: "run-1", routineName: "Hourly pass", status: "completed" } }));
    kept.say("run", "Nova's result is in.");
    expect(mirrorLateRunReply({ bot: ATLAS, threadId: "run", turnId: "turn-1", ok: true }, kept.deps)).toBe(false);
    expect(kept.threads.get("main") ?? []).toEqual([]);
    const posted = withRunCard(world({ run: { id: "run-1", routineName: "Hourly pass", status: "completed" } }), true);
    posted.say("run", "Nova's result is in.");
    expect(mirrorLateRunReply({ bot: ATLAS, threadId: "run", turnId: "turn-1", ok: true }, posted.deps)).toBe(true);
    expect(posted.threads.get("main")).toEqual([expect.objectContaining({ kind: "routine.run", routineRun: expect.objectContaining({ summary: "Nova's result is in." }) })]);
  });

  it("leaves an active run's task to the run, and a quiet answer unsaid", () => {
    const active = world({ run: { id: "run-1", routineName: "Hourly pass", status: "waiting" } });
    active.say("run", "Still waiting on Nova.");
    expect(mirrorLateRunReply({ bot: ATLAS, threadId: "run", turnId: "turn-1", ok: true }, active.deps)).toBe(false);
    const quiet = withRunCard(world({ run: { id: "run-1", routineName: "Hourly pass", status: "completed" } }), true);
    quiet.say("run", "NOTHING_TO_REPORT");
    expect(mirrorLateRunReply({ bot: ATLAS, threadId: "run", turnId: "turn-1", ok: true }, quiet.deps)).toBe(false);
  });

  it("#3990: a late answer to a chosen wake that ends quiet adds no row and rings nothing; a real report posts once", () => {
    const quiet = withRunCard(world({ run: { id: "run-1", routineName: "Proactive: teammate message", status: "completed" } }), true);
    quiet.say("run", "Rien à remonter.\nNOTHING_TO_REPORT");
    expect(mirrorLateRunReply({ bot: ATLAS, threadId: "run", turnId: "turn-1", ok: true }, quiet.deps)).toBe(false);
    expect(quiet.threads.get("main") ?? []).toEqual([]);
    expect(quiet.notified).toEqual([]);
    expect(quiet.unread).toEqual([]);
    // the same quiet answer under a card already in the chat leaves it as it is
    const carded = withRunCard(world({ run: { id: "run-1", routineName: "Proactive: teammate message", status: "completed" } }), true);
    const card = { id: "card", at: 1, role: "bot", kind: "routine.run", text: "Nova replied.", routineRun: { runId: "run-1", routineId: "rt-1", routineName: "Proactive: teammate message", status: "completed", summary: "Nova replied." } } as WireMessage;
    carded.threads.set("main", [card]);
    carded.say("run", "Rien à remonter.\nNOTHING_TO_REPORT");
    expect(mirrorLateRunReply({ bot: ATLAS, threadId: "run", turnId: "turn-1", ok: true }, carded.deps)).toBe(false);
    expect(carded.threads.get("main")).toEqual([card]);
    expect([carded.notified, carded.unread]).toEqual([[], []]);
    const real = withRunCard(world({ run: { id: "run-1", routineName: "Proactive: teammate message", status: "completed" } }), true);
    real.say("run", "Nova a fermé les trois billets.");
    expect(mirrorLateRunReply({ bot: ATLAS, threadId: "run", turnId: "turn-1", ok: true }, real.deps)).toBe(true);
    expect(mirrorLateRunReply({ bot: ATLAS, threadId: "run", turnId: "turn-1", ok: true }, real.deps)).toBe(false);
    expect(real.threads.get("main")).toEqual([expect.objectContaining({ kind: "routine.run", routineRun: expect.objectContaining({ summary: "Nova a fermé les trois billets." }) })]);
    expect(real.notified).toHaveLength(1);
  });
});

describe("#3990: a teammate's message wake, its late answer with nothing for the person", () => {
  const PEER_RUN = { id: "run-1", routineName: "Proactive: teammate message", status: "completed" };
  const peerCard = { id: "card", at: 1, role: "bot", kind: "routine.run", text: "Proactive: teammate message", routineRun: { runId: "run-1", routineId: "proactive:maus-1", routineName: "Proactive: teammate message", status: "completed", wakeTopic: "peer", summary: "Waiting on Nova." } } as WireMessage;
  for (const said of ["Rien à faire de ton côté.", "Rien à remonter.\nNOTHING_TO_REPORT"]) {
    it(`writes nothing, updates nothing, marks nothing unread and rings nothing: ${JSON.stringify(said)}`, () => {
      const lines: string[] = [];
      const bare = withRunCard(world({ run: PEER_RUN }));
      bare.deps.rowLog = (line) => lines.push(line);
      bare.say("run", said);
      expect(mirrorLateRunReply({ bot: ATLAS, threadId: "run", turnId: "turn-1", ok: true }, bare.deps)).toBe(false);
      expect(bare.threads.get("main") ?? []).toEqual([]);
      // a row the wake left in the chat (stored by an older server) is not updated
      const carded = withRunCard(world({ run: PEER_RUN }));
      carded.threads.set("main", [peerCard]);
      carded.say("run", said);
      expect(mirrorLateRunReply({ bot: ATLAS, threadId: "run", turnId: "turn-1", ok: true }, carded.deps)).toBe(false);
      expect(carded.threads.get("main")).toEqual([peerCard]);
      expect([bare.notified, bare.unread, carded.notified, carded.unread, lines]).toEqual([[], [], [], [], []]);
    });
  }
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
  it("#3581: a thread a bot opened on itself leaves no copy and no trace row: its trace is its own receipt", () => {
    const w = world();
    w.deps.task = (_botId, threadId) => ({ threadId, title: "Draft the renewal email", openedBy: { botId: ATLAS.id, name: "Atlas", at: 1 } }) as never;
    w.deps.relayVia = (_botId, threadId) => threadId === "work" ? "teammate" : undefined;
    w.say("work", "The draft is ready.");
    expect(mirrorBackgroundReply({ bot: ATLAS, threadId: "work", turnId: "turn-1", ok: true }, w.deps)).toBe(false);
    expect(mirrorBackgroundReply({ bot: ATLAS, threadId: "work", turnId: "turn-2", ok: false }, w.deps)).toBe(false);
    expect(mirrorBackgroundReply({ bot: ATLAS, threadId: "work", turnId: "turn-3", ok: true, stopped: true }, w.deps)).toBe(false);
    expect(w.threads.get("main") ?? []).toEqual([]);
    expect(w.notified).toEqual([]);
    expect(w.unread).toEqual([]);
  });

  it("#3581: an AI client's finished turn appends one row of today's shape, and its failed turn one trace row", () => {
    const w = world();
    w.deps.relayVia = (_botId, threadId) => threadId === "work" ? "mcp" : undefined;
    w.say("work", "Le lot est prêt.");
    expect(mirrorBackgroundReply({ bot: ATLAS, threadId: "work", turnId: "turn-1", ok: true }, w.deps)).toBe(true);
    expect(mirrorBackgroundReply({ bot: ATLAS, threadId: "work", turnId: "turn-2", ok: false }, w.deps)).toBe(true);
    const rows = (w.threads.get("main") ?? []).filter((row) => row.relayOf);
    expect(rows).toEqual([
      expect.objectContaining({ role: "bot", kind: "text", text: "Le lot est prêt.", relayVia: "mcp" }),
      expect.objectContaining({ role: "bot", kind: "text", relayVia: "mcp", relayTrace: "failed" }),
    ]);
  });

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

  it("#3581: leaves a teammate's work, the person's own, confidential and routine threads alone", () => {
    const w = world({ run: { id: "run-1", routineName: "Hourly pass", status: "succeeded" } });
    w.deps.relayVia = (_botId, threadId) => threadId === "work" ? "teammate" : threadId === "run" ? "routine" : undefined;
    w.say("work", "Fini.");
    w.say("main", "Bonjour.");
    w.say("run", "Rapport.");
    expect(mirrorBackgroundReply({ bot: ATLAS, threadId: "work", turnId: "turn-1", ok: true }, w.deps)).toBe(false);
    expect(w.threads.get("main")!.at(-1)).toMatchObject({ text: "Bonjour." });
    expect(mirrorBackgroundReply({ bot: ATLAS, threadId: "main", turnId: "turn-1", ok: true }, w.deps)).toBe(false);
    expect(mirrorBackgroundReply({ bot: ATLAS, threadId: "run", turnId: "turn-1", ok: true }, w.deps)).toBe(false);
    const secret = world();
    secret.deps.relayVia = () => "mcp";
    secret.deps.task = (_botId, threadId) => ({ threadId, title: "x", confidential: true }) as never;
    secret.say("work", "Secret.");
    expect(mirrorBackgroundReply({ bot: ATLAS, threadId: "work", turnId: "turn-1", ok: true }, secret.deps)).toBe(false);
  });
});

describe("mirrorBackgroundReply (#2915)", () => {
  const mcp = () => {
    const w = world();
    w.deps.relayVia = (_botId, threadId) => threadId === "work" ? "mcp" : undefined;
    return w;
  };
  const ask = (w: ReturnType<typeof world>, text: string) => {
    const list = w.threads.get("work") ?? [];
    list.push({ id: `ask-${list.length}`, at: list.length, role: "user", kind: "text", text, sender: { name: "Claude Code" } } as unknown as WireMessage);
    w.threads.set("work", list);
  };
  const copies = (w: ReturnType<typeof world>) => (w.threads.get("main") ?? []).filter((row) => row.relayOf);

  it.each([
    ["failed", { ok: false }],
    ["stopped", { ok: true, stopped: true }],
    ["silent", { ok: true }],
  ] as const)("leaves one trace line for a %s turn, never an earlier turn's words", (trace, outcome) => {
    const w = mcp();
    w.say("work", "Earlier answer.", "turn-0");
    ask(w, "Do the thing");
    expect(mirrorBackgroundReply({ bot: ATLAS, threadId: "work", turnId: "turn-9", ...outcome }, w.deps)).toBe(true);
    expect(mirrorBackgroundReply({ bot: ATLAS, threadId: "work", turnId: "turn-9", ...outcome }, w.deps)).toBe(false);
    const rows = copies(w);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ relayTrace: trace, relayVia: "mcp", relayAsk: { text: "Do the thing", by: "Claude Code" } });
    expect(rows[0]!.text).not.toContain("Earlier answer.");
  });

  it("labels the copy with what was asked and by whom", () => {
    const w = mcp();
    ask(w, "Close the duplicates");
    w.say("work", "Done, 3 closed.");
    mirrorBackgroundReply({ bot: ATLAS, threadId: "work", turnId: "turn-1", ok: true }, w.deps);
    expect(copies(w)[0]).toMatchObject({ text: "Done, 3 closed.", relayAsk: { text: "Close the duplicates", by: "Claude Code" } });
  });

  it("folds a burst into one row and copies a long reply whole", () => {
    const w = mcp();
    let clock = 1_000;
    w.deps.now = () => clock;
    ask(w, "First");
    w.say("work", "One.", "turn-1");
    mirrorBackgroundReply({ bot: ATLAS, threadId: "work", turnId: "turn-1", ok: true }, w.deps);
    const first = copies(w)[0]!;
    clock = first.at + 1;
    ask(w, "Second");
    w.say("work", "Two.", "turn-2");
    mirrorBackgroundReply({ bot: ATLAS, threadId: "work", turnId: "turn-2", ok: true }, w.deps);
    expect(copies(w)).toHaveLength(1);
    expect(copies(w)[0]!.text).toContain("> Second");
    expect(copies(w)[0]!.relayGroup).toHaveLength(1);
    // the second turn is not copied again
    expect(mirrorBackgroundReply({ bot: ATLAS, threadId: "work", turnId: "turn-2", ok: true }, w.deps)).toBe(false);
    clock += RELAY_GROUP_MS * 2;
    w.say("work", "x".repeat(RELAY_TEXT_MAX * 2), "turn-3");
    mirrorBackgroundReply({ bot: ATLAS, threadId: "work", turnId: "turn-3", ok: true }, w.deps);
    expect(copies(w)).toHaveLength(2);
    // nothing of a long reply stays hidden: it is copied whole
    expect(copies(w)[1]!.text).toBe("x".repeat(RELAY_TEXT_MAX * 2));
  });

  it("never folds a reply to another asker under the first one's label", () => {
    const w = mcp();
    let clock = 1_000;
    w.deps.now = () => clock;
    ask(w, "First");
    w.say("work", "One.", "turn-1");
    mirrorBackgroundReply({ bot: ATLAS, threadId: "work", turnId: "turn-1", ok: true }, w.deps);
    clock = copies(w)[0]!.at + 1;
    const list = w.threads.get("work")!;
    list.push({ id: "ask-other", at: list.length, role: "bot", kind: "text", text: "Your part?", from: { botId: "orion", name: "Orion" } } as unknown as WireMessage);
    w.say("work", "Two.", "turn-2");
    mirrorBackgroundReply({ bot: ATLAS, threadId: "work", turnId: "turn-2", ok: true }, w.deps);
    expect(copies(w)).toHaveLength(2);
    expect(copies(w)[1]).toMatchObject({ text: "Two.", relayAsk: { text: "Your part?", by: "Orion" } });
  });

  it("quotes each folded reply's own ask, even when it repeats the first", () => {
    const w = mcp();
    let clock = 1_000;
    w.deps.now = () => clock;
    ask(w, "Status?");
    w.say("work", "One.", "turn-1");
    mirrorBackgroundReply({ bot: ATLAS, threadId: "work", turnId: "turn-1", ok: true }, w.deps);
    clock = copies(w)[0]!.at + 1;
    ask(w, "Status?");
    w.say("work", "Two.", "turn-2");
    mirrorBackgroundReply({ bot: ATLAS, threadId: "work", turnId: "turn-2", ok: true }, w.deps);
    expect(copies(w)).toHaveLength(1);
    expect(copies(w)[0]!.text).toContain("> Status?\n\nTwo.");
  });

  it("leaves no silent trace when the turn ended on a waiting card", () => {
    const w = mcp();
    ask(w, "Delete them?");
    const list = w.threads.get("work")!;
    list.push({ id: "q", at: list.length, role: "bot", kind: "options", text: "Confirm?", turnId: "turn-1", card: { requestId: "r1" } } as unknown as WireMessage);
    expect(mirrorBackgroundReply({ bot: ATLAS, threadId: "work", turnId: "turn-1", ok: true }, w.deps)).toBe(false);
    expect(copies(w)).toHaveLength(0);
    (list.at(-1)!.card as { answered?: string }).answered = "yes";
    expect(mirrorBackgroundReply({ bot: ATLAS, threadId: "work", turnId: "turn-1", ok: true }, w.deps)).toBe(true);
    expect(copies(w)[0]).toMatchObject({ relayTrace: "silent" });
  });

  it("without a turn id, never copies an answer given before the last ask", () => {
    const w = mcp();
    w.say("work", "Earlier answer.", "turn-0");
    ask(w, "Again");
    expect(mirrorBackgroundReply({ bot: ATLAS, threadId: "work", ok: true }, w.deps)).toBe(true);
    expect(copies(w)[0]).toMatchObject({ relayTrace: "silent" });
    expect(copies(w)[0]!.text).not.toContain("Earlier answer.");
  });

  it("reads only the chat's newest rows for the dedupe", () => {
    const w = mcp();
    const asked: number[] = [];
    w.deps.messages = ((threadId: string) => { if (threadId === "main") throw new Error("whole chat read"); return w.threads.get(threadId) ?? []; }) as never;
    w.deps.recent = (threadId, limit) => { asked.push(limit); return (w.threads.get(threadId) ?? []).slice(-limit); };
    w.say("work", "Fini.");
    expect(mirrorBackgroundReply({ bot: ATLAS, threadId: "work", turnId: "turn-1", ok: true }, w.deps)).toBe(true);
    expect(asked).toEqual([RELAY_RECENT_ROWS]);
  });

  it("mirrors an archived thread an AI client continues", () => {
    const w = mcp();
    w.deps.task = (_botId, threadId) => ({ threadId, title: "x", archivedAt: 5 }) as never;
    w.say("work", "Still here.");
    expect(mirrorBackgroundReply({ bot: ATLAS, threadId: "work", turnId: "turn-1", ok: true }, w.deps)).toBe(true);
  });
});

describe("askedWords (QA 0.8.77: no internal note in the mirrored ask)", () => {
  it("drops the notes the server puts before a request the bot wrote itself", () => {
    const opened = "[Thread you opened yourself from #General. The request below is your own words, not the person's: do the work here and end with a clear result they can read.]\n\n[Read-only task: look, read and report. Do not create, edit, delete, send or buy anything. If the work needs a change, stop and say what you would change.]\n\nCheck the login fix and report back.";
    expect(askedWords(opened)).toBe("Check the login fix and report back.");
    expect(askedWords("[Sent while you work · route r1: use it now.]\nAlso the logs")).toBe("Also the logs");
  });

  it("keeps a person's own line that starts with a bracket", () => {
    expect(askedWords("[urgent] call the client")).toBe("[urgent] call the client");
  });
});

describe("#3503: what two bots of the same person say to each other stays in their thread", () => {
  // "work" is a thread the orchestrator bot (Nova) opened with Atlas
  const ownTeam = (owners: Record<string, string> = { "bot-atlas": "person-a", "bot-nova": "person-a" }) => {
    const w = world();
    w.deps.relayVia = (_botId, threadId) => threadId === "work" ? "teammate" : threadId === "client" ? "mcp" : undefined;
    w.deps.sameOwner = (botId, other) => Boolean(owners[botId]) && owners[botId] === owners[other];
    return w;
  };
  const ask = (w: ReturnType<typeof world>, text: string) => {
    const list = w.threads.get("work") ?? [];
    list.push({ id: `ask-${list.length}`, at: 0, role: "bot", kind: "text", text, from: { botId: "bot-nova", name: "Nova", color: "blue" } } as unknown as WireMessage);
    w.threads.set("work", list);
  };

  it("an answer to another bot's ask is not copied into the person's conversation, nor any trace line", () => {
    const w = ownTeam();
    ask(w, "Which branch holds the fix?");
    w.say("work", "The fix is on the branch of the queue.");
    expect(mirrorBackgroundReply({ bot: ATLAS, threadId: "work", turnId: "turn-1", ok: true }, w.deps)).toBe(false);
    expect(mirrorBackgroundReply({ bot: ATLAS, threadId: "work", turnId: "turn-2", ok: true, stopped: true }, w.deps)).toBe(false);
    expect(mirrorBackgroundReply({ bot: ATLAS, threadId: "work", turnId: "turn-3", ok: false }, w.deps)).toBe(false);
    expect(w.threads.get("main") ?? []).toEqual([]);
    expect(w.notified).toEqual([]);
    expect(w.unread).toEqual([]);
  });

  it("a question at the end of its turn is for the bot that opened the thread: no card, no unread, no notification", () => {
    const w = ownTeam();
    ask(w, "Ship the lot.");
    w.say("work", "Two branches conflict.\n\nNEEDS INPUT: which one goes first, the queue or the hot fix?");
    expect(relayPersonAttention({ bot: ATLAS, threadId: "work", turnId: "turn-1", ok: true }, w.deps)).toEqual({ posted: false, reason: "for-opener" });
    expect(mirrorBackgroundReply({ bot: ATLAS, threadId: "work", turnId: "turn-1", ok: true }, w.deps)).toBe(false);
    expect(w.threads.get("main") ?? []).toEqual([]);
    expect(w.notified).toEqual([]);
    expect(w.unread).toEqual([]);
  });

  it("an item tagged for the person and a failure of the work from the same thread still reach the person", () => {
    const tagged = ownTeam();
    tagged.say("work", REPORT);
    expect(relayPersonAttention({ bot: ATLAS, threadId: "work", turnId: "turn-1", ok: true }, tagged.deps)).toMatchObject({ posted: true, threadId: "main", card: { kind: "human" } });
    expect(tagged.notified).toHaveLength(1);
    const failed = ownTeam();
    failed.say("work", "RUN_STATUS: failed: the build does not start.");
    expect(relayPersonAttention({ bot: ATLAS, threadId: "work", turnId: "turn-1", ok: true }, failed.deps)).toMatchObject({ posted: true, card: { kind: "failure" } });
    expect(failed.notified).toHaveLength(1);
  });

  it("a thread a bot of another person opened: its question still reaches the person, its answer stays in the thread", () => {
    const w = ownTeam({ "bot-atlas": "person-a", "bot-nova": "person-b" });
    ask(w, "Which branch holds the fix?");
    w.say("work", "The queue branch.");
    // #3581: its content stays in its thread; the receipt of the ask is its trace
    expect(mirrorBackgroundReply({ bot: ATLAS, threadId: "work", turnId: "turn-1", ok: true }, w.deps)).toBe(false);
    const question = ownTeam({ "bot-atlas": "person-a", "bot-nova": "person-b" });
    question.say("work", "NEEDS INPUT: which one goes first?");
    expect(relayPersonAttention({ bot: ATLAS, threadId: "work", turnId: "turn-1", ok: true }, question.deps)).toMatchObject({ posted: true, card: { kind: "question" } });
  });

  it("an AI client's conversation is still mirrored", () => {
    const w = ownTeam();
    w.deps.task = (_botId, threadId) => ({ threadId, title: "Client", openedBy: { botId: "agent:client", name: "Client", kind: "agent", at: 1 } }) as never;
    w.say("client", "Le lot est prêt.");
    expect(mirrorBackgroundReply({ bot: ATLAS, threadId: "client", turnId: "turn-1", ok: true }, w.deps)).toBe(true);
    expect(w.threads.get("main")!.at(-1)).toMatchObject({ relayVia: "mcp", text: "Le lot est prêt." });
  });
});
