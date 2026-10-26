import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ shown: true, hide: vi.fn() }));
vi.mock("@/lib/panel-visibility", () => ({ useShowSuggestions: () => fixture.shown, setShowSuggestions: fixture.hide }));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => false }));
vi.mock("@/state/store", () => ({
  api: vi.fn(),
  openBotThread: vi.fn(),
  useStore: () => ({ state: {}, dispatch: vi.fn() }),
}));

import { SuggestionsSection } from "./SuggestionsSection";
import type { Bot } from "@/state/store";

const bot = { id: "b1", name: "Pepper", tasks: [{ threadId: "t1", title: "Deploy", activity: "waiting-on-you" }] } as unknown as Bot;

describe("SuggestionsSection", () => {
  it("draws the card while the global preference is on", () => {
    fixture.shown = true;
    const html = renderToStaticMarkup(createElement(SuggestionsSection, { bot, routineCount: 0 }));
    expect(html).toContain("data-suggestions-hide");
    expect(html).toContain('data-suggestion="approval:t1"');
  });

  it("draws nothing for any bot once the preference is off", () => {
    fixture.shown = false;
    expect(renderToStaticMarkup(createElement(SuggestionsSection, { bot, routineCount: 0 }))).toBe("");
    expect(renderToStaticMarkup(createElement(SuggestionsSection, { bot: { ...bot, id: "b2" } as Bot, routineCount: 0 }))).toBe("");
  });

  it("Hide sets the one global preference, not a per-bot flag", () => {
    const source = readFileSync(new URL("./SuggestionsSection.tsx", import.meta.url), "utf8");
    expect(source).toContain("onClick={() => setShowSuggestions(false)}");
    expect(source).not.toContain("hideSuggestions");
  });
});
