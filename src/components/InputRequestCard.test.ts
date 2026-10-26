// The question a waiting teammate asks the person, shown whole where the
// person reads (2026-10-19, bot quality cause B): never cut at 180
// characters, never a bare "Go to conversation" line, no id on screen.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/state/store", () => ({
  api: vi.fn(),
  openThread: vi.fn(),
  useStore: () => ({ state: { bots: [], groups: [] }, dispatch: () => {} }),
}));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => true }));

const { InputRequestCard } = await import("./InputRequestCard");
const { containsUuid } = await import("../../shared/human-id");

const BOT_ID = "5752d21c-e77c-4a83-84f0-66048216a5df";
const THREAD_ID = "d4eb1f10-ceef-428a-afdd-d53d1194c2e7";
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, "\"").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

describe("InputRequestCard", () => {
  it("shows the whole question, an answer box and no id", () => {
    const question = `Which repository should I tag? ${"It matters because both hold a release branch. ".repeat(8)}Reply with its name.`;
    const html = renderToStaticMarkup(createElement(InputRequestCard, {
      message: { id: "m1", role: "bot", kind: "activity", tool: { name: "x", ok: true }, inputRequest: { botId: BOT_ID, threadId: THREAD_ID, botName: "Mira", question } } as never,
    }));
    const visible = text(html);
    expect(question.length).toBeGreaterThan(180);
    expect(visible).toContain(question);
    expect(visible).toContain("Mira");
    expect(html).toContain("<textarea");
    expect(containsUuid(visible)).toBe(false);
  });

  it("says when it was answered and offers no box then", () => {
    const html = renderToStaticMarkup(createElement(InputRequestCard, {
      message: { id: "m2", role: "bot", kind: "activity", tool: { name: "x", ok: true }, inputRequest: { botId: BOT_ID, threadId: THREAD_ID, botName: "Mira", question: "Which one?", answered: true } } as never,
    }));
    expect(html).not.toContain("<textarea");
  });
});
