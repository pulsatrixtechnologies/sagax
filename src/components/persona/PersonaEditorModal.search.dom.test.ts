// @vitest-environment happy-dom
// Bot profile search (#2126): the Settings tab of the bot's profile page keeps
// the editor's search. A word keeps the sections that hold it (French or
// English) and opens the first, that section hides the rows that do not match,
// and the keys work: slash or Command-F to the field from any tab, Escape
// clears, then lets Escape close the page.
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
vi.mock("@/lib/capabilities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/capabilities")>()),
  useBotCapabilities: () => ({ data: null, error: null, loading: true, reload: vi.fn() }),
}));
vi.mock("@/lib/bot-inbound-mail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/bot-inbound-mail")>()),
  useBotInboundMailState: () => [null, vi.fn()],
}));
vi.mock("@/lib/reach-me", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/reach-me")>()),
  useReachMe: () => [null, vi.fn()],
}));
vi.mock("@/lib/mac-messages-setup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mac-messages-setup")>()),
  loadMessagesSetup: async () => null,
}));
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
// "Notify me" is General's switch (#3398): the page draws it from VoiceSection's NotifyMeRow.
vi.mock("../bot-settings/VoiceSection", () => ({
  VoiceSection: page("voice", "Speak replies", "Alerts"),
  NotifyMeRow: () => createElement("div", { "data-settings-row": "notify-me" }, "Notify me"),
}));
vi.mock("../bot-settings/SharingSection", () => ({ SharingSection: page("sharing", "Teams", "Level") }));
vi.mock("../bot-settings/VisibilitySection", () => ({ VisibilitySection: page("visibility", "Admins only", "People") }));
vi.mock("../bot-settings/HistorySection", () => ({ HistorySection: page("history", "Undo", "Log") }));
vi.mock("../bot-settings/BotAnalyticsSection", () => ({ BotAnalyticsSection: page("usage", "Tokens", "Cost") }));
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
        state: { ...original.initialState, bots: [bot], selectedId: "pepper", personaEditor: { botId: "pepper", section: fixture.section } } as unknown as AppState,
        dispatch: fixture.dispatch,
        flushBotPatches: vi.fn(async () => null),
      };
    },
  };
});

const { PersonaEditorModal } = await import("./PersonaEditorModal");

