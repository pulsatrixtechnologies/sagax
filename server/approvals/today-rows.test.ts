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
    expect(rows[0]).toMatchObject({ kind: "attention", requestId: "attention:m1", at: 100, bulk: "question", decidable: true, scope: "mine" });
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
