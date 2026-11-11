import { describe, expect, it } from "vitest";
import { attentionSettled, markAttentionHandled, todayRows, type TodayDeps, type TodayMessage } from "./today-rows.ts";
import type { PersonAttentionCard } from "../../shared/person-attention.ts";
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

describe("markAttentionHandled", () => {
  it("stamps handledAt once, on the viewer's own card only", () => {
    const patched: PersonAttentionCard[] = [];
    const rows: TodayMessage[] = [{ id: "m1", at: 100, attention: card() }];
    const base = { ...deps({ conv: rows }), patch: (_t: string, _m: string, attention: PersonAttentionCard) => { patched.push(attention); } };
    expect(markAttentionHandled(base, "b1", "conv", "m1", 500)).toBe(true);
    expect(patched[0]?.handledAt).toBe(500);
    expect(markAttentionHandled({ ...base, isViewers: () => false }, "b1", "conv", "m1")).toBe(false);
    expect(markAttentionHandled(base, "b1", "conv", "missing")).toBe(false);
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

  it("marking an input request handled closes it, and closes the card of the same ask", () => {
    const rows: TodayMessage[] = [{ id: "c1", at: 100, attention: card({ kind: "question", threadId: "work" }) }, { id: "r1", at: 105, inputRequest: request() }];
    const cards: string[] = [];
    const requests: Array<{ id: string; answered?: boolean }> = [];
    const base = { ...deps({ conv: rows }), patch: (_t: string, id: string) => { cards.push(id); }, patchRequest: (_t: string, id: string, value: { answered?: boolean }) => { requests.push({ id, answered: value.answered }); } };
    expect(markAttentionHandled(base, "b1", "conv", "r1", 500)).toBe(true);
    expect(requests).toEqual([{ id: "r1", answered: true }]);
    expect(cards).toEqual(["c1"]);
    // and the card handled first settles its input request
    cards.length = 0;
    requests.length = 0;
    expect(markAttentionHandled(base, "b1", "conv", "c1", 500)).toBe(true);
    expect(cards).toEqual(["c1"]);
    expect(requests).toEqual([{ id: "r1", answered: true }]);
  });
});
