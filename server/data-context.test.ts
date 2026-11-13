import { describe, expect, it } from "vitest";

import { THREAD_LIMITS } from "../shared/page-threads.ts";
import { DATA_CONTEXT_DRAFT_MAX_BYTES, parseDataContext } from "./data-context.ts";

const refused = (value: unknown): number | undefined => {
  try {
    parseDataContext(value);
  } catch (error) {
    return (error as { status?: number }).status;
  }
  return undefined;
};

describe("parseDataContext", () => {
  it("accepts a card id as the sheet mints them, with an optional bounded draft", () => {
    expect(parseDataContext(undefined)).toBeUndefined();
    expect(parseDataContext(null)).toBeUndefined();
    expect(parseDataContext({ cardId: "c_12" })).toEqual({ cardId: "c_12" });
    expect(parseDataContext({ cardId: "c_1", draftSql: "select 1" })).toEqual({ cardId: "c_1", draftSql: "select 1" });
    const atTheCap = "x".repeat(DATA_CONTEXT_DRAFT_MAX_BYTES);
    expect(parseDataContext({ cardId: "c_1", draftSql: atTheCap })).toEqual({ cardId: "c_1", draftSql: atTheCap });
  });

  it("refuses anything else with a 400: a table name, a foreign field, a draft past 100 KB (in bytes)", () => {
    for (const bad of [
      { cardId: "orders" }, { cardId: "c_" }, { cardId: "c_1x" }, { cardId: 1 }, {}, "c_1", [],
      { cardId: "c_1", draftSql: 1 }, { cardId: "c_1", botId: "pepper" },
      { cardId: "c_1", draftSql: "x".repeat(DATA_CONTEXT_DRAFT_MAX_BYTES + 1) },
      // one multi-byte character over the cap, though its length is under it
      { cardId: "c_1", draftSql: `${"x".repeat(DATA_CONTEXT_DRAFT_MAX_BYTES - 1)}é` },
    ]) {
      expect(refused(bad), JSON.stringify(bad).slice(0, 60)).toBe(400);
    }
  });
});

describe("parseDataContext: the page open over the conversation (2026-10-28)", () => {
  it("accepts a page reference, alone or with a Data card, its title cut to one line", () => {
    expect(parseDataContext({ page: { pageId: "abcdefgh12345678", title: "  Bilan \n du mois ", version: 3 } })).toEqual({ page: { pageId: "abcdefgh12345678", title: "Bilan du mois", version: 3 } });
    expect(parseDataContext({ cardId: "c_2", page: { pageId: "abcdefgh12345678", title: "Bilan" } })).toEqual({ cardId: "c_2", page: { pageId: "abcdefgh12345678", title: "Bilan" } });
  });

  it("refuses a page id that is not one, a foreign field, a draft without a card", () => {
    for (const bad of [
      { page: { pageId: "../etc", title: "x" } }, { page: { pageId: "abcdefgh12345678", title: "x", owner: "y" } },
      { page: { pageId: "abcdefgh12345678", title: "x", version: 0 } }, { page: { pageId: "abcdefgh12345678" } },
      { draftSql: "select 1", page: { pageId: "abcdefgh12345678", title: "x" } },
    ]) {
      expect(refused(bad)).toBe(400);
    }
  });
});

describe("parseDataContext: a selected passage of the page (#4099)", () => {
  const ref = { pageId: "abcdefgh12345678", title: "Bilan" };
  const selection = { kind: "text", quote: "Le volume", prefix: "Septembre. ", suffix: " a augmenté.", path: "body > p", tag: "p" };

  it("accepts the annotation anchor with the page, cut by its limits", () => {
    expect(parseDataContext({ page: { ...ref, version: 2, selection } })).toEqual({ page: { ...ref, version: 2, selection } });
    const long = parseDataContext({ page: { ...ref, selection: { ...selection, quote: "x".repeat(THREAD_LIMITS.quoteChars + 50), prefix: "p".repeat(200), suffix: "line\none", tag: "P" } } });
    expect(long!.page!.selection).toEqual({ kind: "text", quote: "x".repeat(THREAD_LIMITS.quoteChars), prefix: "p".repeat(THREAD_LIMITS.contextChars), suffix: "line one", path: "body > p", tag: "p" });
  });

  it("refuses an anchor that points at nothing, or a selection without its page", () => {
    for (const bad of [
      { page: { ...ref, selection: { ...selection, quote: "   " } } },
      { page: { ...ref, selection: { ...selection, kind: "range" } } },
      { page: { ...ref, selection: { ...selection, tag: "<script>" } } },
      { page: { ...ref, selection: "Le volume" } },
      { cardId: "c_1", selection },
    ]) {
      expect(refused(bad), JSON.stringify(bad).slice(0, 80)).toBe(400);
    }
  });
});
