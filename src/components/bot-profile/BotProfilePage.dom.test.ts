// @vitest-environment happy-dom
// The bot profile page after the 2026-11-06 refonte (the owner): one column on
// every tab, every section a plain filled card in the style of General >
// Channels and Bot accounts (no border, no ring, no underlined link), every
// section of the former editor still named, and one option in one place:
// who pays, sharing, usage, changes and the Plugins link each render once
// on the whole page. Rendered on the bot editor gallery's stand-in /api, in
// an organization (sharing, payer and grants exist there), every fold open.
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { Action } from "@/state/store";
import { setLocale, t } from "@/lib/i18n";
import { setAdvancedMode } from "@/lib/interface-mode";
import { editBotFixture } from "@/gallery/edit-bot-api";
import {
  BOT_PROFILE_CARD_SECTIONS,
  BOT_PROFILE_SUBPAGES,
  BOT_PROFILE_SUBPAGE_SECTIONS,
  BOT_PROFILE_TABS,
  botProfileTabOfPage,
  type BotProfileSubPage,
  type BotProfileTab,
} from "@/lib/persona-sections";
import { openFolds } from "../settings/nested-surfaces";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("../DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false, reasonCode: "cua-driver-unavailable", message: "" } }, ready: true }),
}));

class FixtureEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor(readonly url: string) {}
  close() {}
  addEventListener() {}
  removeEventListener() {}
}

/** The classes of a bordered or linked control: none may sit inside the
 * column (docs/design/ux-reference-grokbot-cursor.md, General's cards). */
const SMELL = /(?:^|\s)(?:border-border|border-hairline(?:-\w+)?|border-\[0\.5px\]|border-accent-border|ring-border|hover:underline|underline)(?:\s|$)/;

let fixture = editBotFixture(true);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** What the server answers for the bot's Slack link (null: no answer, as a local install). */
let slackAnswer: unknown = null;
/** What the server answers for the bot's grants (null: the fixture's own). */
let grantsAnswer: unknown = null;

const { StoreProvider, useStore } = await import("@/state/store");
const { PersonaEditorModal } = await import("../persona/PersonaEditorModal");

let dispatch: (action: Action) => void;
function Shell() {
  const { dispatch: dispatchNow } = useStore();
  dispatch = dispatchNow;
  const { bot, neighbours, routines } = fixture;
  useEffect(() => {
    dispatch({ type: "hydrate", bots: [bot, ...neighbours], groups: [], sections: [], computerControl: {} } as never);
    // a server with spoken replies: the Voice sub-page has its voice rows (#3398: "Notify me" moved to General)
    dispatch({ type: "configStatus", config: { tts: { configured: false } } } as never);
    dispatch({ type: "routinesHydrated", routines, runs: [] } as never);
    dispatch({ type: "instances", instances: [{ instanceId: "claude", driverKind: "grokAgent", displayName: "Grok", snapshot: { status: "ready" }, capabilities: { browserMcp: true, computerMcp: true }, models: { default: "sonnet", options: [{ id: "sonnet", label: "Sonnet" }] } }] } as never);
    dispatch({ type: "select", id: bot.id } as never);
  }, []);
  return createElement(PersonaEditorModal);
}

let host: HTMLDivElement;
let root: Root;
const settle = async () => { for (let i = 0; i < 12; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

beforeAll(async () => {
  setAdvancedMode(true);
  vi.stubGlobal("EventSource", FixtureEventSource);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost/");
    if (slackAnswer && url.pathname.endsWith("/slack-management")) return Promise.resolve(json(slackAnswer));
    if (grantsAnswer && url.pathname.endsWith("/grants")) return Promise.resolve(json(grantsAnswer));
    return Promise.resolve(fixture.answer(url.pathname) ?? json({ error: "not in this gallery" }, 404));
  });
  if (!("checkVisibility" in Element.prototype)) Object.defineProperty(Element.prototype, "checkVisibility", { configurable: true, value: () => true });
  if (!("scrollIntoView" in Element.prototype)) Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: () => {} });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  slackAnswer = null;
  grantsAnswer = null;
});

async function mount(locale: "en" | "fr") {
  setLocale(locale);
  fixture = editBotFixture(true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root.render(createElement(StoreProvider, null, createElement(Shell))); });
  await settle();
}

