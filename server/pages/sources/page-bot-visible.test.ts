// Contract for the bot page-source gate: audience alone never opens bot state.
import { describe, expect, it } from "vitest";

import { pageBotSourceVisible } from "./page-bot-visible.ts";

describe("pageBotSourceVisible", () => {
  it("allows the owner or a person with bot.use when the bot exists", () => {
    expect(pageBotSourceVisible({ botExists: true, mayUseBot: true })).toBe(true);
  });

  it("refuses a shared-page reader who only has audience visibility", () => {
    // visibleTo().bot() would be true for default everyone; mayUseBot is false.
    expect(pageBotSourceVisible({ botExists: true, mayUseBot: false })).toBe(false);
  });

  it("refuses a missing bot even when mayUseBot is true", () => {
    expect(pageBotSourceVisible({ botExists: false, mayUseBot: true })).toBe(false);
  });
});
