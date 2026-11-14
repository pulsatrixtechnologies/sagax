// #4233 (Q2): a problem that lasts reaches the person as one keyed fix
// card (the #4205 ask_choice card, raised through the same path): three
// problem runs raise one card; ten more change nothing but its count; a
// good run retires it; a restart raises no second card (the key finds the
// pending one); still open after a day, one reminder.
import { describe, expect, it } from "vitest";

import { ENGLISH_WORDS } from "../../shared/approval-describe.ts";
import { isPersistentQuestionCard } from "../../shared/ask-question.ts";
import type { RoutineNeedsPerson } from "../../shared/routines.ts";
import { retireOpenQuestions } from "../approvals/retire-open-questions.ts";
import { INPUT_REMIND_REPEAT_MS } from "../runtime/types.ts";
import type { Message } from "../store.ts";
import { AskKeyIndex } from "../widgets/ask-choice-keys.ts";
import { createAgentCard, type AgentCardStore } from "../widgets/chat-widgets.ts";
import { routineNeedsPerson } from "./routine-needs-person.ts";
import { lastingProblem, routineProblemCardInput, RoutineProblemCards, routineProblemKey, type RoutineProblemCardsDeps } from "./routine-problem-card.ts";
import type { Routine, RoutineRun } from "./routines.ts";

const T0 = 1_800_000_000_000;
const BOT = { id: "b1", name: "Watch", color: "blue" as const };
const CONV = "conv-b1";
const EVERY_5 = { type: "interval", everyMinutes: 5, anchorAt: 0 } as Routine["schedule"];

const routine = (extra: Partial<Routine> = {}): Routine => ({
  id: "r1", name: "Mailbox sweep", prompt: "p", target: "bot", botId: "b1", runOn: "maus", enabled: true, schedule: EVERY_5,
  durationMinutes: 5, nextRunAt: T0, createdAt: 1, updatedAt: 1, ...extra,
});

/** A store, the key index and a raise that draws a real question card (a
 * request id), as index.ts raiseHarnessQuestion does. `conv`: where the
 * card goes; `scope`: the conversations its key is looked up in. */
