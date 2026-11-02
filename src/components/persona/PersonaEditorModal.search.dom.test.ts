// @vitest-environment happy-dom
// Edit bot search (2026-10-29): a box under "Edit bot" in the rail, with the
// mechanism of Settings' search. A word leads to the page that holds it (French
// or English), the page hides the rows that do not match, and the keys work:
// slash or Command-F to the field, Escape clears, arrows choose, Enter scrolls.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot } from "@/state/store";
import { setLocale } from "@/lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixture = vi.hoisted(() => ({
  section: "overview",
  listeners: new Set<() => void>(),
  dispatch: (() => {}) as (action: unknown) => void,
}));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
vi.mock("@/lib/perspicax-org", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/perspicax-org")>()),
  usePerspicaxOrg: () => ({ identity: { kind: "perspicax" } }),
  useOrgPeople: () => new Map(),
}));
vi.mock("../bot-settings/useSlackManagement", () => ({ useSlackManagementUrl: () => null }));
vi.mock("../bot-settings/useBotSettingsDerived", () => ({
  useBotSettingsDerived: () => ({ botRoutines: [], patch: vi.fn(), activeState: "idle", mascotMotion: null }),
}));
// Each body is a page with two settings rows, so the filter has something to hide.
const page = (name: string, a: string, b: string) => () =>
  createElement("div", { "data-section-body": name },
    createElement("div", { "data-settings-row": `${name}-a` }, a),
    createElement("div", { "data-settings-row": `${name}-b` }, b));
vi.mock("../bot-settings/OverviewSection", () => ({ OverviewSection: page("overview", "Summary of the bot", "Prompt preview") }));
vi.mock("../bot-settings/SoulSection", () => ({ SoulSection: page("soul", "Standing instructions", "Tone") }));
vi.mock("../bot-settings/SkillsSection", () => ({ SkillsSection: page("skills", "Skill list", "Teach a skill") }));
vi.mock("../bot-settings/MemorySection", () => ({ MemorySection: page("memory", "Memory", "Topics") }));
vi.mock("../bot-settings/RulesSection", () => ({ RulesSection: page("rules", "Rules", "Never") }));
vi.mock("../bot-settings/WorkspaceFilesSection", () => ({ WorkspaceFilesSection: page("files", "Files", "Upload") }));
vi.mock("../bot-settings/AccessSection", () => ({ AccessSection: page("access", "Tool selection", "Webhooks") }));
vi.mock("../computer/WorksOnSetting", () => ({ WorksOnSetting: page("worksOn", "Where it works", "Browser") }));
vi.mock("../bot-settings/ModelSection", () => ({ ModelSection: page("model", "Effort", "Provider") }));
vi.mock("../bot-settings/PermissionsSection", () => ({ PermissionsSection: page("permissions", "Auto approve", "Peers") }));
vi.mock("../bot-settings/VoiceSection", () => ({ VoiceSection: page("voice", "Speak replies", "Alerts") }));
vi.mock("../bot-settings/PerspicaxSection", () => ({ PerspicaxSection: page("perspicax", "Profiles", "MCP tools") }));
vi.mock("../bot-settings/SharingSection", () => ({ SharingSection: page("sharing", "Teams", "Level") }));
vi.mock("../bot-settings/VisibilitySection", () => ({ VisibilitySection: page("visibility", "Admins only", "People") }));
vi.mock("../bot-settings/HistorySection", () => ({ HistorySection: page("history", "Undo", "Log") }));
vi.mock("../bot-settings/UsageSection", () => ({ UsageSection: page("usage", "Tokens", "Cost") }));
vi.mock("../BotProfileAvatarCard", () => ({ BotProfileAvatarCard: page("avatar", "Avatar", "Name") }));
vi.mock("../appearance/AppearancePane", () => ({ AppearancePane: page("appearance", "Mascot gallery", "Upload a picture") }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  const { useReducer, useEffect } = await import("react");
  return {
    ...original,
    useStore: () => {
      const [, tick] = useReducer((n: number) => n + 1, 0);
      useEffect(() => {
        fixture.listeners.add(tick);
        return () => void fixture.listeners.delete(tick);
      }, []);
      const bot = { id: "pepper", threadId: "t", name: "Pepper", title: "R", description: "", notifications: true, color: "green", unread: false, messages: [], tasks: [], soul: "x", modelSelection: { instanceId: "claude", model: "opus" } } as unknown as Bot;
      return {
        state: { ...original.initialState, bots: [bot], personaEditor: { botId: "pepper", section: fixture.section } } as unknown as AppState,
        dispatch: fixture.dispatch,
        flushBotPatches: vi.fn(async () => null),
      };
    },
  };
});

const { PersonaEditorModal } = await import("./PersonaEditorModal");

