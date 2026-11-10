// #3400 (owner decision 2026-11-10): a learning waits on its card in the
// chat and on the Knowledge tab of the bot's profile. The tab finds the card,
// a decision taken in the tab leaves one quiet line in the chat, and the chat
// reminds the person on its own: one line for everything that waits, at most
// once a day.
import { describe, expect, it } from "vitest";

import { createResolveSkillRequest } from "../index-leaves/resolveSkillRequest.ts";
import { LEARNED_SKILL_REMINDER_AFTER_MS, LEARNED_SKILL_REMINDER_EVERY_MS } from "../../shared/learned-skill-line.ts";
import { openSkillCards, remindWaitingLearnedSkills, type LearnedSkillStore } from "./learned-skill-reminder.ts";

type Row = { id: string; at: number; kind?: string; role?: string; tool?: Record<string, unknown>; card?: Record<string, unknown> };

function fakeStore(now: number) {
  const threads = new Map<string, Row[]>();
  let next = 0;
  const store: LearnedSkillStore & { rows: (threadId: string) => Row[]; patchMessage: (threadId: string, id: string, patch: Partial<Row>) => Row | null; clock: number } = {
    clock: now,
    bots: [{ id: "b1", name: "Pepper", color: "green", threadId: "t-main", tasks: [{ threadId: "t-task" }] }],
    groups: [],
    messagesFor: (threadId) => threads.get(threadId) ?? [],
    appendMessage: (threadId, message) => {
      const row = { id: `m${(next += 1)}`, at: store.clock, ...message } as Row;
      threads.set(threadId, [...(threads.get(threadId) ?? []), row]);
      return row;
    },
    rows: (threadId) => threads.get(threadId) ?? [],
    patchMessage: (threadId, id, patch) => {
      const list = threads.get(threadId) ?? [];
      const at = list.findIndex((row) => row.id === id);
      if (at < 0) return null;
      list[at] = { ...list[at]!, ...patch };
      return list[at]!;
    },
  };
  return store;
}

const card = (stagedId: string, createdAt: number, extra: Record<string, unknown> = {}) => ({
  role: "bot",
  kind: "options",
  card: {
    requestId: `rq-${stagedId}`,
    options: ["Enable", "Deny"],
    skillRequest: { botId: "b1", stagedId, name: `skill-${stagedId}`, action: "create", createdAt, sha256: "a".repeat(64), preview: "x" },
    ...extra,
  },
});

const reminders = (rows: Row[]) => rows.filter((row) => (row.tool as { learnedSkill?: { event: string } } | undefined)?.learnedSkill?.event === "waiting");

describe("learned skills that wait (#3400)", () => {
  it("finds each open card of the bot, in its chat or one of its threads, never a settled one", () => {
    const now = Date.now();
    const store = fakeStore(now);
    store.appendMessage("t-main", card("s1", now));
    store.appendMessage("t-task", card("s2", now));
    store.appendMessage("t-main", card("s3", now, { answered: "allow" }));
    const found = openSkillCards(store, "b1");
    expect([...found.keys()].sort()).toEqual(["s1", "s2"]);
    expect(found.get("s2")).toMatchObject({ threadId: "t-task", requestId: "rq-s2" });
  });

  it("reminds once for everything that waits, at most once a day, and not before a learning has waited an hour", () => {
    const start = Date.now();
    const store = fakeStore(start);
    store.appendMessage("t-main", card("s1", start));
    store.appendMessage("t-task", card("s2", start));
    const staged = () => ["s1", "s2"];

    // the card itself is the first word
    expect(remindWaitingLearnedSkills(store, staged, start + 60_000)).toEqual([]);

    store.clock = start + LEARNED_SKILL_REMINDER_AFTER_MS;
    expect(remindWaitingLearnedSkills(store, staged, store.clock)).toEqual(["b1"]);
    const lines = reminders(store.rows("t-main"));
    expect(lines).toHaveLength(1);
    expect(lines[0]!.kind).toBe("activity");
    expect(lines[0]!.tool).toMatchObject({ ok: true, learnedSkill: { event: "waiting", count: 2 } });
    // a quiet line, not a hidden technical notice
    expect(String(lines[0]!.tool!.name)).not.toMatch(/^notice:/);

    // again within the day: nothing more
    store.clock += LEARNED_SKILL_REMINDER_EVERY_MS - 1;
    expect(remindWaitingLearnedSkills(store, staged, store.clock)).toEqual([]);
    // a day later, still waiting: one more line
    store.clock += 1;
    expect(remindWaitingLearnedSkills(store, staged, store.clock)).toEqual(["b1"]);
    expect(reminders(store.rows("t-main"))).toHaveLength(2);
  });

  it("says nothing when nothing waits (settled cards, or no staged learning)", () => {
    const start = Date.now() - 2 * LEARNED_SKILL_REMINDER_EVERY_MS;
    const store = fakeStore(Date.now());
    store.appendMessage("t-main", card("s1", start, { answered: "deny", dismissed: true }));
    expect(remindWaitingLearnedSkills(store, () => ["s1"])).toEqual([]);
    expect(remindWaitingLearnedSkills(store, () => [])).toEqual([]);
    expect(reminders(store.rows("t-main"))).toHaveLength(0);
  });

  it("a decision taken in the Knowledge tab settles the chat's card and leaves one quiet line there", () => {
    const store = fakeStore(Date.now());
    const appended = store.appendMessage("t-main", card("s1", Date.now())) as Row;
    const decisions: unknown[] = [];
    const host = {
      store,
      DATA_DIR: "/nowhere",
      appendDecision: (_dir: string, entry: unknown) => decisions.push(entry),
      rejectStagedSkillWrite: () => ({ rejected: true }),
    };
    const resolve = createResolveSkillRequest(() => host);
    const result = resolve({ botId: "b1", threadId: "t-main", requestId: "rq-s1", behavior: "deny", via: "profile" });
    expect(result).toMatchObject({ claimed: true, outcome: "rejected" });
    const settled = store.rows("t-main").find((row) => row.id === appended.id)!;
    expect(settled.card).toMatchObject({ answered: "deny", dismissed: true });
    const lines = store.rows("t-main").filter((row) => (row.tool as { learnedSkill?: unknown } | undefined)?.learnedSkill);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.tool).toMatchObject({ learnedSkill: { event: "decided", outcome: "declined", name: "skill-s1" } });

    // the same card answered again (from the chat) is already settled: no second line
    resolve({ botId: "b1", threadId: "t-main", requestId: "rq-s1", behavior: "deny", via: "profile" });
    expect(store.rows("t-main").filter((row) => (row.tool as { learnedSkill?: unknown } | undefined)?.learnedSkill)).toHaveLength(1);
  });

  it("a decision taken in the chat leaves no extra line (the card itself says it)", () => {
    const store = fakeStore(Date.now());
    store.appendMessage("t-main", card("s1", Date.now()));
    const host = { store, DATA_DIR: "/nowhere", appendDecision: () => {}, rejectStagedSkillWrite: () => ({ rejected: true }) };
    createResolveSkillRequest(() => host)({ botId: "b1", threadId: "t-main", requestId: "rq-s1", behavior: "deny" });
    expect(store.rows("t-main").filter((row) => (row.tool as { learnedSkill?: unknown } | undefined)?.learnedSkill)).toHaveLength(0);
  });
});