function world(opts: { conv?: string; scope?: (threadId: string) => boolean } = {}) {
  const conv = opts.conv ?? CONV;
  const scope = opts.scope ?? (() => true);
  const threads = new Map<string, Message[]>();
  let next = 0;
  let clock = T0;
  const rows = (threadId: string) => {
    if (!threads.has(threadId)) threads.set(threadId, []);
    return threads.get(threadId)!;
  };
  const store: AgentCardStore = {
    groupByThread: () => undefined,
    messagesFor: (threadId) => rows(threadId),
    appendMessage: (threadId, message) => {
      const full = { ...message, id: `m${++next}`, at: clock } as Message;
      rows(threadId).push(full);
      return full;
    },
    patchMessage: (threadId, messageId, patch) => {
      const list = rows(threadId);
      const index = list.findIndex((row) => row.id === messageId);
      if (index < 0) return null;
      list[index] = { ...list[index]!, ...patch } as Message;
      return list[index]!;
    },
  };
  const rings: string[] = [];
  const raiseQuestion = (choice: { title: string; question: string; options: string[] }) => {
    const row = store.appendMessage(conv, {
      role: "bot", kind: "options",
      card: {
        title: choice.title, subtitle: choice.question, options: choice.options, requestId: `ask-choice-${next + 1}`, requestType: "question",
        questionRequest: { questions: [{ question: choice.question, options: choice.options.map((label) => ({ label })) }] },
      },
    } as Omit<Message, "id" | "at">);
    // request.opened rings the card's question once, when it is raised
    rings.push(row.id);
    return { messageId: row.id };
  };
  const seedFromStore = () => [...threads.entries()].flatMap(([threadId, list]) => list.map((message) => ({ threadId, message })));
  const newIndex = () => new AskKeyIndex({ seed: seedFromStore, messagesFor: (threadId) => store.messagesFor(threadId) });
  let index = newIndex();
  const runs: RoutineRun[] = [];
  const run = (status: RoutineRun["status"], extra: Partial<RoutineRun> = {}) => {
    clock += 5 * 60_000;
    const earlier = [...runs].reverse();
    const streak: RoutineRun[] = [];
    for (const entry of earlier) {
      if (entry.status === "completed" && !entry.problems) break;
      streak.push(entry);
    }
    const problem = status === "failed" || Boolean(extra.problems);
    const first = streak.at(-1);
    const entry = {
      id: `x${runs.length + 1}`, routineId: "r1", routineName: "Mailbox sweep", botId: "b1", target: "bot", runOn: "maus",
      scheduledFor: clock, status, manual: false, createdAt: clock, startedAt: clock, finishedAt: clock, threadId: `t-${runs.length + 1}`,
      ...(problem && first ? { problemRepeat: { firstRunId: first.id, since: first.finishedAt!, count: streak.length + 1 } } : {}),
      ...extra,
    } as RoutineRun;
    runs.push(entry);
    return entry;
  };
  const cardsWith = (): RoutineProblemCards<Routine> => {
    const deps: RoutineProblemCardsDeps<Routine> = {
      // the one rule, read without cards or items: a 5 minute routine is
      // told at its third problem run
      need: (target) => routineNeedsPerson(target, {
        runsOf: () => runs, cardOpen: () => false, problemToldAt: () => 3, now: () => clock,
      }, new Map()),
      facts: (_target, need) => {
        const last = runs.find((entry) => entry.id === need.runId);
        return { summary: need.text, count: need.failures ?? last?.problemRepeat?.count ?? 1, ...(last?.readiness?.find((check) => !check.ok) ? { readiness: last.readiness.find((check) => !check.ok)!.line } : {}) };
      },
      words: () => ENGLISH_WORDS,
      ask: (_target, input) => {
        const posted = createAgentCard({
          store, bot: BOT, threadId: conv, input: input as unknown as Record<string, unknown>,
          raiseQuestion,
          askKeys: {
            find: (key) => index.find(key, scope),
            remember: (key, threadId, messageId) => index.remember(key, threadId, messageId),
            retire: (threadId, message) => {
              retireOpenQuestions({
                messagesFor: (id) => rows(id), isPersistentQuestionCard,
                patch: (id, rowId, card) => { store.patchMessage(id, rowId, { card }); },
              }, threadId, { messageId: message.id });
            },
          },
        });
        expect(posted.ok).toBe(true);
      },
      pending: (_target, key) => index.find(key, scope),
      latest: (_target, key) => {
        const row = [...rows(conv)].reverse().find((message) => message.kind === "options" && message.card?.askKey === key);
        return row ? { at: row.at } : null;
      },
      remind: (_target, found) => {
        rings.push(found.message.id);
        const row = rows(found.threadId).find((message) => message.id === found.message.id)!;
        store.patchMessage(found.threadId, row.id, { card: { ...row.card!, remindedAt: clock } });
      },
      now: () => clock,
    };
    return new RoutineProblemCards(deps);
  };
  const open = () => rows(conv).filter((row) => row.kind === "options" && row.card && !row.card.answered && !row.card.dismissed && !row.card.expired);
  return {
    rows, runs, run, rings, open, cardsWith,
    restart: () => { index = newIndex(); },
    later: (ms: number) => { clock += ms; },
  };
}