async function unfold(node: HTMLElement) {
  for (let round = 0; round < 4; round += 1) {
    let opened = 0;
    await act(async () => { opened = openFolds(node); });
    await settle();
    if (!opened) break;
  }
}

type View = { tab: BotProfileTab } | { page: BotProfileSubPage };
const VIEWS: View[] = [...BOT_PROFILE_TABS.map((tab) => ({ tab })), ...BOT_PROFILE_SUBPAGES.map((page) => ({ page }))];
const viewName = (view: View) => ("tab" in view ? `tab:${view.tab}` : `page:${view.page}`);

const click = async (node: HTMLElement | null, what: string) => {
  if (!node) throw new Error(`nothing to click: ${what}`);
  await act(async () => { node.click(); });
  await settle();
};

/** The page's column on a tab's home (V6, #2612): Back out of any sub-page,
 * then the tab. */
async function home(tab: BotProfileTab): Promise<HTMLElement> {
  if (!host.querySelector("[data-persona-modal]")) {
    await act(async () => { dispatch({ type: "openPersonaEditor", botId: fixture.bot.id, section: "overview" } as never); });
    await settle();
  }
  const back = host.querySelector<HTMLElement>("[data-bot-profile-back]");
  if (back) await click(back, "Back");
  await click(host.querySelector<HTMLElement>(`[data-bot-profile-tab="${tab}"]`), `tab ${tab}`);
  const page = host.querySelector<HTMLElement>("[data-persona-modal]")!;
  expect(page.getAttribute("data-bot-profile-tab-current")).toBe(tab);
  return page.querySelector<HTMLElement>("[data-bot-profile-column]")!;
}

/** The page's column once a view is open (a tab's home, or a sub-page opened
 * from its row) and every fold is unfolded. */
async function column(view: View): Promise<HTMLElement> {
  if ("tab" in view) {
    const node = await home(view.tab);
    await unfold(node);
    return node;
  }
  const node = await home(botProfileTabOfPage(view.page));
  await click(node.querySelector<HTMLElement>(`[data-bot-profile-subpage-open="${view.page}"]`), `row ${view.page}`);
  expect(host.querySelector("[data-persona-modal]")!.getAttribute("data-bot-profile-subpage-current")).toBe(view.page);
  await unfold(node);
  return node;
}

/** What a view shows under the header: the tab's rows or the sub-page. */
const scope = (node: HTMLElement, view: View) =>
  node.querySelector<HTMLElement>("tab" in view ? `[data-bot-profile-panel="${view.tab}"]` : `[data-bot-profile-subpage="${view.page}"]`)!;

/** The mascot editor (preview, moves, character grid, Reset/Randomize),
 * now the Appearance tab, keeps its own chips and fields (the editor's
 * scope, fix/bot-appearance-scope); HelpTip and menu popovers are closed
 * surfaces, not cards of the column. Before/after captures of the
 * profile (tabs, bare mascot, condensed bar):
 * docs/screenshots/bot-profile-tabs (#2969). */
const OUT_OF_SCOPE = "[data-mascot-hero], [data-bot-profile-section='appearance'], [aria-label][data-bot-profile-appearance], [data-bot-profile-appearance-toggle], [data-mascot-play], [data-mascot-move-list], .popover-surface, [role='dialog'], [role='menu'], [role='listbox']";
const inScope = (node: Element) => !node.closest(OUT_OF_SCOPE) && !node.matches(OUT_OF_SCOPE);

const describeNode = (node: Element) => {
  const attrs = Array.from(node.attributes).filter((a) => a.name.startsWith("data-") || a.name === "aria-label").map((a) => `${a.name}="${a.value}"`).join(" ");
  const section = node.closest("[data-bot-profile-section]")?.getAttribute("data-bot-profile-section") ?? "?";
  return `${section}: <${node.tagName.toLowerCase()} ${attrs}> class="${node.className}"`;
};

