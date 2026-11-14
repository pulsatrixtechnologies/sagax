// #4238: a teammate's request whose answer leaves something on the person
// reaches the person: keyed cards in their own conversation with the bot,
// one synthesized line, the outcome on the "Asked by" receipt.
import { describe, expect, it } from "vitest";

import type { WireMessage, WireTask } from "../../shared/wire.ts";
import { personWaitCues } from "../../shared/peer-outcome.ts";
import { backfillPeerOutcomes, PeerOutcomeLedger, settlePeerOutcome, type PeerOutcomeDeps } from "./peer-outcome-relay.ts";
import { answeredItemKeys, PEER_ITEM_SCOPE, personItemKeyPrefix, syncPersonItemCards } from "./person-item-cards.ts";
import type { AttentionBot } from "./person-attention-relay.ts";

const MAIN: AttentionBot = { id: "bot-main", name: "Atlas" };

/** The production answer: the main bot checked the team bot's sweep and
 * answered it in their side exchange, nothing for the person. */
const SWEEP_ANSWER = [
  "Checked the sweep:",
  "- Time not logged on 3 tickets: nothing written, the entries need the person's hours.",
  "- Ticket bodies refused: permission denied on service notes (missing scope).",
  "- The real knot is the two slots booked on top of each other at 9:00; it stays on the day's list.",
].join("\n");

function world() {
  const threads = new Map<string, WireMessage[]>();
  const tasks = new Map<string, Partial<WireTask> & { threadId: string; title: string }>();
  tasks.set("main", { threadId: "main", title: "Atlas" });
  tasks.set("work", { threadId: "work", title: "@Nova · sweep", openedBy: { botId: "bot-nova", name: "Nova", kind: "work", at: 1 } });
  let next = 0;
  const append = (threadId: string, message: Partial<WireMessage>) => {
    const list = threads.get(threadId) ?? [];
    const row = { ...message, id: `m${next++}`, at: next } as WireMessage;
    list.push(row);
    threads.set(threadId, list);
    return row;
  };
  const say = (threadId: string, text: string, turnId = "turn-1") => append(threadId, { role: "bot", kind: "text", text, turnId });
  // the "Asked by" receipt of the team bot's request in the person's chat
  const receipt = append("main", { role: "bot", kind: "activity", tool: { name: "Sent to Atlas", input: "Sweep of the day", ok: true } as never, threadRef: { botId: MAIN.id, threadId: "work", title: "@Nova · sweep" }, from: { botId: "bot-nova", name: "Nova", color: "blue" } as never });
  // what reached the ask_choice path (person-item-cards.ts calls it as the
  // bot would): a keyed card in the person's conversation, replaced in
  // place while pending
  const raised: Array<{ target: string; key: string; question: string; options: string[] }> = [];
  const notified: string[] = [];
  const unread: string[] = [];
  const nudged: string[] = [];
  const quietCalls: boolean[] = [];
  const ledger = new PeerOutcomeLedger();
  let nudgeWorks = true;
  let language: "fr" | "en" = "en";
  const pendingRow = (target: string, key: string) => (threads.get(target) ?? []).findLast((row) => row.kind === "options" && row.card?.askKey === key && !row.card.answered && !row.card.dismissed);
  const ask = (target: string, input: Record<string, unknown>) => {
    const key = String(input.key);
    if (input.retire === true) return false;
    const question = String(input.question);
    const options = input.options as string[];
    raised.push({ target, key, question, options });
    const open = pendingRow(target, key);
    if (open) {
      open.card = { ...open.card!, subtitle: question, options };
      return true;
    }
    append(target, { role: "bot", kind: "options", card: { title: "q", subtitle: question, options, askKey: key, noHold: true } as never });
    return true;
  };
  const deps: PeerOutcomeDeps<AttentionBot> = {
    task: (_botId, threadId) => tasks.get(threadId) as never,
    messages: (threadId) => threads.get(threadId) ?? [],
    append: (threadId, message) => append(threadId, message as Partial<WireMessage>),
    patch: (threadId, messageId, patch) => {
      const list = threads.get(threadId) ?? [];
      const at = list.findIndex((row) => row.id === messageId);
      if (at >= 0) list[at] = { ...list[at]!, ...patch };
    },
    markUnread: (_botId, threadId) => { unread.push(threadId); },
    conversation: () => "main",
    agentConversation: () => false,
    routineRun: () => null,
    relayVia: (_botId, threadId) => (threadId === "work" ? "teammate" : undefined),
    notify: (_bot, _threadId, title) => { notified.push(title); },
    takeRecorded: (threadId) => ledger.take(threadId),
    language: () => language,
    itemCards: (_bot, target, items, lang, options) => (quietCalls.push(options?.quiet === true), syncPersonItemCards({ routineId: PEER_ITEM_SCOPE }, items, {
      pending: (key) => {
        const card = pendingRow(target, key)?.card;
        return card ? { question: card.subtitle, options: card.options } : null;
      },
      pendingKeys: (prefix) => (threads.get(target) ?? []).filter((row) => row.card?.askKey?.startsWith(prefix) && !row.card.answered).map((row) => row.card!.askKey!),
      answeredKeys: (prefix) => answeredItemKeys(threads.get(target) ?? [], prefix),
      release: () => undefined,
      ask: (input) => ask(target, input),
    }, lang, { retire: false })),
    itemState: (_bot, target, key) => pendingRow(target, key) ? "pending" : answeredItemKeys(threads.get(target) ?? [], key).includes(key) ? "answered" : null,
    nudge: (_bot, threadId) => {
      nudged.push(threadId);
      return nudgeWorks;
    },
    nudges: new Map(),
  };
  const answer = (key: string, choice: string) => {
    const row = pendingRow("main", key)!;
    row.card = { ...row.card!, answered: choice };
  };
  return { deps, say, threads, raised, notified, unread, nudged, ledger, receipt, answer, quietCalls, setNudge: (works: boolean) => { nudgeWorks = works; }, setLanguage: (next: "fr" | "en") => { language = next; } };
}

