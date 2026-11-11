import { describe, expect, it } from "vitest";
import { attentionSettled, settlePersonRequestCard, todayRows, type TodayDeps, type TodayMessage } from "./today-rows.ts";
import type { PersonAttentionCard } from "../../shared/person-attention.ts";
import { closePersonRequest } from "./waiting-card-skip.ts";
import type { Message } from "../store.ts";
import { filterInbox, DEFAULT_INBOX_FILTERS } from "../../shared/approvals-inbox.ts";

const card = (over: Partial<PersonAttentionCard> = {}): PersonAttentionCard => ({
  kind: "needs", items: [{ text: "Approve the invoice" }], botId: "b1", botName: "Ember", threadId: "work", sourceMessageId: "src", ...over,
} as PersonAttentionCard);

function deps(messages: Record<string, TodayMessage[]>, over: Partial<TodayDeps> = {}): TodayDeps {
  const bots = [{ id: "b1", name: "Ember" }];
  return {
    bots: () => bots,
    bot: (id) => bots.find((bot) => bot.id === id),
    threads: () => [{ threadId: "conv", title: "Ember" }],
    messages: (threadId) => messages[threadId] ?? [],
    isViewers: () => true,
    proposals: () => [],
    project: (_threadId, message) => message,
    ...over,
  };
}