let host: HTMLElement;
let root: Root;
const input = () => host.querySelector<HTMLInputElement>("[data-persona-search]")!;
const pagesInRail = () => [...host.querySelectorAll("[data-persona-page]")].map((el) => el.getAttribute("data-persona-page"));
const currentPage = () => host.querySelector("[data-persona-pane]")!.getAttribute("data-persona-current");

function type(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function key(target: Element | Window, k: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
  act(() => void target.dispatchEvent(event));
  return event;
}

beforeEach(() => {
  setLocale("en");
  fixture.section = "overview";
  fixture.listeners.clear();
  fixture.dispatch = (action) => {
    const a = action as { type: string; section?: string };
    if (a.type === "personaEditorSection" && a.section) {
      fixture.section = a.section;
      for (const listener of fixture.listeners) listener();
    }
  };
  Element.prototype.scrollIntoView = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement(PersonaEditorModal)));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Edit bot search", () => {
  it("sits under the title and lists every page when empty", () => {
    expect(host.querySelector("#persona-editor-title")!.textContent).toContain("Edit bot");
    const nav = host.querySelector("[data-persona-nav]")!;
    expect(nav.firstElementChild!.contains(input())).toBe(true);
    expect(pagesInRail().length).toBeGreaterThan(10);
  });

  it("leads a word to its page, in English and in French", () => {
    type("mascot");
    expect(pagesInRail()).toEqual(["appearance"]);
    expect(currentPage()).toBe("appearance");
    type("mascotte");
    expect(pagesInRail()).toEqual(["appearance"]);
    type("moteur");
    expect(pagesInRail()[0]).toBe("model");
    expect(pagesInRail()).not.toContain("overview");
    expect(currentPage()).toBe("model");
    type("engine");
    expect(pagesInRail()[0]).toBe("model");
    expect(pagesInRail()).not.toContain("overview");
    expect(currentPage()).toBe("model");
    type("approbation");
    expect(currentPage()).toBe("permissions");
    type("MCP");
    expect(pagesInRail()).toEqual(expect.arrayContaining(["access", "perspicax"]));
    type("voix");
    expect(currentPage()).toBe("voice");
    type("horaire");
    expect(pagesInRail()).toEqual(expect.arrayContaining(["voice", "permissions"]));
  });

  it("hides the rows that do not match on the open page and marks the first", () => {
    type("effort");
    const rows = [...host.querySelectorAll("[data-persona-section=model] [data-settings-row]")];
    expect(rows.map((row) => row.hasAttribute("data-settings-search-miss"))).toEqual([false, true]);
    expect(rows[0]!.hasAttribute("data-settings-search-hit")).toBe(true);
    expect(host.querySelector("[data-settings-search-hits]")!.textContent).toContain("Effort");
    type("");
    expect(host.querySelector("[data-settings-search-miss]")).toBeNull();
  });

  it("says so when nothing matches", () => {
    type("zzzxq");
    expect(pagesInRail()).toEqual([]);
    expect(host.querySelector("[data-persona-no-match]")!.textContent).toBe("Nothing matches “zzzxq”");
    setLocale("fr");
    act(() => root.render(createElement(PersonaEditorModal)));
    expect(host.querySelector("[data-persona-no-match]")!.textContent).toBe("Rien ne correspond à « zzzxq »");
  });

  it("goes to the field with a slash or Command-F, but not while typing", () => {
    const outside = document.createElement("div");
    key(host.querySelector("[data-persona-editor]")!, "/");
    expect(document.activeElement).toBe(input());
    outside.remove();
    input().blur();
    key(host.querySelector("[data-persona-editor]")!, "f", { metaKey: true });
    expect(document.activeElement).toBe(input());
    const slash = key(input(), "/");
    expect(slash.defaultPrevented).toBe(false);
  });

  it("clears with Escape, then lets Escape close the editor", () => {
    type("voix");
    const first = key(input(), "Escape");
    expect(input().value).toBe("");
    expect(first.cancelBubble).toBe(true);
    const second = key(input(), "Escape");
    expect(second.cancelBubble).toBe(false);
  });

  it("chooses a result with the arrows and scrolls to the match with Enter", () => {
    type("mcp");
    const results = pagesInRail();
    expect(results.length).toBeGreaterThan(1);
    const start = currentPage();
    key(input(), "ArrowDown");
    expect(currentPage()).toBe(results[(results.indexOf(start) + 1) % results.length]);
    key(input(), "ArrowUp");
    expect(currentPage()).toBe(start);
    // Profiles holds a row with "MCP"; Enter scrolls to it.
    while (currentPage() !== "perspicax") key(input(), "ArrowDown");
    (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();
    key(input(), "Enter");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
});
