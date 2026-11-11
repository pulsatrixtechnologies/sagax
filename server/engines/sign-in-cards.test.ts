import { describe, expect, it, vi } from "vitest";
import type { WireMessage } from "../../shared/wire.ts";
import { createSignInCards, isOneShotSignInCard, ONE_SHOT_CARDS_SINCE } from "./sign-in-cards.ts";

const at = ONE_SHOT_CARDS_SINCE + 86_400_000;
const card = (botId: string, extra: Partial<WireMessage> = {}, access: Record<string, unknown> = {}): WireMessage => ({
  id: `card-${botId}-${extra.at ?? at}`, at, role: "bot", kind: "access",
  access: { reason: "no_access", cause: "sign_in_expired", engine: "Claude", botId, ownerPrincipalId: "p1", payerPrincipalId: "p1", subscriptionSignIn: true, ...access },
  ...extra,
} as WireMessage);

function world(threads: Record<string, WireMessage[]>, opts: { works?: boolean; instance?: string } = {}) {
  const bots = new Map(Object.keys(threads).map((threadId) => [threadId.replace(/^t-/, ""), threadId]));
  const removed: string[] = [];
  const withdrawn: unknown[] = [];
  const cards = createSignInCards({
    accessCards: () => Object.entries(threads).flatMap(([threadId, messages]) => messages.filter((m) => m.kind === "access").map((message) => ({ threadId, message }))),
    messagesFor: (threadId) => threads[threadId] ?? [],
    mainThreadOf: (botId) => bots.get(botId) ?? null,
    accountOf: () => ({ instanceId: opts.instance ?? "claude", driverKind: "claudeAgent" }),
    remove: (threadId, messageId) => {
      const list = threads[threadId] ?? [];
      const index = list.findIndex((m) => m.id === messageId);
      if (index === -1) return false;
      list.splice(index, 1);
      removed.push(messageId);
      return true;
    },
    withdrawNotice: (notice) => { withdrawn.push(notice); },
    signInWorks: vi.fn(() => opts.works !== false),
  });
  return { cards, removed, withdrawn };
}

describe("sign-in cards (#3551)", () => {
  it("tells a background card from a turn's by what is stored", () => {
    const person = { id: "u1", at: at - 5_000, role: "user", kind: "text", text: "hi" } as WireMessage;
    const turnRow = { id: "r1", at: at - 60_000, role: "bot", kind: "text", text: "...", turnId: "turn-1" } as WireMessage;
    const old = { id: "o1", at: at - 3_600_000, role: "user", kind: "text", text: "earlier" } as WireMessage;
    expect(isOneShotSignInCard(card("b1"), [old, card("b1")], true)).toBe(true);
    // right after the person's message or the turn's own rows: a turn's card
    expect(isOneShotSignInCard(card("b1"), [person, card("b1")], true)).toBe(false);
    expect(isOneShotSignInCard(card("b1"), [turnRow, card("b1")], true)).toBe(false);
    // what only a turn writes on its card or row
    expect(isOneShotSignInCard(card("b1", { requestMessageId: "u1" }), [], true)).toBe(false);
    expect(isOneShotSignInCard(card("b1", { turnId: "turn-1" }), [], true)).toBe(false);
    expect(isOneShotSignInCard(card("b1", {}, { routine: true }), [], true)).toBe(false);
    // a task thread, or before #3533 shipped
    expect(isOneShotSignInCard(card("b1"), [], false)).toBe(false);
    expect(isOneShotSignInCard(card("b1", { at: ONE_SHOT_CARDS_SINCE - 1 }), [], true)).toBe(false);
  });

  it("the start cleanup removes the background cards of every bot and leaves a turn's true card", () => {
    const threads: Record<string, WireMessage[]> = {};
    for (let i = 0; i < 34; i += 1) threads[`t-b${i}`] = [card(`b${i}`)];
    const person = { id: "u1", at: at - 2_000, role: "user", kind: "text", text: "hi" } as WireMessage;
    const turnCard = card("b0", { id: "turn-card", at, requestMessageId: "u1" });
    threads["t-b0"]!.unshift(person);
    threads["t-b0"]!.push(turnCard);
    const { cards, removed, withdrawn } = world(threads);
    expect(cards.cleanupAtStart()).toBe(33);
    // b0's background card came right after the person spoke: it reads as a turn's and stays
    expect(removed).not.toContain("turn-card");
    expect(threads["t-b0"]!.map((m) => m.id)).toContain("turn-card");
    expect(threads["t-b5"]).toEqual([]);
    expect(withdrawn).toHaveLength(33);
    expect(withdrawn[0]).toMatchObject({ threadId: "t-b1", botId: "b1", personIds: ["p1"] });
  });

  it("the start cleanup keeps a background card whose sign-in really is refused", () => {
    const threads: Record<string, WireMessage[]> = { "t-b1": [card("b1")] };
    const { cards, removed } = world(threads, { works: false });
    expect(cards.cleanupAtStart()).toBe(0);
    expect(removed).toEqual([]);
  });

  it("a later successful call closes an open sign-in card on every bot of that account", () => {
    const threads: Record<string, WireMessage[]> = {
      "t-b1": [card("b1", { requestMessageId: "u1" })],
      "t-b2": [card("b2", { requestMessageId: "u2" })],
    };
    const { cards, removed, withdrawn } = world(threads);
    // another person's account, or another engine, closes nothing
    expect(cards.signedIn("p2", { instanceId: "claude" })).toBe(0);
    expect(cards.signedIn("p1", { instanceId: "codex" })).toBe(0);
    expect(cards.signedIn("P1", { instanceId: "claude" })).toBe(2);
    expect(removed).toHaveLength(2);
    expect(withdrawn).toHaveLength(2);
    // a card written after the index was read closes too; a renew names only the driver
    const later = card("b1", { id: "later" });
    threads["t-b1"]!.push(later);
    cards.noted("t-b1", later);
    expect(cards.signedIn("p1", { driverKind: "claudeAgent" })).toBe(1);
    expect(cards.signedIn("p1", { instanceId: "claude" })).toBe(0);
  });
});