describe("bot profile page V6: rows, sub-pages and plain cards", () => {
  it("every tab and sub-page is one column; no section is split in two", async () => {
    await mount("en");
    for (const view of VIEWS) {
      const node = await column(view);
      expect(node.className, viewName(view)).toMatch(/max-w-\[760px\]/);
      expect(node.querySelector("[data-bot-profile-column-side]")).toBeNull();
      expect(scope(node, view), viewName(view)).not.toBeNull();
      for (const panel of Array.from(node.querySelectorAll("[role='tabpanel']"))) expect(panel.className).not.toMatch(/grid-cols-2/);
    }
  });

  it("each row opens its sub-page (Back, title, intro) and Back returns to the row", async () => {
    await mount("en");
    for (const tab of BOT_PROFILE_TABS) {
      const rows = Array.from((await home(tab)).querySelectorAll<HTMLElement>("[data-bot-profile-subpage-open]")).map((row) => row.getAttribute("data-bot-profile-subpage-open") as BotProfileSubPage);
      for (const id of rows) {
        const node = await home(tab);
        await click(node.querySelector<HTMLElement>(`[data-bot-profile-subpage-open="${id}"]`), `row ${id}`);
        const sub = node.querySelector<HTMLElement>(`[data-bot-profile-subpage="${id}"]`);
        expect(sub, `sub-page ${id}`).not.toBeNull();
        expect(sub!.querySelector("[data-bot-profile-subpage-title]")?.textContent).toBe(t(`botProfile.v6.page.${id}.title` as never));
        expect(node.querySelector("[role='tablist']"), `no tabs on ${id}`).toBeNull();
        // #3398: the link back names the tab it returns to, and has the focus
        const back = sub!.querySelector<HTMLElement>("[data-bot-profile-back]")!;
        expect(back.textContent, `back on ${id}`).toBe(t(`botProfile.tab.${tab}` as never));
        expect(document.activeElement, `focus on Back of ${id}`).toBe(back);
        await click(sub!.querySelector<HTMLElement>("[data-bot-profile-back]"), "Back");
        expect(node.querySelector(`[data-bot-profile-subpage]`)).toBeNull();
        expect(document.activeElement?.getAttribute("data-bot-profile-subpage-open"), `focus back on row ${id}`).toBe(id);
      }
    }
    // General: the rows that open a page (the channels and the accounts are
    // cards in place, #3398; Shared with is under More), Knowledge its work.
    expect(Array.from((await home("general")).querySelectorAll("[data-bot-profile-subpage-open]")).map((row) => row.getAttribute("data-bot-profile-subpage-open"))).toEqual(
      ["personality", "model", "beforeActing", "sharing", "rules", "actsAlone", "voice", "advanced", "versions"],
    );
    expect(Array.from((await home("knowledge")).querySelectorAll("[data-bot-profile-subpage-open]")).map((row) => row.getAttribute("data-bot-profile-subpage-open"))).toEqual(["routines", "skills", "folder"]);
  });

  it("no bordered card, framed field or underlined link inside the column of any view", async () => {
    await mount("en");
    const hits: string[] = [];
    for (const view of VIEWS) {
      const panel = scope(await column(view), view);
      for (const el of Array.from(panel.querySelectorAll("*"))) {
        if (!inScope(el)) continue;
        const cls = typeof el.className === "string" ? el.className : "";
        if (SMELL.test(cls)) hits.push(`${viewName(view)} / ${describeNode(el)}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("every section of the editor is still on the page, named, as a plain card", async () => {
    await mount("en");
    const seen = new Set<string>();
    const views: Array<[View, readonly string[]]> = [
      ...BOT_PROFILE_SUBPAGES.map((page): [View, readonly string[]] => [{ page }, BOT_PROFILE_SUBPAGE_SECTIONS[page]]),
      // the cards in place; Slack is not offered by this stand-in server
      [{ tab: "general" }, BOT_PROFILE_CARD_SECTIONS.accounts],
      [{ tab: "stats" }, ["usage"]],
    ];
    for (const [view, ids] of views) {
      const node = await column(view);
      for (const id of ids) {
        // Who can see it (one person signs in) and Shared with (an
        // organization) stand for each other; the gallery is an organization.
        if (id === "visibility" && node.querySelector('[data-bot-profile-section="sharing"]')) continue;
        const section = node.querySelector<HTMLElement>(`[data-bot-profile-section="${id}"]`);
        expect(section, `section ${id} on ${viewName(view)}`).not.toBeNull();
        expect(section!.getAttribute("aria-label")?.trim(), `section ${id} is named`).toBeTruthy();
        expect(section!.querySelector("[data-settings-group], [data-settings-card], [data-bot-profile-row], section"), `section ${id} renders a card`).not.toBeNull();
        seen.add(id);
      }
    }
    expect([...seen].sort()).toEqual(["access", "files", "history", "model", "permissions", "rules", "sharing", "skills", "soul", "summary", "usage", "voice", "worksOn"]);
  });

  it("names every section and sub-page in French too", async () => {
    await mount("fr");
    const labels: string[] = [];
    for (const view of VIEWS) {
      const node = await column(view);
      for (const section of Array.from(node.querySelectorAll("[data-bot-profile-section]"))) labels.push(`${section.getAttribute("data-bot-profile-section")}=${section.getAttribute("aria-label") ?? ""}`);
    }
    const named = labels.map((label) => label.slice(label.indexOf("=") + 1));
    expect(named).toContain(t("botSettings.nav.rules"));
    expect(named).toContain(t("botSettings.nav.skills"));
    expect(named).toContain(t("botSettings.nav.history"));
    expect(labels.filter((label) => label.endsWith("="))).toEqual([]);
    expect(named).not.toContain("Skills");
    const general = await home("general");
    expect(general.textContent).toContain("Avant d'agir");
    expect(general.textContent).toContain("Comptes du bot");
  });

  it("one option in one place: who pays, sharing, usage, changes and the Plugins link render once on the whole page", async () => {
    await mount("en");
    const where = new Map<string, string[]>();
    const note = (selector: string, at: string) => where.set(selector, [...(where.get(selector) ?? []), at]);
    const selectors = [
      "[data-bot-payer]",
      "[data-bot-profile-share-open]",
      "[data-bot-profile-share]",
      "[data-bot-profile-section='usage']",
      "[data-bot-profile-section='history']",
      "[data-bot-profile-section='sharing']",
      "[data-manage-in-connect-apps]",
      "[data-sharing-permission]",
    ];
    for (const view of VIEWS) {
      const node = await column(view);
      const panel = scope(node, view);
      for (const selector of selectors) for (const el of Array.from(panel.querySelectorAll(selector))) if (inScope(el)) note(selector, viewName(view));
      if (viewName(view) === "tab:general") {
        const page = host.querySelector<HTMLElement>("[data-persona-modal]")!;
        for (const selector of selectors) for (const el of Array.from(page.querySelectorAll(selector))) if (inScope(el) && !el.closest("[data-bot-profile-panel]")) note(selector, "banner");
      }
    }
    const at = (selector: string) => where.get(selector) ?? [];
    expect(at("[data-bot-payer]"), "who pays").toEqual(["page:model"]);
    expect(at("[data-bot-profile-share-open]"), "the Manage pill of People and groups").toEqual(["page:sharing"]);
    expect(at("[data-bot-profile-share]"), "the Share button of the banner").toEqual(["banner"]);
    expect(at("[data-bot-profile-section='usage']"), "usage").toEqual(["tab:stats"]);
    expect(at("[data-bot-profile-section='history']"), "changes").toEqual(["page:versions"]);
    expect(at("[data-bot-profile-section='sharing']"), "sharing").toEqual(["page:sharing"]);
    expect(at("[data-manage-in-connect-apps]").length, "Manage in Plugins").toBeLessThanOrEqual(1);
    expect(at("[data-sharing-permission]"), "the people list lives in the Share popover only").toEqual([]);
  });
});

// #3398: General is section cards with their controls in place, as the
// reference app: the channel rows and the accounts with their Add button sit
// on the tab, a channel the server does not offer is not drawn, a sub-page
// opens with the focus on its link back, and Escape with a menu of the page
// open closes the menu only.
describe("bot profile page: General cards in place (#3398)", () => {
  const general = async () => (await home("general")).querySelector<HTMLElement>('[data-bot-profile-panel="general"]')!;

  it("draws the channel rows and the accounts with their Add button on the tab", async () => {
    await mount("en");
    const panel = await general();
    const channels = panel.querySelector<HTMLElement>('[data-settings-group="bot-profile-channels"]');
    expect(channels, "the Channels card on General").not.toBeNull();
    expect(channels!.querySelector('[data-bot-profile-row="reachMe"] [data-bot-profile-action="reachMe"]'), "Reach me with its button").not.toBeNull();
    const accounts = panel.querySelector<HTMLElement>('[data-settings-group="bot-profile-accounts"]');
    expect(accounts, "the Bot accounts card on General").not.toBeNull();
    expect(accounts!.querySelector("[data-bot-profile-add]"), "the Add button").not.toBeNull();
    expect(accounts!.querySelector('[data-bot-profile-row="engine"] [data-bot-profile-action="engine"]'), "the engine row and its Manage").not.toBeNull();
    expect(panel.textContent).not.toContain("What it can use");
    // a channel unfolds its settings under its row, in place
    await click(channels!.querySelector<HTMLElement>('[data-bot-profile-action="reachMe"]'), "Reach me");
    expect(host.querySelector("[data-bot-profile-subpage]")).toBeNull();
    expect(panel.querySelector('[data-bot-profile-row="reachMe"] [data-bot-reach-me]'), "Reach me unfolds under its row").not.toBeNull();
    // the two switches lead the Settings card
    const settings = panel.querySelector<HTMLElement>('[data-settings-group="bot-profile-group-settings"]')!;
    const switches = Array.from(settings.querySelectorAll("[role='switch']")).map((node) => node.getAttribute("aria-label"));
    expect(switches).toEqual([t("botPanel.routines.collaboratorsCreate"), t("botPanel.voice.notifyHelp")]);
  });

  it("draws no team chat row where the server offers no Slack link, and keeps it where it does", async () => {
    await mount("fr");
    const panel = await general();
    expect(panel.querySelector('[data-bot-profile-row="slack"]')).toBeNull();
    expect(panel.querySelector("[data-slack-logo]")).toBeNull();
    expect(panel.textContent).not.toContain("Non offert ici");
    act(() => root.unmount());
    host.remove();
    slackAnswer = { available: true, managementUrl: "https://admin.example.test/slack?bot=b1" };
    await mount("en");
    expect((await general()).querySelector('[data-bot-profile-row="slack"] [data-bot-profile-action="slack"]')).not.toBeNull();
  });

  it("moves the switches out of Routines and Voice: each option in one place", async () => {
    await mount("en");
    const routines = await column({ page: "routines" });
    expect(Array.from(routines.querySelectorAll("[role='switch']")).map((node) => node.getAttribute("aria-label"))).not.toContain(t("botPanel.routines.collaboratorsCreate"));
    expect(routines.textContent).not.toContain(t("botPanel.routines.collaboratorsCreate"));
    const voice = await column({ page: "voice" });
    expect(voice.querySelector(`[role='switch'][aria-label="${t("botPanel.voice.notifyHelp")}"]`)).toBeNull();
  });

  it("Escape with the Add menu open closes the menu and leaves the profile open", async () => {
    await mount("en");
    const add = (await general()).querySelector<HTMLElement>("[data-bot-profile-add]")!;
    await click(add, "Add");
    expect(document.querySelector("[role='menu']"), "the Add menu").not.toBeNull();
    await act(async () => {
      add.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    await settle();
    expect(document.querySelector("[role='menu']"), "the menu closed").toBeNull();
    expect(host.querySelector("[data-bot-profile-page]"), "the profile stays open").not.toBeNull();
    // a second Escape, with nothing open, closes the profile as before
    await act(async () => {
      add.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    await settle();
    expect(host.querySelector("[data-bot-profile-page]")).toBeNull();
  });

  it("Escape in a pill list inside Share closes the list only, then Share only, then the profile", async () => {
    // the viewer may change the grant: its level is a pill list
    grantsAnswer = { grants: [{ target: "user:pr_sam", kind: "user", label: "Sam Example", level: "use" }], administer: { any: true, teamIds: [], maxLevel: "manage", canAdd: true } };
    await mount("en");
    await home("general");
    const share = host.querySelector<HTMLElement>("[data-bot-profile-share]")!;
    await click(share, "Share");
    expect(share.getAttribute("aria-expanded"), "Share open").toBe("true");
    const level = document.querySelector<HTMLElement>('[data-grant="user:pr_sam"] [aria-haspopup="listbox"]');
    await click(level, "grant level");
    expect(document.querySelector("[role='listbox']"), "the level list").not.toBeNull();
    const escape = async (node: Element) => {
      await act(async () => { node.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
      await settle();
    };
    await escape(document.querySelector("[role='listbox'] [role='option']") ?? document.querySelector("[role='listbox']")!);
    expect(document.querySelector("[role='listbox']"), "the list closed").toBeNull();
    expect(share.getAttribute("aria-expanded"), "Share stays open").toBe("true");
    expect(host.querySelector("[data-bot-profile-page]")).not.toBeNull();
    await escape(level!);
    expect(share.getAttribute("aria-expanded"), "Share closed").toBe("false");
    expect(host.querySelector("[data-bot-profile-page]"), "the profile stays open").not.toBeNull();
    await escape(share);
    expect(host.querySelector("[data-bot-profile-page]"), "nothing open: Escape closes the profile").toBeNull();
  });

  it("a search for a switch that moved opens General at the Settings card, not Voice or Routines", async () => {
    await mount("en");
    const search = async (value: string) => {
      if (!host.querySelector("[data-persona-search]")) await click(host.querySelector<HTMLElement>("[data-bot-profile-search-toggle]"), "search");
      const input = host.querySelector<HTMLInputElement>("[data-persona-search]")!;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      await act(async () => {
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await settle();
      return host.querySelector<HTMLElement>("[data-bot-profile-page]")!;
    };
    for (const [query, label] of [["notifications", t("botPanel.voice.notifyHelp")], ["alerts", t("botPanel.voice.notifyHelp")], ["collaborators", t("botPanel.routines.collaboratorsCreate")]] as const) {
      await home("knowledge");
      const page = await search(query);
      expect(page.getAttribute("data-bot-profile-tab-current"), query).toBe("general");
      expect(page.getAttribute("data-bot-profile-subpage-current"), `${query}: no sub-page`).toBeNull();
      const settings = page.querySelector<HTMLElement>('[data-settings-group="bot-profile-group-settings"]')!;
      const hit = settings.querySelector<HTMLElement>("[data-settings-search-hit]");
      expect(hit?.textContent, `${query}: the switch is marked`).toContain(label);
    }
  });

  it("a search for routines opens Knowledge > Routines, and a short or generic query does not jump to General", async () => {
    await mount("en");
    const search = async (value: string) => {
      if (!host.querySelector("[data-persona-search]")) await click(host.querySelector<HTMLElement>("[data-bot-profile-search-toggle]"), "search");
      const input = host.querySelector<HTMLInputElement>("[data-persona-search]")!;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      await act(async () => {
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await settle();
      return host.querySelector<HTMLElement>("[data-bot-profile-page]")!;
    };
    await home("general");
    const page = await search("routines");
    expect(page.getAttribute("data-bot-profile-tab-current")).toBe("knowledge");
    expect(page.getAttribute("data-bot-profile-subpage-current")).toBe("routines");
    for (const query of ["a", "m", "r", "me", "ion", "rate", "create", "créer"]) {
      await home("knowledge");
      const settings = (await search(query)).querySelector<HTMLElement>('[data-settings-group="bot-profile-group-settings"] [data-settings-search-hit]');
      expect(settings, `${query}: no switch of General is marked`).toBeNull();
    }
    for (const query of ["create", "créer"]) {
      await home("knowledge");
      expect((await search(query)).getAttribute("data-bot-profile-tab-current"), `${query} stays off General`).not.toBe("general");
    }
  });

  it("a link to the channels or the accounts opens the General tab at its card, no sub-page", async () => {
    await mount("en");
    await home("knowledge");
    await act(async () => { dispatch({ type: "personaEditorSection", section: "access" } as never); });
    await settle();
    const page = host.querySelector<HTMLElement>("[data-bot-profile-page]")!;
    expect(page.getAttribute("data-bot-profile-tab-current")).toBe("general");
    expect(page.getAttribute("data-bot-profile-subpage-current")).toBeNull();
    expect(page.querySelector('[data-settings-group="bot-profile-accounts"]')).not.toBeNull();
  });
});
