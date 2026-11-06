// @vitest-environment happy-dom
// The bot profile page after the 2026-11-06 refonte (JC): one column on
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
import { BOT_PROFILE_TABS, BOT_PROFILE_TAB_SECTIONS } from "@/lib/persona-sections";
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

/** The page's column once its tab is open and every fold is unfolded. */
async function column(tab: (typeof BOT_PROFILE_TABS)[number]): Promise<HTMLElement> {
  const first = BOT_PROFILE_TAB_SECTIONS[tab][0]!;
  await act(async () => { dispatch({ type: "openPersonaEditor", botId: fixture.bot.id, section: first }); });
  await settle();
  const page = host.querySelector<HTMLElement>("[data-persona-modal]");
  if (!page) throw new Error(`no profile page for tab ${tab}`);
  expect(page.getAttribute("data-bot-profile-tab-current")).toBe(tab);
  const node = page.querySelector<HTMLElement>("[data-bot-profile-column]");
  if (!node) throw new Error(`no column for tab ${tab}`);
  await unfold(node);
  return node;
}

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

describe("bot profile page: one column of plain cards", () => {
  it("every tab is one column; no section is split in two", async () => {
    await mount("en");
    for (const tab of BOT_PROFILE_TABS) {
      const node = await column(tab);
      expect(node.className).toMatch(/max-w-\[820px\]/);
      expect(node.querySelector("[data-bot-profile-column-side]")).toBeNull();
      for (const panel of Array.from(node.querySelectorAll("[role='tabpanel']"))) expect(panel.className).not.toMatch(/grid-cols-2/);
    }
  });

  it("no bordered card, framed field or underlined link inside the column of any tab", async () => {
    await mount("en");
    const hits: string[] = [];
    for (const tab of BOT_PROFILE_TABS) {
      const node = await column(tab);
      const panel = node.querySelector<HTMLElement>(`[data-bot-profile-panel="${tab}"]`);
      if (!panel) throw new Error(`no panel for tab ${tab}`);
      for (const el of Array.from(panel.querySelectorAll("*"))) {
        if (!inScope(el)) continue;
        const cls = typeof el.className === "string" ? el.className : "";
        if (SMELL.test(cls)) hits.push(`${tab} / ${describeNode(el)}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("every section of the editor is still on the page, named, as a plain card", async () => {
    await mount("en");
    const seen = new Set<string>();
    for (const tab of BOT_PROFILE_TABS) {
      const node = await column(tab);
      for (const id of BOT_PROFILE_TAB_SECTIONS[tab]) {
        // Slack is a row of General's Channels card, the others a card each.
        // Who can see it (one person signs in) and Shared with (an
        // organization) stand for each other; the gallery is an organization.
        if (id === "visibility" && node.querySelector('[data-bot-profile-section="sharing"]')) continue;
        const section = node.querySelector<HTMLElement>(id === "slack" ? '[data-bot-profile-row="slack"]' : `[data-bot-profile-section="${id}"]`);
        expect(section, `section ${id} on tab ${tab}`).not.toBeNull();
        if (id !== "slack") {
          expect(section!.getAttribute("aria-label")?.trim(), `section ${id} is named`).toBeTruthy();
          expect(section!.querySelector("[data-settings-group], [data-settings-card], [data-bot-profile-row], section"), `section ${id} renders a card`).not.toBeNull();
        }
        seen.add(id);
      }
    }
    expect([...seen].sort()).toEqual(["access", "files", "history", "model", "permissions", "rules", "sharing", "skills", "slack", "soul", "summary", "usage", "voice", "worksOn"]);
  });

  it("names every section in French too", async () => {
    await mount("fr");
    const labels: string[] = [];
    for (const tab of BOT_PROFILE_TABS) {
      const node = await column(tab);
      for (const section of Array.from(node.querySelectorAll("[data-bot-profile-section]"))) labels.push(`${section.getAttribute("data-bot-profile-section")}=${section.getAttribute("aria-label") ?? ""}`);
    }
    const named = labels.map((label) => label.slice(label.indexOf("=") + 1));
    expect(named).toContain(t("botSettings.nav.rules"));
    expect(named).toContain(t("botSettings.nav.skills"));
    expect(named).toContain(t("botSettings.nav.history"));
    expect(labels.filter((label) => label.endsWith("="))).toEqual([]);
    expect(named).not.toContain("Skills");
  });

  it("one option in one place: who pays, sharing, usage, changes and the Plugins link render once on the whole page", async () => {
    await mount("en");
    // A tab's panel mounts when shown (Knowledge stays mounted for its
    // drafts), so each panel is counted on its own tab and the banner once.
    const where = new Map<string, string[]>();
    const note = (selector: string, panel: string) => where.set(selector, [...(where.get(selector) ?? []), panel]);
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
    for (const tab of BOT_PROFILE_TABS) {
      const node = await column(tab);
      const panel = node.querySelector<HTMLElement>(`[data-bot-profile-panel="${tab}"]`)!;
      for (const selector of selectors) for (const el of Array.from(panel.querySelectorAll(selector))) if (inScope(el)) note(selector, tab);
      if (tab === "general") {
        const page = host.querySelector<HTMLElement>("[data-persona-modal]")!;
        for (const selector of selectors) for (const el of Array.from(page.querySelectorAll(selector))) if (inScope(el) && !el.closest("[data-bot-profile-panel]")) note(selector, "banner");
      }
      // The payer row never comes back in Model & tools (it was under the model chip).
      if (tab === "tools") expect(panel.textContent).not.toContain(t("botModel.paidBy", { value: "" }).trim());
    }
    const at = (selector: string) => where.get(selector) ?? [];
    expect(at("[data-bot-payer]"), "who pays").toEqual(["general"]);
    expect(at("[data-bot-profile-share-open]"), "the Manage pill of People and groups").toEqual(["general"]);
    expect(at("[data-bot-profile-share]"), "the Share button of the banner").toEqual(["banner"]);
    expect(at("[data-bot-profile-section='usage']"), "usage").toEqual(["analytics"]);
    expect(at("[data-bot-profile-section='history']"), "changes").toEqual(["activity"]);
    expect(at("[data-bot-profile-section='sharing']"), "sharing").toEqual(["general"]);
    expect(at("[data-manage-in-connect-apps]").length, "Manage in Plugins").toBeLessThanOrEqual(1);
    expect(at("[data-sharing-permission]"), "the people list lives in the Share popover only").toEqual([]);
  });
});