describe("todayRows (#2689)", () => {
  it("lists an open attention card with its age and keeps it out of bulk answers", () => {
    const rows = todayRows(deps({ conv: [{ id: "m1", at: 100, role: "bot", attention: card() }] }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "attention", requestId: "attention:m1", messageId: "m1", at: 100, bulk: "question", decidable: true, scope: "mine" });
  });

  it("drops a card the person replied after, or marked handled", () => {
    expect(todayRows(deps({ conv: [{ id: "m1", at: 100, attention: card() }, { id: "u", at: 200, role: "user" }] }))).toHaveLength(0);
    expect(todayRows(deps({ conv: [{ id: "m1", at: 100, attention: card({ handledAt: 150 }) }] }))).toHaveLength(0);
    expect(attentionSettled({ id: "m1", at: 100, attention: card() }, [{ id: "u", at: 50, role: "user" }])).toBe(false);
    // the reply went into the thread the bot asked in
    expect(todayRows(deps({ conv: [{ id: "m1", at: 100, attention: card() }], work: [{ id: "r", at: 120, role: "user" }] }))).toHaveLength(0);
  });

  it("shows nothing from a conversation that is not the viewer's", () => {
    expect(todayRows(deps({ conv: [{ id: "m1", at: 100, attention: card() }] }, { isViewers: () => false }))).toHaveLength(0);
  });

  it("lists an open proactive proposal, not an answered one", () => {
    const messages = { conv: [{ id: "p", at: 300, card: { proactiveProposal: { id: "x" } } }, { id: "q", at: 310, card: { answered: "no" } }] };
    const rows = todayRows(deps(messages, {
      proposals: () => [
        { id: "x", botId: "b1", threadId: "conv", messageId: "p", createdAt: 300 },
        { id: "y", botId: "b1", threadId: "conv", messageId: "q", createdAt: 310 },
      ],
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "proposal", proactiveId: "x", bulk: "proposal" });
    // the conversation titled with the bot's own name adds no title
    expect(rows[0]!.threadTitle).toBeUndefined();
  });

  it("the Questions filter keeps attention cards, Permissions does not", () => {
    const rows = todayRows(deps({ conv: [{ id: "m1", at: 100, attention: card() }] }));
    expect(filterInbox(rows, { ...DEFAULT_INBOX_FILTERS, kind: "question" })).toHaveLength(1);
    expect(filterInbox(rows, { ...DEFAULT_INBOX_FILTERS, kind: "permission" })).toHaveLength(0);
  });
});

/** The host's one close (waiting-card-skip.ts) on in-memory rows: what was
 * patched, and the line the waiting work heard. */
function settleDeps(messages: Record<string, TodayMessage[]>, over: Partial<TodayDeps> = {}) {
  const patched: Array<{ id: string; patch: Partial<TodayMessage> }> = [];
  const told: Array<{ work: string; text: string }> = [];
  const base = deps(messages, over);
  return {
    patched, told,
    deps: {
      ...base,
      close: (threadId: string, message: TodayMessage, quiet?: boolean) => closePersonRequest({
        patch: (id, messageId, patch) => {
          patched.push({ id: messageId, patch: patch as Partial<TodayMessage> });
          messages[id] = (messages[id] ?? []).map((row) => (row.id === messageId ? { ...row, ...(patch as Partial<TodayMessage>) } : row));
        },
        answerWork: (work, text) => { if (!quiet) told.push({ work, text }); return true; },
        noteWork: () => {},
        now: () => 500,
      }, threadId, message as unknown as Message, { kind: "handled" }),
    },
  };
}

describe("settlePersonRequestCard: marked handled (#2689, #3543)", () => {
  it("stamps handledAt once, on the viewer's own card only, and tells the waiting work", () => {
    const rows: Record<string, TodayMessage[]> = { conv: [{ id: "m1", at: 100, attention: card() }] };
    const { deps: base, patched, told } = settleDeps(rows);
    expect(settlePersonRequestCard({ ...base, isViewers: () => false }, "b1", "conv", "m1")).toBe(false);
    expect(settlePersonRequestCard(base, "b1", "conv", "missing")).toBe(false);
    expect(settlePersonRequestCard(base, "b1", "conv", "m1")).toBe(true);
    expect(patched[0]?.patch.attention?.handledAt).toBe(500);
    expect(told).toEqual([{ work: "work", text: expect.stringMatching(/marked this handled without giving an answer/) }]);
    // a second "handled" finds it closed: nothing more is said
    expect(settlePersonRequestCard(base, "b1", "conv", "m1")).toBe(false);
    expect(told).toHaveLength(1);
  });
});

describe("#3512: an input request row is a question in words of Today too", () => {
  const request = (over: Record<string, unknown> = {}) => ({ botId: "b2", threadId: "work", botName: "Ada", title: "Build", question: "Which host?", ...over });

  it("lists an open input request once, drawn as the same card, and drops it when it closes", () => {
    const rows = todayRows(deps({ conv: [{ id: "r1", at: 100, role: "bot", inputRequest: request() }] }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "attention", requestId: "attention:r1", messageId: "r1", at: 100 });
    expect((rows[0]!.message as TodayMessage).attention).toMatchObject({ kind: "question", botId: "b2", threadId: "work", items: [{ text: "Which host?" }], sourceMessageId: "r1" });
    for (const closed of [{ answered: true }, { expired: true }, { expired: true, skipped: true }, { reminder: true }]) {
      expect(todayRows(deps({ conv: [{ id: "r1", at: 100, inputRequest: request(closed) }] }))).toHaveLength(0);
    }
  });

  it("the hand-off's card and the input request of the same ask are one item, and leave together", () => {
    const ask = card({ kind: "question", threadId: "work" });
    const both: TodayMessage[] = [{ id: "c1", at: 100, attention: ask }, { id: "r1", at: 105, inputRequest: request() }];
    const rows = todayRows(deps({ conv: both }));
    expect(rows.map((row) => row.requestId)).toEqual(["attention:c1"]);
    // the work got its answer elsewhere: the card leaves with its input request
    expect(todayRows(deps({ conv: [both[0]!, { ...both[1]!, inputRequest: request({ answered: true }) }] }))).toHaveLength(0);
    // an input request of a later ask of the same work is its own item
    expect(todayRows(deps({ conv: [...both, { id: "r2", at: 100 + 11 * 60_000, inputRequest: request() }] })).map((row) => row.requestId)).toEqual(["attention:c1", "attention:r2"]);
  });

  it("marking an input request handled closes it, tells the work once, and closes the card of the same ask", () => {
    const fresh = (): Record<string, TodayMessage[]> => ({ conv: [{ id: "c1", at: 100, attention: card({ kind: "question", threadId: "work" }) }, { id: "r1", at: 105, inputRequest: request() }] });
    const first = settleDeps(fresh());
    expect(settlePersonRequestCard(first.deps, "b1", "conv", "r1")).toBe(true);
    expect(first.patched.map((row) => row.id)).toEqual(["r1", "c1"]);
    expect(first.patched[0]!.patch.inputRequest).toMatchObject({ answered: true });
    expect(first.patched[1]!.patch.attention?.handledAt).toBe(500);
    expect(first.told).toHaveLength(1);
    expect(first.told[0]!.work).toBe("work");
    // and the card handled first settles its input request, the work told once
    const second = settleDeps(fresh());
    expect(settlePersonRequestCard(second.deps, "b1", "conv", "c1")).toBe(true);
    expect(second.patched.map((row) => row.id)).toEqual(["c1", "r1"]);
    expect(second.patched[1]!.patch.inputRequest).toMatchObject({ answered: true });
    expect(second.told).toHaveLength(1);
  });
});
