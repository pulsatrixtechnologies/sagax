// The page a message is about is kept only for the sender's own page of that
// bot; a selected passage (#4099) is kept and dropped with it, never alone.
import { describe, expect, it } from "vitest";

import { createOwnPageContext } from "./ownPageContext.ts";

const selection = { kind: "text" as const, quote: "Le volume", prefix: "", suffix: " a augmenté.", path: "body > p", tag: "p" };
const page = { pageId: "abcdefgh12345678", title: "Bilan", version: 2, selection };

function check(record: { botId: string; ownerId?: string } | undefined) {
  const host = { IDENTITY: { kind: "local" }, publishedPages: { get: () => record } };
  return createOwnPageContext(() => host) as (context: unknown, botId: string, auth: unknown) => unknown;
}

describe("ownPageContext and a selected passage (#4099)", () => {
  it("keeps the passage with the person's own page of that bot", () => {
    expect(check({ botId: "b1" })({ page }, "b1", { kind: "local" })).toEqual({ page });
  });

  it("drops it with the page for another bot's page, or a page that is not there", () => {
    expect(check({ botId: "b2" })({ page }, "b1", { kind: "local" })).toBeUndefined();
    expect(check(undefined)({ cardId: "c_1", page }, "b1", { kind: "local" })).toEqual({ cardId: "c_1" });
  });
});
