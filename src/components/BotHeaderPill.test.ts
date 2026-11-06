import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { initialState, reducer, type AppState, type Bot } from "@/state/store";
import { BotChatHeader, BotHeaderPill, botPillActions } from "./BotHeaderPill";

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
  it("shows the bot without a configured Perspicax identity chip", () => {
    expect(pill(false)).not.toContain("data-perspicax-identity");
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

  it("remembers the panel when it closes and restores it when it opens", () => {
    expect(botPillActions(false)).toEqual([{ type: "restoreBotPanel" }]);
    expect(botPillActions(true)).toEqual([{ type: "rememberBotPanel" }, { type: "toggleSettings", open: false }, { type: "toggleComputer", open: false }]);
  });

  // #2149 (JC 2026-11-06): one click closes the panel, a second reopens
  // exactly the panel it closed: same tab, same content.
  describe("toggle back to the same panel", () => {
    it("reopens on the Library tab it closed on", () => {
      const opened = click(base);
      const onLibrary = reducer(opened, { type: "pickBotPanelTab", botId: "pepper", tab: "library" });
      const closed = click(onLibrary);
      expect(closed).toMatchObject({ settingsOpen: false, computerOpen: false });
      const reopened = click(closed);
      expect(reopened.settingsOpen).toBe(true);
      expect(reopened.botPanelTab).toEqual({ botId: "pepper", tab: "library" });
      expect(reopened.botPanelRestored).toBe(true);
    });

    it("reopens on the Computer tab it closed on", () => {
      const onComputer = reducer(click(base), { type: "toggleComputer", open: true });
      const reopened = click(click(onComputer));
      expect(reopened).toMatchObject({ computerOpen: true, settingsOpen: false });
    });

    it("reopens the same section, expanded as it was", () => {
      const onRoutines = reducer(base, { type: "toggleSettings", open: true, section: "routines" });
      expect(onRoutines.botSettingsExpandAccordion).toBe(true);
      const reopened = click(click(onRoutines));
      expect(reopened).toMatchObject({ settingsOpen: true, botSettingsSection: "routines", botSettingsExpandAccordion: true });
      expect(reopened.botPanelTab).toEqual({ botId: "pepper", tab: "activity" });
    });

    it("opens plainly for another bot, on Activity", () => {
      const other = { ...bot, id: "wren", name: "Wren", threadId: "t-wren" } as Bot;
      const withTwo = { ...base, bots: [bot, other] };
      const onLibrary = reducer(click(withTwo), { type: "pickBotPanelTab", botId: "pepper", tab: "library" });
      const closed = click(onLibrary);
      const elsewhere = reducer(closed, { type: "restoreBotPanel", botId: "wren" });
      expect(elsewhere).toMatchObject({ settingsOpen: true, selectedId: "wren", botPanelRestored: false });
      expect(elsewhere.botPanelTab).toBeNull();
    });

    it("lands on Activity for any opening that is not the pill's", () => {
      const onLibrary = reducer(click(base), { type: "pickBotPanelTab", botId: "pepper", tab: "library" });
      const closed = reducer(onLibrary, { type: "toggleSettings", open: false });
      const deepLink = reducer(closed, { type: "toggleSettings", open: true });
      expect(deepLink.botPanelTab).toBeNull();
    });
  });

  it("never shows a reasoning effort label under the pill", () => {
    const html = pill(false);
    expect(html).not.toContain("data-model-effort");
    expect(html).not.toContain("data-model-variant");
    expect(html).not.toMatch(/>High</);
    expect(html).not.toMatch(/>· High</);
  });
});

describe("bot chat header, like Grok Bot (#2141)", () => {
  function header(props: Partial<Parameters<typeof BotChatHeader>[0]> = {}): string {
    return renderToStaticMarkup(createElement(BotChatHeader, {
      name: "Pepper",
      label: "Research",
      panelOpen: false,
      onToggle: () => {},
      avatar: createElement("span", { "data-test-avatar": "" }),
      ...props,
    }));
  }

  it("shows only the name pill: no sharing pill, no gear (JC 2026-11-06)", () => {
    const html = header();
    expect(html).toContain("data-bot-header-pill");
    expect(html).not.toContain("data-bot-header-audience");
    expect(html).not.toContain("data-bot-header-gear");
    expect(html).not.toContain("Shared with");
    expect(html).toContain("Pepper");
    expect(html).toContain(" · Research");
    expect(html).toContain("text-[14px] font-normal");
    expect(html).not.toContain("data-bot-header-chevron");
  });

  it("leaves the label out when the bot has none", () => {
    expect(header({ label: "  " })).not.toContain("data-bot-header-label");
  });

  it("says the panel state on the name pill", () => {
    expect(header()).toContain('aria-expanded="false"');
    expect(header({ panelOpen: true })).toContain('aria-expanded="true"');
  });
});
