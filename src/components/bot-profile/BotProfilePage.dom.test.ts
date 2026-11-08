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

const { StoreProvider, useStore } = await import("@/state/store");
const { PersonaEditorModal } = await import("../persona/PersonaEditorModal");

let dispatch: (action: Action) => void;
function Shell() {
  const { dispatch: dispatchNow } = useStore();
  dispatch = dispatchNow;
  const { bot, neighbours, routines } = fixture;
  useEffect(() => {
    dispatch({ type: "hydrate", bots: [bot, ...neighbours], groups: [], sections: [], computerControl: {} } as never);
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
    return Promise.resolve(fixture.answer(url.pathname) ?? json({ error: "not in this gallery" }, 404));
  });
  if (!("checkVisibility" in Element.prototype)) Object.defineProperty(Element.prototype, "checkVisibility", { configurable: true, value: () => true });
  if (!("scrollIntoView" in Element.prototype)) Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: () => {} });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
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

/** The hero's appearance block (mascot preview, moves, Reset/Randomize) is
 * the other branch's scope (fix/bot-appearance-scope); HelpTip and menu
 * popovers are closed surfaces, not cards of the column. */
const OUT_OF_SCOPE = "[data-mascot-hero], [aria-label][data-bot-profile-appearance], [data-bot-profile-appearance-toggle], [data-mascot-play], [data-mascot-move-list], .popover-surface, [role='dialog'], [role='menu'], [role='listbox']";
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
        await click(sub!.querySelector<HTMLElement>("[data-bot-profile-back]"), "Back");
        expect(node.querySelector(`[data-bot-profile-subpage]`)).toBeNull();
        expect(document.activeElement?.getAttribute("data-bot-profile-subpage-open"), `focus back on row ${id}`).toBe(id);
      }
    }
    // General carries the four groups of the canvas, Knowledge its work.
    expect(Array.from((await home("general")).querySelectorAll("[data-bot-profile-subpage-open]")).map((row) => row.getAttribute("data-bot-profile-subpage-open"))).toEqual(
      ["personality", "model", "beforeActing", "channels", "sharing", "accounts", "rules", "actsAlone", "voice", "advanced", "versions"],
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
      [{ tab: "stats" }, ["usage"]],
    ];
    for (const [view, ids] of views) {
      const node = await column(view);
      for (const id of ids) {
        // Who can see it (one person signs in) and Shared with (an
        // organization) stand for each other; the gallery is an organization.
        if (id === "visibility" && node.querySelector('[data-bot-profile-section="sharing"]')) continue;
        const section = node.querySelector<HTMLElement>(id === "slack" ? '[data-bot-profile-row="slack"]' : `[data-bot-profile-section="${id}"]`);
        expect(section, `section ${id} on ${viewName(view)}`).not.toBeNull();
        if (id !== "slack") {
          expect(section!.getAttribute("aria-label")?.trim(), `section ${id} is named`).toBeTruthy();
          expect(section!.querySelector("[data-settings-group], [data-settings-card], [data-bot-profile-row], section"), `section ${id} renders a card`).not.toBeNull();
        }
        seen.add(id);
      }
    }
    expect([...seen].sort()).toEqual(["access", "files", "history", "model", "permissions", "rules", "sharing", "skills", "slack", "soul", "summary", "usage", "voice", "worksOn"]);
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