const lines = (w: ReturnType<typeof world>) => (w.threads.get("main") ?? []).filter((row) => row.peerOutcome?.line);
const cardsIn = (w: ReturnType<typeof world>) => (w.threads.get("main") ?? []).filter((row) => row.kind === "options");
const PEER_PREFIX = personItemKeyPrefix(PEER_ITEM_SCOPE);

/** The production answer, in French. */
const SWEEP_ANSWER_FR = [
  "Vérifié le balayage :",
  "- Temps non saisi sur 3 billets : rien d'écrit, il faut tes heures, besoin de toi.",
  "- Corps des billets : refusé faute de permission sur les notes de service.",
  "- Le vrai noeud : les deux plages à 9:00 se chevauchent; ça reste sur la liste du jour.",
].join("\n");

describe("settlePeerOutcome (#4238)", () => {
  it("reads the production answer's words as things waiting on the person", () => {
    expect(personWaitCues(SWEEP_ANSWER).map((cue) => cue.kind)).toEqual(["pending", "access", "pending"]);
    expect(personWaitCues("Tout est fait, rien pour toi.")).toEqual([]);
  });

  it("a silent end whose words leave something on the person: the server asks the bot once, nothing is drawn yet", () => {
    const w = world();
    w.say("work", SWEEP_ANSWER);
    expect(settlePeerOutcome({ bot: MAIN, threadId: "work", turnId: "turn-1", ok: true }, w.deps)).toEqual({ settled: "nudged" });
    expect(w.nudged).toEqual(["work"]);
    expect(w.raised).toEqual([]);
    expect(lines(w)).toEqual([]);
  });

  it("the bot raises its items after the ask: keyed cards in the person's conversation and one line naming the teammate", () => {
    const w = world();
    w.say("work", SWEEP_ANSWER);
    settlePeerOutcome({ bot: MAIN, threadId: "work", turnId: "turn-1", ok: true }, w.deps);
    // the ask turn: the bot raises two items through ask_choice (redirected
    // into the person's conversation, recorded for the outcome)
    w.ledger.record("work", { key: "slot-0900", kind: "ask", text: "Two slots at 9:00: which one stays, the client visit or the review?", messageId: "c1" });
    w.ledger.record("work", { key: "scope-service-notes", kind: "fix", text: "Grant the service notes scope", messageId: "c2" });
    w.ledger.record("work", { key: "offline", kind: "tell", text: "Two computers were offline this morning." });
    w.say("work", "Raised for the person.", "turn-2");
    const result = settlePeerOutcome({ bot: MAIN, threadId: "work", turnId: "turn-2", ok: true }, w.deps);
    expect(result).toMatchObject({ settled: "asked", line: true });
    const [line] = lines(w);
    expect(line?.text).toBe("Nova: 2 things need you, 1 thing to know");
    expect(w.raised).toEqual([]);
    expect(line?.peerOutcome?.from).toEqual({ botId: "bot-nova", name: "Nova" });
    // never the raw bot-to-bot text
    expect(line?.text).not.toContain("Checked the sweep");
    // the receipt opens what the request concluded
    const receipt = w.threads.get("main")!.find((row) => row.id === w.receipt.id);
    expect(receipt?.peerOutcome).toMatchObject({ kind: "asked", items: [{ key: "slot-0900" }, { key: "scope-service-notes" }, { key: "offline" }] });
    expect(w.unread).toEqual(["main"]);
    // the cards ring as questions do: the line rings nothing more
    expect(w.notified).toEqual([]);
  });

  it("asked once and still nothing raised: the server raises the items itself through the item card path, each a question to the person", () => {
    const w = world();
    w.say("work", SWEEP_ANSWER);
    settlePeerOutcome({ bot: MAIN, threadId: "work", turnId: "turn-1", ok: true }, w.deps);
    w.say("work", "The overlap stays on the day's list.", "turn-2");
    const result = settlePeerOutcome({ bot: MAIN, threadId: "work", turnId: "turn-2", ok: true }, w.deps);
    expect(result).toMatchObject({ settled: "asked", line: true });
    expect(w.raised.length).toBeGreaterThanOrEqual(3);
    for (const card of w.raised) {
      expect(card.target).toBe("main");
      // #4243's keys and choices, under the peer scope
      expect(card.key.startsWith(PEER_PREFIX)).toBe(true);
      expect(card.options).toEqual(["Done", "Not for me"]);
      // a question to the person, the line as its context
      expect(card.question.trim().endsWith("?")).toBe(true);
      expect(card.question.startsWith("Atlas ")).toBe(true);
    }
    expect(w.raised.some((card) => /^Atlas was blocked for a missing permission or sign-in: .*permission denied/.test(card.question))).toBe(true);
    expect(lines(w)).toHaveLength(1);
    expect(lines(w)[0]!.peerOutcome?.fallback).toBe(true);
    expect(lines(w)[0]!.peerOutcome?.items.some((item) => item.kind === "fix")).toBe(true);
  });

  it("French words: the cards ask in French with #4243's choices, and the stored line is in the person's language", () => {
    const w = world();
    w.setLanguage("fr");
    w.setNudge(false);
    w.say("work", SWEEP_ANSWER_FR);
    expect(settlePeerOutcome({ bot: MAIN, threadId: "work", turnId: "turn-1", ok: true }, w.deps)).toMatchObject({ settled: "asked", line: true });
    expect(w.raised.length).toBeGreaterThanOrEqual(2);
    for (const card of w.raised) expect(card.options).toEqual(["Fait", "Pas pour moi"]);
    expect(w.raised.some((card) => card.question.startsWith("Atlas a été bloqué faute de permission ou de connexion :"))).toBe(true);
    expect(lines(w)[0]!.text).toMatch(/^Nova : \d choses ont besoin de toi$/);
  });

  it("an item the person already answered is never asked or raised again while the words keep naming it", () => {
    const w = world();
    w.setNudge(false);
    w.say("work", SWEEP_ANSWER, "t1");
    settlePeerOutcome({ bot: MAIN, threadId: "work", turnId: "t1", ok: true }, w.deps);
    const first = cardsIn(w).map((row) => row.card!.askKey!);
    expect(first.length).toBeGreaterThanOrEqual(3);
    for (const key of first) w.answer(key, "Not for me");
    w.setNudge(true);
    const raisedBefore = w.raised.length;
    const nudgedBefore = w.nudged.length;
    w.say("work", SWEEP_ANSWER, "t2");
    const again = settlePeerOutcome({ bot: MAIN, threadId: "work", turnId: "t2", ok: true }, w.deps);
    // the bot is not asked again, no card is raised, no line is written
    expect(w.nudged).toHaveLength(nudgedBefore);
    expect(again).toMatchObject({ line: false });
    expect(w.raised).toHaveLength(raisedBefore);
    expect(cardsIn(w)).toHaveLength(first.length);
    expect(lines(w)).toHaveLength(1);
  });

  it("the same sweep an hour later adds nothing: its cards are replaced in place, no second line, nothing rings", () => {
    const w = world();
    const sweep = (turn: string) => {
      w.say("work", SWEEP_ANSWER, turn);
      settlePeerOutcome({ bot: MAIN, threadId: "work", turnId: turn, ok: true }, w.deps);
      w.say("work", "Nothing more.", `${turn}-ask`);
      return settlePeerOutcome({ bot: MAIN, threadId: "work", turnId: `${turn}-ask`, ok: true }, w.deps);
    };
    sweep("t1");
    const cards = (w.threads.get("main") ?? []).filter((row) => row.kind === "options").length;
    const unread = w.unread.length;
    expect(sweep("t2")).toMatchObject({ line: false });
    expect((w.threads.get("main") ?? []).filter((row) => row.kind === "options")).toHaveLength(cards);
    expect(lines(w)).toHaveLength(1);
    // the items are the ones still pending: the bot is not asked again
    expect(w.nudged).toHaveLength(1);
    expect(w.unread).toHaveLength(unread);
    expect(w.notified).toEqual([]);
  });

  it("asked once, the bot says plainly that nothing waits on the person: nothing is raised", () => {
    const w = world();
    w.say("work", SWEEP_ANSWER);
    settlePeerOutcome({ bot: MAIN, threadId: "work", turnId: "turn-1", ok: true }, w.deps);
    w.say("work", "Nothing for the person.", "turn-2");
    expect(settlePeerOutcome({ bot: MAIN, threadId: "work", turnId: "turn-2", ok: true }, w.deps)).toMatchObject({ settled: "nothing", line: false });
    expect(w.raised).toEqual([]);
  });

  it("a turn whose text says the work was refused for a permission raises the fix item even when the ask cannot start", () => {
    const w = world();
    w.setNudge(false);
    w.say("work", "Ticket bodies: refused, permission denied on service notes.");
    const result = settlePeerOutcome({ bot: MAIN, threadId: "work", turnId: "turn-1", ok: true }, w.deps);
    expect(result).toMatchObject({ settled: "asked" });
    expect(w.raised).toHaveLength(1);
    expect(w.raised[0]!.key.startsWith(PEER_PREFIX)).toBe(true);
    expect(lines(w)[0]!.peerOutcome?.items[0]?.kind).toBe("fix");
  });

  it("a turn with nothing for the person raises nothing, writes no line and rings nothing; the receipt says nothing", () => {
    const w = world();
    w.say("work", "Checked: all entries are logged and the schedule is clean.");
    expect(settlePeerOutcome({ bot: MAIN, threadId: "work", turnId: "turn-1", ok: true }, w.deps)).toMatchObject({ settled: "nothing", line: false });
    expect(w.nudged).toEqual([]);
    expect(w.raised).toEqual([]);
    expect(lines(w)).toEqual([]);
    expect(w.notified).toEqual([]);
    expect(w.unread).toEqual([]);
    expect(w.threads.get("main")!.find((row) => row.id === w.receipt.id)?.peerOutcome?.kind).toBe("nothing");
  });

  it("the person's own conversation, an AI client's and a routine run's are not settled here", () => {
    const w = world();
    w.say("main", SWEEP_ANSWER);
    expect(settlePeerOutcome({ bot: MAIN, threadId: "main", turnId: "turn-1", ok: true }, w.deps)).toMatchObject({ settled: "none", reason: "not-peer" });
    w.say("work", SWEEP_ANSWER);
    expect(settlePeerOutcome({ bot: MAIN, threadId: "work", turnId: "turn-1", ok: true, runTurn: true }, w.deps)).toMatchObject({ settled: "none", reason: "run-reports" });
  });
});

