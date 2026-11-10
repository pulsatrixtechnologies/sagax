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
/** What the server answers for the bot's capabilities, servers and vault (null: the fixture's own). */
let capabilitiesAnswer: unknown = null;
let serversAnswer: unknown = null;
let vaultAnswer: unknown = null;
/** What the server answers for the bot's skills (null: the fixture's own). */
let skillsAnswer: unknown = null;
/** Who the server says the viewer is (null: no viewer, as a solo install). */
let viewerAnswer: unknown = null;

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
    dispatch({ type: "configStatus", config: { tts: { configured: false }, ...(viewerAnswer ? { viewer: viewerAnswer } : {}) } } as never);
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
    if (capabilitiesAnswer && url.pathname.endsWith("/capabilities")) return Promise.resolve(json(capabilitiesAnswer));
    if (serversAnswer && url.pathname === "/api/mcp/servers") return Promise.resolve(json(serversAnswer));
    if (vaultAnswer && url.pathname.endsWith("/credentials/list")) return Promise.resolve(json(vaultAnswer));
    if (skillsAnswer && /\/api\/bots\/[^/]+\/skills$/.test(url.pathname)) return Promise.resolve(json(skillsAnswer));
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
  capabilitiesAnswer = null;
  serversAnswer = null;
  vaultAnswer = null;
  skillsAnswer = null;
  viewerAnswer = null;
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
    expect(Array.from((await home("knowledge")).querySelectorAll("[data-bot-profile-subpage-open]")).map((row) => row.getAttribute("data-bot-profile-subpage-open"))).toEqual(["routines", "folder"]);
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
      // #3400: To review and Skills in place on Knowledge
      [{ tab: "knowledge" }, BOT_PROFILE_CARD_SECTIONS.skills],
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