const actions: string[] = [];
let host: HTMLElement;
let root: Root;
const input = () => host.querySelector<HTMLInputElement>("[data-persona-search]")!;
// One tab per setting (#2173): the page says which it shows.
const selectedTab = () => host.querySelector("[data-bot-profile-tab-current]")!.getAttribute("data-bot-profile-tab-current");
const shownTab = () => host.querySelector('[data-bot-profile-tab][aria-selected="true"]')!.getAttribute("data-bot-profile-tab");
const toggle = () => host.querySelector<HTMLElement>("[data-bot-profile-search-toggle]")!;
// The tabs the query leads to, best first is the one shown; the others stay plain.
const matching = () => [...host.querySelectorAll("[data-bot-profile-tab][data-bot-profile-tab-match]")].map((el) => el.getAttribute("data-bot-profile-tab"));
// The sections on view: the Appearance fold of the header and the cards of the tab or sub-page shown (#2271, #2612).
const opened = () => [...host.querySelectorAll('#bot-profile-appearance[data-open], [data-bot-profile-panel]:not([hidden]) [data-bot-profile-section][data-open], [data-bot-profile-subpage] [data-bot-profile-section][data-open]')].map((el) => el.getAttribute("data-bot-profile-section"));

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
async function frame() {
  await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

beforeEach(() => {
  setLocale("en");
  fixture.section = "overview";
  fixture.listeners.clear();
  actions.length = 0;
  fixture.dispatch = (action) => {
    const a = action as { type: string; section?: string };
    actions.push(a.type);
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
  setLocale("en");
});

describe("bot profile settings search", () => {
  it("opens from the magnifier beside the tabs, under them, and dims no tab while empty", () => {
    // #4147: no Appearance tab; a link to Appearance lands on its sub-page of
    // General, and Back returns to General, where the magnifier sits beside the tabs
    expect(shownTab()).toBe("general");
    expect(host.querySelector('[data-bot-profile-tab="appearance"]')).toBeNull();
    act(() => fixture.dispatch({ type: "personaEditorSection", section: "appearance" }));
    expect(selectedTab()).toBe("general");
    expect(host.querySelector("[data-persona-modal]")!.getAttribute("data-bot-profile-subpage-current")).toBe("appearance");
    expect(opened()).toContain("appearance");
    act(() => host.querySelector<HTMLElement>("[data-bot-profile-back]")!.click());
    expect(shownTab()).toBe("general");
    expect(host.querySelector('[data-bot-profile-tab="appearance"]')).toBeNull();
    expect(host.querySelector("[data-persona-search]")).toBeNull();
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    act(() => toggle().click());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector("[data-bot-profile-search] [data-persona-search]")).toBe(input());
    expect(matching()).toEqual([]);
    expect(host.querySelector("[data-bot-profile-tab].opacity-40")).toBeNull();
    // the magnifier again puts it away
    act(() => toggle().click());
    expect(host.querySelector("[data-persona-search]")).toBeNull();
  });
  it("shows the tab that holds a word, in English and in French, and marks the tabs that do", () => {
    act(() => toggle().click());
    type("mascot");
    // the mascot is on General's Appearance sub-page (#4147): General is the match, opened on it
    expect(selectedTab()).toBe("general");
    expect(matching()).toEqual(["general"]);
    expect(opened()).toContain("appearance");
    expect(host.querySelector("[data-persona-modal]")!.getAttribute("data-bot-profile-subpage-current")).toBe("appearance");
    expect(host.querySelector('[data-bot-profile-tab="knowledge"]')!.classList.contains("opacity-40")).toBe(true);
    type("effort");
    // V6 (#2612): the Model sub-page sits on General, opened by the search
    expect(selectedTab()).toBe("general");
    expect(matching()[0]).toBe("general");
    expect(opened()).toContain("model");
    expect(host.querySelector("[data-persona-modal]")!.getAttribute("data-bot-profile-subpage-current")).toBe("model");
    expect(host.querySelector('[data-bot-profile-tab="general"]')!.classList.contains("opacity-40")).toBe(false);
    act(() => setLocale("fr"));
    act(() => root.render(createElement(PersonaEditorModal)));
    type("modèle");
    expect(selectedTab()).toBe("general");
  });
  it("hides the rows that do not match on the tab shown and marks the first", () => {
    act(() => toggle().click());
    type("effort");
    const rows = [...host.querySelectorAll('[data-bot-profile-section="model"] [data-settings-row]')];
    expect(rows.map((row) => row.hasAttribute("data-settings-search-miss"))).toEqual([false, true]);
    expect(rows[0]!.hasAttribute("data-settings-search-hit")).toBe(true);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    type("");
    expect(host.querySelector("[data-settings-search-miss]")).toBeNull();
  });
  it("says so when nothing matches, and stays on the tab shown", () => {
    act(() => toggle().click());
    type("zzzxq");
    expect(matching()).toEqual([]);
    expect(selectedTab()).toBe("general");
    expect(host.querySelector("[data-persona-no-match]")!.textContent).toBe("Nothing matches “zzzxq”");
  });
  it("opens the field with a slash or Command-F from any tab, but not while typing", async () => {
    act(() => host.querySelector<HTMLElement>('[data-bot-profile-tab="knowledge"]')!.click());
    expect(selectedTab()).toBe("knowledge");
    const event = key(document.body, "f", { metaKey: true });
    expect(event.defaultPrevented).toBe(true);
    await frame();
    expect(selectedTab()).toBe("knowledge");
    expect(document.activeElement).toBe(input());
    const slash = key(input(), "/");
    expect(slash.defaultPrevented).toBe(false);
  });
  it("clears with Escape, then puts the field away, then lets Escape close the page", () => {
    act(() => toggle().click());
    type("effort");
    const first = key(input(), "Escape");
    expect(input().value).toBe("");
    expect(first.cancelBubble).toBe(true);
    expect(actions).not.toContain("closePersonaEditor");
    key(input(), "Escape");
    expect(host.querySelector("[data-persona-search]")).toBeNull();
    expect(actions).not.toContain("closePersonaEditor");
    // the search left the Model sub-page open: Escape goes Back first
    key(host.querySelector("[data-bot-profile-page]")!, "Escape");
    expect(host.querySelector("[data-bot-profile-subpage]")).toBeNull();
    expect(actions).not.toContain("closePersonaEditor");
    key(host.querySelector("[data-bot-profile-page]")!, "Escape");
    expect(actions).toContain("closePersonaEditor");
  });
});