describe("backfillPeerOutcomes (#4238)", () => {
  it("surfaces each bot's exchanges that left something on the person once: keyed cards through the item card path and one grouped line", () => {
    const w = world();
    w.say("work", SWEEP_ANSWER);
    const exchanges = [{ bot: MAIN, threadId: "work" }];
    expect(backfillPeerOutcomes(exchanges, w.deps)).toBe(1);
    // read strictly, without asking the bot: the line that names the person
    // and the refusal, not the bare "stays on the day's list"
    expect(cardsIn(w)).toHaveLength(2);
    expect(cardsIn(w).every((row) => row.card!.askKey!.startsWith(PEER_PREFIX))).toBe(true);
    expect(lines(w)).toHaveLength(1);
    expect(lines(w)[0]!.text).toBe("Atlas: 2 things need you");
    expect(lines(w)[0]!.peerOutcome?.backfill).toBe(true);
    // a second start adds nothing
    expect(backfillPeerOutcomes(exchanges, w.deps)).toBe(0);
    expect(cardsIn(w)).toHaveLength(2);
    expect(lines(w)).toHaveLength(1);
  });

  it("an exchange already settled, with nothing for the person, or with only a bare skipped, is not surfaced", () => {
    const w = world();
    w.say("work", "All clean.");
    expect(backfillPeerOutcomes([{ bot: MAIN, threadId: "work" }], w.deps)).toBe(0);
    w.say("work", "Two entries skipped; to confirm later.", "turn-2");
    expect(backfillPeerOutcomes([{ bot: MAIN, threadId: "work" }], w.deps)).toBe(0);
    expect(cardsIn(w)).toEqual([]);
    expect(w.notified).toEqual([]);
  });
});