describe("a lasting routine problem raises one keyed fix card (#4233 Q2)", () => {
  it("three problem runs raise one card; ten more change nothing but the count; a good run retires it", () => {
    const w = world();
    const cards = w.cardsWith();
    const r = routine();
    w.run("failed", { error: "The mailbox refused the sign-in" });
    cards.sync(r);
    w.run("failed", { error: "The mailbox refused the sign-in" });
    cards.sync(r);
    expect(w.open()).toHaveLength(0);
    w.run("failed", { error: "The mailbox refused the sign-in", readiness: [{ kind: "engine", ok: false, code: "engine_signed_out", line: "Claude is signed out for this bot." }] as RoutineRun["readiness"] });
    cards.sync(r);
    expect(w.open()).toHaveLength(1);
    const [card] = w.open();
    expect(card!.card).toMatchObject({ askKey: routineProblemKey("r1"), noHold: true, options: ["Run a check", "Pause the routine", "Open the routine"] });
    expect(card!.card!.subtitle).toContain("Mailbox sweep ended with problems on its last 3 runs.");
    expect(card!.card!.subtitle).toContain("The mailbox refused the sign-in");
    expect(card!.card!.subtitle).toContain("Claude is signed out for this bot.");
    expect(w.rings).toEqual([card!.id]);

    for (let n = 0; n < 10; n += 1) {
      w.run("completed", { problems: "Two folders could not be read" });
      cards.sync(r);
      cards.sync(r);
    }
    expect(w.open()).toHaveLength(1);
    expect(w.open()[0]!.id).toBe(card!.id);
    expect(w.open()[0]!.card!.subtitle).toContain("on its last 13 runs");
    // nothing rang again
    expect(w.rings).toEqual([card!.id]);
    expect(w.rows(CONV).filter((row) => row.kind === "options")).toHaveLength(1);

    w.run("completed");
    cards.sync(r);
    expect(w.open()).toHaveLength(0);
    expect(w.rows(CONV).find((row) => row.id === card!.id)!.card!.expired).toBe(true);
    expect(w.rings).toEqual([card!.id]);
  });

  it("a restart raises no second card: the key finds the pending one", () => {
    const w = world();
    const r = routine();
    for (let n = 0; n < 3; n += 1) w.run("failed", { error: "Down" });
    w.cardsWith().sync(r);
    expect(w.open()).toHaveLength(1);
    const first = w.open()[0]!.id;
    // a new server: a new key index (seeded from storage) and no memory
    w.restart();
    const after = w.cardsWith();
    after.sync(r);
    w.run("failed", { error: "Down" });
    after.sync(r);
    expect(w.open().map((row) => row.id)).toEqual([first]);
    expect(w.open()[0]!.card!.subtitle).toContain("last 4 runs");
    expect(w.rings).toEqual([first]);
  });

  it("answered, the same streak is never raised again; a new streak is", () => {
    const w = world();
    const cards = w.cardsWith();
    const r = routine();
    for (let n = 0; n < 3; n += 1) w.run("failed", { error: "Down" });
    cards.sync(r);
    const card = w.open()[0]!;
    w.rows(CONV)[w.rows(CONV).indexOf(card)] = { ...card, card: { ...card.card!, answered: "answer", answeredText: "Open the routine" } };
    w.run("failed", { error: "Down" });
    cards.sync(r);
    expect(w.open()).toHaveLength(0);
    expect(w.rings).toHaveLength(1);
    w.run("completed");
    cards.sync(r);
    for (let n = 0; n < 3; n += 1) w.run("failed", { error: "Down again" });
    cards.sync(r);
    expect(w.open()).toHaveLength(1);
    expect(w.rings).toHaveLength(2);
  });

  it("answered or put away, a restart never raises the same streak again", () => {
    for (const close of [{ answered: "answer", answeredText: "Open the routine" }, { dismissed: true }] as const) {
      const w = world();
      const r = routine();
      for (let n = 0; n < 3; n += 1) w.run("failed", { error: "Down" });
      w.cardsWith().sync(r);
      const card = w.open()[0]!;
      w.rows(CONV)[w.rows(CONV).indexOf(card)] = { ...card, card: { ...card.card!, ...close } };
      // a new server: a new key index and no memory of what was shown
      w.restart();
      const after = w.cardsWith();
      after.sync(r);
      w.run("failed", { error: "Down" });
      after.sync(r);
      expect(w.open()).toHaveLength(0);
      expect(w.rings).toEqual([card.id]);
      // a new streak after a good run is told again
      w.run("completed");
      after.sync(r);
      for (let n = 0; n < 3; n += 1) w.run("failed", { error: "Down again" });
      after.sync(r);
      expect(w.open()).toHaveLength(1);
      expect(w.rings).toHaveLength(2);
    }
  });

  it("a pause after failures: the same card, without a pause choice", () => {
    const w = world();
    const cards = w.cardsWith();
    for (let n = 0; n < 3; n += 1) w.run("failed", { error: "Down" });
    cards.sync(routine());
    const id = w.open()[0]!.id;
    cards.sync(routine({ enabled: false, autoPaused: { at: T0 + 1, failures: 3, runId: "x3" } as Routine["autoPaused"] }));
    expect(w.open().map((row) => row.id)).toEqual([id]);
    expect(w.open()[0]!.card).toMatchObject({ options: ["Run a check", "Open the routine"] });
    expect(w.open()[0]!.card!.subtitle).toContain("paused itself after 3 failed runs in a row");
    expect(w.rings).toEqual([id]);
  });

  it("#4250 (S3): still open, told again after a day, then weekly, each step once (a restart in the middle included)", () => {
    const w = world();
    const r = routine();
    const cards = w.cardsWith();
    for (let n = 0; n < 3; n += 1) w.run("failed", { error: "Down" });
    cards.sync(r);
    const id = w.open()[0]!.id;
    cards.remindDue([r]);
    expect(w.rings).toEqual([id]);
    w.later(INPUT_REMIND_REPEAT_MS);
    cards.remindDue([r]);
    expect(w.rings).toEqual([id, id]);
    cards.remindDue([r]);
    w.restart();
    w.cardsWith().remindDue([r]);
    w.later(INPUT_REMIND_REPEAT_MS);
    w.cardsWith().remindDue([r]);
    expect(w.rings).toEqual([id, id]);
    // a week after the day reminder: once more, then weekly
    w.later(6 * INPUT_REMIND_REPEAT_MS);
    w.cardsWith().remindDue([r]);
    w.cardsWith().remindDue([r]);
    expect(w.rings).toEqual([id, id, id]);
    w.restart();
    w.later(6 * INPUT_REMIND_REPEAT_MS);
    w.cardsWith().remindDue([r]);
    expect(w.rings).toEqual([id, id, id]);
    w.later(INPUT_REMIND_REPEAT_MS);
    w.cardsWith().remindDue([r]);
    expect(w.rings).toEqual([id, id, id, id]);
    // the first good run retires it: nothing more
    w.run("completed");
    w.cardsWith().sync(r);
    w.later(30 * INPUT_REMIND_REPEAT_MS);
    w.cardsWith().remindDue([r]);
    expect(w.rings).toEqual([id, id, id, id]);
  });

  it("a routine reporting to a teammate's conversation: its card is found there, for that person only", () => {
    // a routine of b1 requested from b2's conversation with p1; b2 also
    // talks with p2, whose conversation holds a card under the same key
    const owners = new Map([["conv-b2-p1", "p1"], ["conv-b2-p1-older", "p1"], ["conv-b2-p2", "p2"]]);
    const scope = (threadId: string) => threadId === "conv-b2-p1" || owners.get(threadId) === "p1";
    const w = world({ conv: "conv-b2-p1", scope });
    const key = routineProblemKey("r1");
    w.rows("conv-b2-p2").push({
      id: "theirs", at: T0, role: "bot", kind: "options",
      card: { askKey: key, title: "t", subtitle: "Their card", options: ["a"], requestId: "q-theirs", requestType: "question" },
    } as Message);
    w.restart();
    const cards = w.cardsWith();
    const r = routine({ botId: "b1" });
    for (let n = 0; n < 3; n += 1) w.run("failed", { error: "Down" });
    cards.sync(r);
    expect(w.open()).toHaveLength(1);
    const id = w.open()[0]!.id;
    // later runs move its count in place; nothing rings again
    w.run("failed", { error: "Down" });
    cards.sync(r);
    expect(w.open().map((row) => row.id)).toEqual([id]);
    expect(w.open()[0]!.card!.subtitle).toContain("last 4 runs");
    // still open a day later: its one reminder, never the other person's card
    w.later(INPUT_REMIND_REPEAT_MS);
    cards.remindDue([r]);
    expect(w.rings).toEqual([id, id]);
    // the first good run retires it
    w.run("completed");
    cards.sync(r);
    expect(w.open()).toHaveLength(0);
    expect(w.rings).toEqual([id, id]);
    // the other person's card is never written, reminded or retired
    expect(w.rows("conv-b2-p2")[0]!.card).toMatchObject({ subtitle: "Their card" });
    expect(w.rows("conv-b2-p2")[0]!.card!.expired).toBeUndefined();
  });

  it("a routine gone retires its card", () => {
    const w = world();
    const cards = w.cardsWith();
    for (let n = 0; n < 3; n += 1) w.run("failed", { error: "Down" });
    cards.syncAll([routine()]);
    expect(w.open()).toHaveLength(1);
    cards.syncAll([]);
    expect(w.open()).toHaveLength(0);
  });

  it("only a told problem or a pause asks for a fix", () => {
    const need = (kind: RoutineNeedsPerson["kind"]): RoutineNeedsPerson => ({ kind, text: "", since: 1 });
    expect(lastingProblem(need("problem"))).not.toBeNull();
    expect(lastingProblem(need("paused"))).not.toBeNull();
    for (const kind of ["question", "items", "goal"] as const) expect(lastingProblem(need(kind))).toBeNull();
    const input = routineProblemCardInput({ id: "r1", name: "Sweep" }, need("problem"), { summary: "", count: 0 }, ENGLISH_WORDS);
    expect(input).toMatchObject({ key: "routine-problem:r1", wait: false, decision: true, title: "Sweep needs a fix", question: "Sweep ended with problems on its last run." });
  });
});