// #3399: the Bot accounts card holds what this bot has, one row each with its
// control (no second MCP servers card), an empty row with "+ Add" when it has
// nothing, an Add menu whose items say what they do and that the keyboard
// walks, and the bot's vault logins (moved from Shared with, owner decision 2026-11-10).
describe("bot profile page: Bot accounts card (#3399)", () => {
  const accounts = async () => (await home("general")).querySelector<HTMLElement>('[data-settings-group="bot-profile-accounts"]')!;
  const rowLabels = (card: HTMLElement) => Array.from(card.querySelectorAll("[data-bot-profile-row] span.truncate.text-ink")).map((node) => node.textContent);
  const key = async (node: Element, which: string) => {
    await act(async () => { node.dispatchEvent(new KeyboardEvent("keydown", { key: which, bubbles: true, cancelable: true })); });
    await settle();
  };

  it("lists only what the bot has: an app or server still to connect stays in the Plugins window", async () => {
    await mount("en");
    const card = await accounts();
    const labels = rowLabels(card);
    expect(labels).toContain("Calendar");
    expect(labels).toContain("Mail");
    expect(labels, "the server still to connect").not.toContain("Github");
    expect(card.textContent).not.toContain(t("capabilities.state.toConnect"));
    expect(labels, "a skill is not an account").not.toContain("Notes");
  });

  it("one row per server with its switch in the row, and no second card or Manage in Plugins pill", async () => {
    await mount("en");
    const panel = (await home("general")).querySelector<HTMLElement>('[data-bot-profile-panel="general"]')!;
    const card = await accounts();
    expect(card.querySelector(`[role='switch'][aria-label="${t("botAccess.mcpAllow", { name: "Calendar" })}"]`), "the Calendar switch in its row").not.toBeNull();
    expect(panel.querySelectorAll(`[role='switch'][aria-label="${t("botAccess.mcpAllow", { name: "Calendar" })}"]`).length, "the server once on the tab").toBe(1);
    expect(panel.querySelector("[data-manage-in-connect-apps]")).toBeNull();
    expect(panel.textContent).not.toContain(t("connectors.tab.mcp") + t("botAccess.mcpDescription"));
    // every two-line row is the same height
    for (const row of Array.from(card.querySelectorAll<HTMLElement>("[data-bot-profile-row] > div:first-child"))) expect(row.className, row.textContent ?? "").toContain("min-h-[56px]");
  });

  it("with nothing, one empty row carries the Add pill", async () => {
    capabilitiesAnswer = { botId: "b1", engine: { kind: "claude", label: "Claude" }, items: [] };
    serversAnswer = { servers: [] };
    vaultAnswer = { items: [] };
    await mount("en");
    const card = await accounts();
    const empty = card.querySelector<HTMLElement>("[data-bot-profile-accounts-empty]");
    expect(empty, "the empty row").not.toBeNull();
    expect(empty!.textContent).toContain(t("botProfile.accounts.emptyTitle"));
    expect(empty!.textContent).toContain(t("botProfile.accounts.emptyLine"));
    expect(empty!.querySelector("[data-bot-profile-add]"), "Add in the row").not.toBeNull();
    expect(card.querySelectorAll("[data-bot-profile-add]").length, "one Add").toBe(1);
    expect(card.querySelector('[data-bot-profile-row="engine"]'), "the engine row stays").not.toBeNull();
  });

  it("the Add menu: a plus, described items, focus on the first, arrows move, Escape closes the menu only", async () => {
    await mount("en");
    const add = (await accounts()).querySelector<HTMLElement>("[data-bot-profile-add]")!;
    expect(add.querySelector("svg.lucide-plus"), "a plus before the word").not.toBeNull();
    expect(add.querySelector("svg.lucide-chevron-down"), "no chevron").toBeNull();
    await click(add, "Add");
    const menu = document.querySelector<HTMLElement>("[role='menu']")!;
    const items = Array.from(menu.querySelectorAll<HTMLElement>("[role='menuitem']"));
    expect(items.map((item) => item.getAttribute("data-bot-profile-add-item"))).toEqual(["apps", "mcp", "vault"]);
    for (const item of items) expect(item.querySelector("[data-bot-profile-add-description]")?.textContent?.trim(), item.textContent ?? "").toBeTruthy();
    expect(menu.textContent).toContain(t("botProfile.add.appsDescription"));
    expect(menu.textContent).toContain(t("botProfile.add.mcpDescription"));
    expect(document.activeElement, "focus on the first item").toBe(items[0]);
    await key(items[0]!, "ArrowDown");
    expect(document.activeElement).toBe(items[1]);
    await key(items[1]!, "End");
    expect(document.activeElement).toBe(items[2]);
    await key(items[2]!, "ArrowDown");
    expect(document.activeElement, "wraps to the first").toBe(items[0]);
    await key(items[0]!, "ArrowUp");
    expect(document.activeElement, "wraps to the last").toBe(items[2]);
    await key(items[2]!, "Home");
    expect(document.activeElement).toBe(items[0]);
    await key(items[0]!, "Escape");
    expect(document.querySelector("[role='menu']"), "the menu closed").toBeNull();
    expect(host.querySelector("[data-bot-profile-page]"), "the profile stays open").not.toBeNull();
    expect(document.activeElement, "focus back on Add").toBe(add);
    // ArrowDown on the pill opens the menu at its first item
    await key(add, "ArrowDown");
    expect(document.activeElement?.getAttribute("data-bot-profile-add-item")).toBe("apps");
  });

  it("the vault logins sit under Bot accounts, added from the Add menu, and leave Shared with", async () => {
    await mount("en");
    const card = await accounts();
    expect(rowLabels(card)).toContain("Supplier portal");
    expect(card.querySelector("[data-bot-profile-vault-remove]"), "Remove in its row").not.toBeNull();
    await click(card.querySelector<HTMLElement>("[data-bot-profile-add]"), "Add");
    await click(document.querySelector<HTMLElement>('[data-bot-profile-add-item="vault"]'), "Vault login");
    const form = card.querySelector<HTMLElement>('[data-bot-profile-row="vault-new"] [data-team-vault-form]');
    expect(form, "the login form opens in the card").not.toBeNull();
    expect(card.textContent).toContain(t("botPanel.teamVault.help", { bot: fixture.bot.name }));
    expect(document.activeElement?.getAttribute("aria-label")).toBe(t("botPanel.teamVault.name"));
    const sharing = await column({ page: "sharing" });
    expect(sharing.querySelector('[data-settings-card="bot.teamVault"]'), "no vault on Shared with").toBeNull();
  });

  it("a viewer the server would refuse sees each row's status with no switch, account choice or Use all", async () => {
    // an organization member without the tools permission (mcpServers and
    // mcpAccounts need bots.tools in shared/permissions.ts)
    viewerAnswer = { operator: false, principalId: "pr_alex", name: "Alex Example", role: "member", permissions: [] };
    // a server with two accounts would offer the account choice to a viewer who may set it
    serversAnswer = { servers: [
      { name: "mail", enabled: true, auth: "connected" },
      { name: "calendar", enabled: true, auth: "connected", accounts: [{ id: "default", auth: "connected" }, { id: "work", label: "Work", auth: "connected" }] },
    ] };
    await mount("en");
    const card = await accounts();
    const labels = rowLabels(card);
    expect(labels, "the rows stay").toContain("Calendar");
    expect(card.textContent, "each row says its state").toContain(t("capabilities.state.on"));
    expect(card.querySelector(`[role='switch'][aria-label="${t("botAccess.mcpAllow", { name: "Calendar" })}"]`), "no server switch").toBeNull();
    expect(card.querySelector("[data-mcp-account]"), "no account choice").toBeNull();
    expect(card.textContent, "no Use all").not.toContain(t("botAccess.mcpUseAll"));
  });

  it("French: the menu items and the empty row say what they do", async () => {
    capabilitiesAnswer = { botId: "b1", engine: { kind: "claude", label: "Claude" }, items: [] };
    serversAnswer = { servers: [] };
    vaultAnswer = { items: [] };
    await mount("fr");
    const card = await accounts();
    expect(card.textContent).toContain("Ce bot n'a aucun compte pour l'instant");
    await click(card.querySelector<HTMLElement>("[data-bot-profile-add]"), "Ajouter");
    const menu = document.querySelector<HTMLElement>("[role='menu']")!;
    expect(menu.textContent).toContain("Connecte une application au nom de ce bot");
    expect(menu.textContent).toContain("Connexion du coffre");
  });

  it("#3400: Knowledge shows To review first (one row per proposal, or one row when none waits), the Skills card in place, then Its work", async () => {
    await mount("en");
    skillsAnswer = {
      skills: [{ name: "weekly-report", description: "Writes the weekly status report.", enabled: true, source: "taught", warnings: [] }],
      staged: [{ id: "st1", name: "pricing-check", gist: "Compares a quote with the last three prices.", action: "create", sha256: "a".repeat(64), card: { threadId: "th1", requestId: "rq1", messageId: "m1" } }],
      library: [], assignedSkills: [],
    };
    let panel = await home("knowledge");
    const review = panel.querySelector<HTMLElement>('[data-settings-group="bot-profile-review"]')!;
    expect(review, "To review card").not.toBeNull();
    const skills = panel.querySelector<HTMLElement>("[data-skills-section]")!;
    expect(skills, "Skills card in place").not.toBeNull();
    const work = panel.querySelector<HTMLElement>('[data-settings-group="bot-profile-group-work"]')!;
    expect(review.compareDocumentPosition(skills) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(skills.compareDocumentPosition(work) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(review.querySelectorAll('[data-bot-profile-row^="review-st"]')).toHaveLength(1);
    expect(review.textContent).toContain("pricing-check");
    expect(review.querySelector("[data-bot-profile-review-allow]")).not.toBeNull();
    expect(review.querySelector("[data-bot-profile-review-deny]")).not.toBeNull();
    expect(panel.querySelector('[data-bot-profile-subpage-open="skills"]')).toBeNull();

    skillsAnswer = { skills: [], staged: [], library: [], assignedSkills: [] };
    await home("general");
    panel = await home("knowledge");
    expect(panel.querySelector("[data-bot-profile-review-empty]")?.textContent).toContain("You're all caught up");
    expect(panel.querySelector("[data-skills-empty] [data-bot-profile-add]")).not.toBeNull();
  });
});

// #3401: the tab is named Analytics and opens on the block of the reference
// app (range, Messages and Hours saved, Top users, then Usage and
// Proactivity); the cost breakdown comes after it.
describe("bot profile page: Analytics tab (#3401)", () => {
  it("names the tab Analytics, Analytique in French", async () => {
    await mount("en");
    await home("general");
    expect(host.querySelector(`[data-bot-profile-tab="stats"]`)?.textContent).toBe("Analytics");
    act(() => root.unmount());
    host.remove();
    await mount("fr");
    await home("general");
    expect(host.querySelector(`[data-bot-profile-tab="stats"]`)?.textContent).toBe("Analytique");
  });

  it("draws the analytics block before the cost breakdown", async () => {
    await mount("en");
    const panel = (await home("stats")).querySelector<HTMLElement>('[data-bot-profile-panel="stats"]')!;
    const analytics = panel.querySelector("[data-bot-analytics]");
    const breakdown = panel.querySelector("[data-bot-usage-breakdown]");
    expect(analytics, "the analytics block").not.toBeNull();
    expect(breakdown, "the cost breakdown").not.toBeNull();
    expect(analytics!.compareDocumentPosition(breakdown!) & Node.DOCUMENT_POSITION_FOLLOWING, "the breakdown follows the analytics block").toBeTruthy();
  });
});
