import { describe, expect, it, vi } from "vitest";

import { SafePointPreempts } from "../safe-point-preempt.ts";
import { cardPosted, cardSettled, postedCardWaits, PostedCardTurns, type CardTurnHandoffDeps } from "./card-turn-handoff.ts";

function world(over: Partial<CardTurnHandoffDeps> & { live?: string; tools?: number; steer?: boolean; own?: boolean } = {}) {
  const state = { live: over.live ?? "turn-1", tools: over.tools ?? 1 };
  const cut = vi.fn();
  const safePoints = new SafePointPreempts();
  const deps: CardTurnHandoffDeps = {
    liveTurn: () => state.live,
    ownFlow: () => over.own ?? false,
    engineCanSteer: () => over.steer ?? false,
    toolsRunning: () => state.tools,
    safePoints,
    cut,
    turns: new PostedCardTurns(),
  };
  return { deps, cut, safePoints, state };
}

describe("a waiting card and the turn that posted it (#3514)", () => {
  it("tells a waiting card apart from a settled one or none", () => {
    expect(postedCardWaits("ask_choice", { ok: true, messageId: "m1" })).toBe(true);
    expect(postedCardWaits("choose_page_target", { ok: true, messageId: "m1" })).toBe(true);
    // Full access answered it: the turn goes on
    expect(postedCardWaits("ask_choice", { ok: true, messageId: "m1", answered: { choice: "Yes" } })).toBe(false);
    // a publish target picked without a card
    expect(postedCardWaits("choose_page_target", { ok: true, messageId: "", auto: { id: "pages" } })).toBe(false);
    expect(postedCardWaits("ask_choice", { ok: false })).toBe(false);
    expect(postedCardWaits("show_widget", { ok: true, messageId: "m1" })).toBe(false);
  });

  it("an engine that cannot take words live ends its turn at the end of the call that posted the card", () => {
    const { deps, cut, safePoints, state } = world();
    expect(cardPosted(deps, "bot", "t", "card-1")).toBe("cut");
    // never in the middle of the posting call
    expect(cut).not.toHaveBeenCalled();
    state.tools = 0;
    safePoints.toolEnded("t", 0);
    expect(cut).toHaveBeenCalledWith("bot", "t");
  });

  it("an engine that takes words live keeps its turn when the card is posted (nothing changes for it)", () => {
    const { deps, cut, safePoints } = world({ steer: true });
    expect(cardPosted(deps, "bot", "t", "card-1")).toBe("kept");
    safePoints.toolEnded("t", 0);
    expect(cut).not.toHaveBeenCalled();
  });

  it.each(["answer", "skip", "close", "expiry"])("an %s while the turn that posted the card still runs ends that turn at once, on every engine", () => {
    const { deps, cut } = world({ steer: true, tools: 0 });
    cardPosted(deps, "bot", "t", "card-1");
    expect(cardSettled(deps, "bot", "t", "card-1")).toBe("cut");
    expect(cut).toHaveBeenCalledTimes(1);
    // settled once: a second word about the same card cuts nothing
    expect(cardSettled(deps, "bot", "t", "card-1")).toBe("none");
    expect(cut).toHaveBeenCalledTimes(1);
  });

  it("never cuts a later turn: the card's own turn already ended", () => {
    const { deps, cut, state } = world({ steer: true, tools: 0 });
    cardPosted(deps, "bot", "t", "card-1");
    state.live = "turn-2";
    expect(cardSettled(deps, "bot", "t", "card-1")).toBe("none");
    expect(cut).not.toHaveBeenCalled();
  });

  it("a turn that ended before its safe point is not cut", () => {
    const { deps, cut, safePoints, state } = world();
    cardPosted(deps, "bot", "t", "card-1");
    state.live = "turn-2";
    safePoints.toolEnded("t", 0);
    expect(cut).not.toHaveBeenCalled();
  });

  it("a routine run and a room keep their own flow", () => {
    const { deps, cut, safePoints } = world({ own: true, tools: 0 });
    expect(cardPosted(deps, "bot", "t", "card-1")).toBe("no-turn");
    safePoints.toolEnded("t", 0);
    expect(cardSettled(deps, "bot", "t", "card-1")).toBe("none");
    expect(cut).not.toHaveBeenCalled();
  });

  it("forgets a turn's cards when it ends", () => {
    const turns = new PostedCardTurns();
    turns.posted("t", "turn-1", "a");
    turns.posted("t", "turn-1", "b");
    expect(turns.settle("t", "a")).toBe("turn-1");
    turns.turnEnded("t", "turn-1");
    expect(turns.settle("t", "b")).toBeUndefined();
    expect(turns.size()).toBe(0);
    // a new turn replaces the old one's cards
    turns.posted("t", "turn-1", "a");
    turns.posted("t", "turn-2", "c");
    expect(turns.settle("t", "a")).toBeUndefined();
    expect(turns.settle("t", "c")).toBe("turn-2");
  });
});
