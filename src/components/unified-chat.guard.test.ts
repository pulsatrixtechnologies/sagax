// @vitest-environment happy-dom
// Guard (JC 2026-11-06): in the unified chat, the default, nothing in the bot's
// chat sends the person elsewhere. No "Go to conversation", no "Open thread",
// no thread sheet: a "Sent work to Katarina · Done" card had a "Go to
// conversation Katarina" line under it. Everything stays in the bot's chat.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { SHOW_THREADS_DEFAULT } from "@/lib/thread-preferences";
import { ConversationLink } from "./ConversationLink";
import { GotoGroupChip } from "./GotoGroupChip";

vi.mock("@/lib/thread-preferences", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/thread-preferences")>(),
  useShowThreads: () => false,
}));

beforeAll(() => setLocale("en"));

describe("unified chat guard", () => {
  it("keeps threads off by default", () => {
    expect(SHOW_THREADS_DEFAULT).toBe(false);
  });

  it("draws no Go to conversation line under a delegation", () => {
    const html = renderToStaticMarkup(createElement(ConversationLink, {
      bot: { name: "Katarina", color: "pink" }, name: "Katarina", color: "pink", onClick: () => {},
    }));
    expect(html).toBe("");
    expect(html).not.toMatch(/Go to conversation|Open thread/);
  });

  it("draws no grouped Go to conversation chip", () => {
    const html = renderToStaticMarkup(createElement(GotoGroupChip, {
      group: { kind: "gotoGroup", id: "g", targets: [], messages: [] }, bots: [],
    } as never));
    expect(html).toBe("");
  });
});
