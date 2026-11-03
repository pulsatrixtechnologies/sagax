import { describe, expect, it } from "vitest";

import {
  BOT_CREATION_MAX_DEPTH,
  BOT_CREATION_WINDOW_MS,
  BOT_CREATIONS_PER_HOUR,
  botCreationDepth,
  botCreationOffered,
  botCreationRefusal,
  cleanBotCreatedBy,
  createdByBotMark,
  recentBotCreations,
} from "./bot-creation.ts";

const allowed = { temporary: false, depth: 0, turnOrigin: "owner" as const, suggestion: false, cwd: false, cwdAllowed: false, recent: 0 };

describe("any bot of a person creates bots (server/bots/bot-creation.ts)", () => {
  it("lets a person's own bot create one from the owner's own request", () => {
    expect(botCreationRefusal(allowed)).toBeNull();
    expect(botCreationRefusal({ ...allowed, cwd: true, cwdAllowed: true })).toBeNull();
    expect(botCreationRefusal({ ...allowed, recent: BOT_CREATIONS_PER_HOUR - 1 })).toBeNull();
  });

  it("refuses a temporary agent", () => {
    expect(botCreationRefusal({ ...allowed, temporary: true })).toMatchObject({ status: 409, code: "temporary_agent" });
  });

  it("refuses a bot that a bot made (depth), and a mark it cannot read", () => {
    expect(BOT_CREATION_MAX_DEPTH).toBe(1);
    expect(botCreationRefusal({ ...allowed, depth: 1 })).toMatchObject({ status: 409, code: "too_deep" });
    expect(botCreationRefusal({ ...allowed, depth: Number.POSITIVE_INFINITY })).toMatchObject({ code: "too_deep" });
    expect(botCreationDepth({})).toBe(0);
    expect(botCreationDepth({ createdByBot: { botId: "a", depth: 1, at: 5 } })).toBe(1);
    // a malformed mark fails closed, never back to a person's bot
    for (const bad of [null, "x", { botId: "a" }, { botId: "a b", depth: 1, at: 1 }, { botId: "a", depth: 0, at: 1 }, { botId: "a", depth: 1.5, at: 1 }, { botId: "a", depth: 1, at: -1 }]) {
      expect(botCreationDepth({ createdByBot: bad }), JSON.stringify(bad)).toBe(Number.POSITIVE_INFINITY);
      expect(cleanBotCreatedBy(bad)).toBeNull();
    }
  });

  it("marks a new bot one level below its creator", () => {
    expect(createdByBotMark({ id: "maker" }, 10)).toEqual({ botId: "maker", depth: 1, at: 10 });
    expect(createdByBotMark({ id: "deep", createdByBot: { botId: "maker", depth: 1, at: 1 } }, 20)).toEqual({ botId: "deep", depth: 2, at: 20 });
    expect(createdByBotMark({ id: "odd", createdByBot: "broken" }, 30).depth).toBeGreaterThan(BOT_CREATION_MAX_DEPTH);
  });

  it("refuses a turn that is not the owner's own request", () => {
    expect(botCreationRefusal({ ...allowed, turnOrigin: "other" })).toMatchObject({ status: 403, code: "not_owner_turn" });
  });

  it("keeps suggestions (nobody asked) to the Primary Bot", () => {
    expect(botCreationRefusal({ ...allowed, suggestion: true })).toMatchObject({ status: 403, code: "suggestion_primary_only" });
  });

  it("refuses a working folder the owner may not choose", () => {
    expect(botCreationRefusal({ ...allowed, cwd: true, cwdAllowed: false })).toMatchObject({ status: 403, code: "permission_missing" });
  });

  it("caps bots made by bots per person per hour", () => {
    expect(botCreationRefusal({ ...allowed, recent: BOT_CREATIONS_PER_HOUR })).toMatchObject({ status: 429, code: "rate_limited" });
    const now = 10 * BOT_CREATION_WINDOW_MS;
    const mine = (at: number) => ({ owner: "me", createdByBot: { botId: "maker", depth: 1, at } });
    const bots = [
      mine(now - 1), mine(now - BOT_CREATION_WINDOW_MS + 1), // in the window
      mine(now - BOT_CREATION_WINDOW_MS), // just out
      { owner: "other", createdByBot: { botId: "maker", depth: 1, at: now } }, // someone else's
      { owner: "me" }, // a person's own bot
      { owner: "me", createdByBot: "broken" },
    ];
    expect(recentBotCreations(bots, (bot) => (bot as { owner: string }).owner === "me", now)).toBe(2);
  });

  it("offers create_bot only to a non-Primary bot that may use it", () => {
    expect(botCreationOffered({}, false)).toBe(true);
    // the Primary Bot has its own catalog entry
    expect(botCreationOffered({ chiefOfStaff: true }, false)).toBe(false);
    expect(botCreationOffered({ hidden: true }, false)).toBe(false);
    expect(botCreationOffered({ temporary: { via: "mcp" } }, false)).toBe(false);
    expect(botCreationOffered({ createdByBot: { botId: "maker", depth: 1, at: 1 } }, false)).toBe(false);
    // an owner who may only use shared bots
    expect(botCreationOffered({}, true)).toBe(false);
  });
});
