import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { initialState, reducer, type AppState, type Bot } from "@/state/store";
import { BotHeaderPill, botPillActions } from "./BotHeaderPill";

const bot = { id: "pepper", name: "Pepper", threadId: "t-pepper", title: "", description: "", unread: false, messages: [], color: "green" } as unknown as Bot;
const base: AppState = { ...initialState, bots: [bot], selectedId: "pepper" };

function pill(panelOpen: boolean): string {
  return renderToStaticMarkup(createElement(BotHeaderPill, {
    name: "Pepper",
    panelOpen,
    onToggle: () => {},
    avatar: createElement("span", { "data-test-avatar": "" }),
  }));
}

function click(state: AppState): AppState {
  const open = state.settingsOpen || state.computerOpen;
  return botPillActions(open).reduce(reducer, state);
}

describe("chat header bot pill", () => {
  it("shows only the chosen profile's human name, with no chip for the default", () => {
    expect(pill(false)).not.toContain("data-perspicax-identity");
    const html = renderToStaticMarkup(createElement(BotHeaderPill, { name: "Pepper", panelOpen: false, onToggle: () => {}, avatar: null, actsAs: "Service desk" }));
    expect(html).toContain("as Service desk");
    expect(html).toContain("data-perspicax-identity");
  });

  it("removes the identity chip's value when a complete bot frame returns to default", () => {
    const withIdentity = { ...base, bots: [{ ...bot, perspicaxActAs: { slug: "redacted", name: "Bot attribution" } }] };
    const cleared = reducer(withIdentity, { type: "botPatched", bot });
    expect(cleared.bots[0]!.perspicaxActAs).toBeUndefined();
  });

  it("shows the mascot, the name, then a chevron, as a button", () => {
    const html = pill(false);
    expect(html).toMatch(/^<button type="button"/);
    expect(html).toContain("data-bot-header-chevron");
    // mascot, then name, then chevron
    const avatar = html.indexOf("data-test-avatar");
    const name = html.indexOf("Pepper</span>");
    const chevron = html.indexOf("data-bot-header-chevron");
    expect(avatar).toBeGreaterThan(-1);
    expect(avatar).toBeLessThan(name);
    expect(name).toBeLessThan(chevron);
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"[^>]*data-bot-header-chevron|<svg[^>]*data-bot-header-chevron[^>]*aria-hidden="true"/);
  });

  it("says whether the panel is open and turns the chevron", () => {
    const closed = pill(false);
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).toContain(`aria-label="Open Pepper&#x27;s panel"`);
    expect(closed).not.toContain("rotate-90");
    const open = pill(true);
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain(`aria-label="Close Pepper&#x27;s panel"`);
    expect(open).toContain("rotate-90");
  });

  it("opens the bot panel, then closes it on the next click", () => {
    const opened = click(base);
    expect(opened.settingsOpen).toBe(true);
    const closed = click(opened);
    expect(closed).toMatchObject({ settingsOpen: false, computerOpen: false });
    expect(click(closed).settingsOpen).toBe(true);
  });

  it("closes the panel on its Computer tab too", () => {
    const onComputer = reducer(base, { type: "toggleComputer", open: true });
    expect(onComputer).toMatchObject({ computerOpen: true, settingsOpen: false });
    expect(click(onComputer)).toMatchObject({ settingsOpen: false, computerOpen: false });
  });

  it("dispatches open alone when closed and both closes when open", () => {
    expect(botPillActions(false)).toEqual([{ type: "toggleSettings", open: true }]);
    expect(botPillActions(true)).toEqual([{ type: "toggleSettings", open: false }, { type: "toggleComputer", open: false }]);
  });

  it("never shows a reasoning effort label under the pill", () => {
    const html = pill(false);
    expect(html).not.toContain("data-model-effort");
    expect(html).not.toContain("data-model-variant");
    expect(html).not.toMatch(/>High</);
    expect(html).not.toMatch(/>· High</);
  });
});
