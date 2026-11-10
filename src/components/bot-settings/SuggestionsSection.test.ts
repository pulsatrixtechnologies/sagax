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

import { SuggestionsCard, SuggestionsSection } from "./SuggestionsSection";
import type { Bot } from "@/state/store";

const bot = { id: "b1", name: "Pepper", tasks: [{ threadId: "t1", title: "Deploy", activity: "waiting-on-you" }] } as unknown as Bot;

describe("SuggestionsSection", () => {
  it("draws the card while the global preference is on", () => {
    fixture.shown = true;
    const html = renderToStaticMarkup(createElement(SuggestionsSection, { bot, routineCount: 0, slackUrl: "https://admin.example.test/slack?bot=b1" }));
    // the bot panel's card has Hide, and Add to Slack where the server offers its link
    expect(html).toContain("data-suggestions-hide");
    expect(html).toContain('data-suggestion="approval:t1"');
    expect(html).toContain('data-suggestion="slack"');
    expect(html).toContain("data-slack-logo");
  });

  // #3398: Slack as a channel is removed for now; without the server's link
  // Add to Slack cannot work, so it is not drawn (it used to open a Slack
  // page that has nothing to offer).
  it("draws no Add to Slack when the server offers no Slack link", () => {
    fixture.shown = true;
    const html = renderToStaticMarkup(createElement(SuggestionsSection, { bot, routineCount: 0, slackUrl: null }));
    expect(html).toContain('data-suggestion="approval:t1"');
    expect(html).not.toContain('data-suggestion="slack"');
    expect(html).not.toContain("data-slack-logo");
  });

  it("draws nothing for any bot once the preference is off", () => {
    fixture.shown = false;
    expect(renderToStaticMarkup(createElement(SuggestionsSection, { bot, routineCount: 0 }))).toBe("");
    expect(renderToStaticMarkup(createElement(SuggestionsSection, { bot: { ...bot, id: "b2" } as Bot, routineCount: 0 }))).toBe("");
  });

  it("clicking Hide turns the preference off (the Settings switch reads the same one)", () => {
    fixture.hide.mockClear();
    const tree = SuggestionsCard({ headingId: "h", panel: true, rows: [{ id: "slack", title: "Add to Slack" }] }) as any;
    const header = tree.props.children[0];
    const button = [header.props.children].flat().find((c: any) => c?.props?.["data-suggestions-hide"] !== undefined);
    button.props.onClick();
    expect(fixture.hide).toHaveBeenCalledWith(false);
  });

  it("Hide sets the one global preference, not a per-bot flag", () => {
    const source = readFileSync(new URL("./SuggestionsSection.tsx", import.meta.url), "utf8");
    expect(source).toContain("onClick={() => setShowSuggestions(false)}");
    expect(source).not.toContain("hideSuggestions");
  });
});
