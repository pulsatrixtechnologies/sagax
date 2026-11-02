import { describe, expect, it } from "vitest";

import { closeBotCatalog, initialState, openBotCatalog, reducer } from "./store";

describe("Browse Bots window (restored after lot 5)", () => {
  it("opens its own centred window", () => {
    expect(initialState.botCatalogOpen).toBe(false);
    const opened = reducer(initialState, openBotCatalog());
    expect(opened.botCatalogOpen).toBe(true);
    expect(opened.botCatalogTarget).toBeNull();
  });

  it("carries a link to Templates (and an install link), a new object each time", () => {
    const opened = reducer(initialState, openBotCatalog({ section: "templates", installUrl: "https://example.test/team" }));
    expect(opened.botCatalogOpen).toBe(true);
    expect(opened.botCatalogTarget).toEqual({ section: "templates", installUrl: "https://example.test/team" });
    const again = reducer(opened, openBotCatalog({ section: "templates" }));
    expect(again.botCatalogTarget).toEqual({ section: "templates" });
    expect(again.botCatalogTarget).not.toBe(opened.botCatalogTarget);
  });

  it("closeBotCatalog closes the window", () => {
    const opened = reducer(initialState, openBotCatalog({ section: "templates" }));
    const closed = reducer(opened, closeBotCatalog());
    expect(closed.botCatalogOpen).toBe(false);
    expect(closed.botCatalogTarget).toBeNull();
    expect(reducer(closed, closeBotCatalog())).toBe(closed);
  });
});