describe("#4238 review: what the person is shown is exactly what happened, written once", () => {
  it("the attention relay carried this turn's items on its card: the receipt lists them, never 'nothing', and nothing is raised or written twice", () => {
    const w = world();
    w.say("work", "- [HUMAIN] Approve the quote for the new printer.");
    const result = settlePeerOutcome({
      bot: MAIN, threadId: "work", turnId: "turn-1", ok: true,
      carried: { keyed: [], card: { messageId: "att-1", items: [{ text: "Approve the quote for the new printer." }] } },
    }, w.deps);
    expect(result).toMatchObject({ settled: "asked", line: false });
    const receipt = w.threads.get("main")!.find((row) => row.id === w.receipt.id);
    expect(receipt?.peerOutcome?.kind).toBe("asked");
    expect(receipt?.peerOutcome?.items).toEqual([{ key: expect.stringMatching(/^item:peer:/), kind: "ask", text: "Approve the quote for the new printer.", onCard: true, messageId: "att-1" }]);
    expect(w.raised).toEqual([]);
    expect(w.nudged).toEqual([]);
    expect(lines(w)).toEqual([]);
  });

  it("items the relay raised as keyed cards are the outcome: new ones make the line, kept ones are nothing new, answered ones say so", () => {
    const w = world();
    w.say("work", "- [HUMAIN] Pick the slot.");
    // an answered card of an earlier sweep
    w.threads.get("main")!.push({ id: "old", at: 0, role: "bot", kind: "options", card: { title: "q", subtitle: "Grant notes", options: [], askKey: `${PEER_PREFIX}hgrant`, answered: "Done" } } as WireMessage);
    settlePeerOutcome({
      bot: MAIN, threadId: "work", turnId: "turn-1", ok: true,
      carried: { keyed: [{ key: `${PEER_PREFIX}hslot`, text: "Pick the slot.", state: "raised" }, { key: `${PEER_PREFIX}hgrant`, text: "Grant notes", state: "kept" }] },
    }, w.deps);
    const receipt = w.threads.get("main")!.find((row) => row.id === w.receipt.id);
    expect(receipt?.peerOutcome?.items.map((item) => [item.key.slice(PEER_PREFIX.length), Boolean(item.replaced), Boolean(item.answered)])).toEqual([["hslot", false, false], ["hgrant", true, true]]);
    expect(lines(w)).toHaveLength(1);
    expect(lines(w)[0]!.text).toBe("Nova: 1 thing needs you");
  });

  it("a person who set these cards to never: nothing is asked or raised, no outcome is written", () => {
    const w = world();
    w.deps.feedback = () => "muted";
    w.setNudge(false);
    w.say("work", SWEEP_ANSWER);
    expect(settlePeerOutcome({ bot: MAIN, threadId: "work", turnId: "turn-1", ok: true }, w.deps)).toEqual({ settled: "none", reason: "muted" });
    expect(w.raised).toEqual([]);
    expect(w.nudged).toEqual([]);
    expect(w.threads.get("main")!.find((row) => row.id === w.receipt.id)?.peerOutcome).toBeUndefined();
    expect(backfillPeerOutcomes([{ bot: MAIN, threadId: "work" }], w.deps)).toBe(0);
  });

  it("the start-up back-fill raises its cards quiet and rings once per bot, with its one line", () => {
    const w = world();
    w.say("work", SWEEP_ANSWER);
    expect(backfillPeerOutcomes([{ bot: MAIN, threadId: "work" }], w.deps)).toBe(1);
    expect(cardsIn(w)).toHaveLength(2);
    expect(w.quietCalls).toEqual([true]);
    expect(w.notified).toEqual(["Atlas"]);
  });
});
