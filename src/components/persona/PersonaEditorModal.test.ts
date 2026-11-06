// The bot editor is the bot's profile page (#2126, #2173, #2271, Grok
// Bot's layout) in the main panel: its top is the bot's appearance (the
// banner, the mascot, the name with its label under it, the description and
// the colour, edited in place, the Appearance pane unfolding under them),
// then four pill tabs at most, each a page of cards in two columns (one
// under 900px). Every section of the former editor is still there, on its
// tab; locked sections are shown with their reason instead of hidden.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot, BotSettingsSection } from "@/state/store";
import { setLocale } from "@/lib/i18n";
import { CIRCLE_CLOSE_BUTTON, CIRCLE_LABEL } from "@/lib/circle-button";

const fixture = vi.hoisted(() => ({
  state: {} as Partial<AppState>,
  advanced: true,
  perspicax: null as unknown,
  dispatch: (() => {}) as (action: unknown) => void,
  slackUrl: null as string | null,
  capabilities: null as unknown,
  mail: null as unknown,
  reach: null as unknown,
}));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => fixture.advanced, setAdvancedMode: () => {} }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
vi.mock("@/lib/perspicax-org", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/perspicax-org")>()),
  usePerspicaxOrg: () => fixture.perspicax,
  useOrgPeople: () => new Map(),
}));
vi.mock("../bot-settings/useSlackManagement", () => ({ useSlackManagementUrl: () => fixture.slackUrl }));
vi.mock("@/lib/capabilities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/capabilities")>()),
  useBotCapabilities: () => ({ data: fixture.capabilities, error: null, loading: fixture.capabilities === null, reload: vi.fn() }),
}));
vi.mock("@/lib/bot-inbound-mail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/bot-inbound-mail")>()),
  useBotInboundMailState: () => [fixture.mail, vi.fn()],
}));
vi.mock("@/lib/reach-me", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/reach-me")>()),
  useReachMe: () => [fixture.reach, vi.fn()],
}));
vi.mock("@/lib/mac-messages-setup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mac-messages-setup")>()),
  loadMessagesSetup: async () => null,
}));
vi.mock("../bot-settings/SlackSection", () => ({ SlackSection: marker("slack") }));
vi.mock("../bot-settings/BotEmailAddress", () => ({ BotEmailAddress: marker("email") }));
vi.mock("../bot-settings/BotReachMe", () => ({ BotReachMe: marker("reachMe") }));
vi.mock("../bot-settings/useBotSettingsDerived", () => ({
  useBotSettingsDerived: () => ({ botRoutines: [], patch: vi.fn(), activeState: "idle", mascotMotion: null }),
}));
// Section bodies are the bot panel's own components; each one is replaced
// by a marker so the test reads which body a category mounts.
const marker = (name: string) => () => createElement("div", { "data-section-body": name });
vi.mock("../bot-settings/OverviewSection", () => ({ OverviewSection: marker("overview") }));
vi.mock("../bot-settings/SoulSection", () => ({ SoulSection: marker("soul") }));
vi.mock("../bot-settings/SkillsSection", () => ({ SkillsSection: marker("skills") }));
vi.mock("../bot-settings/MemorySection", () => ({ MemorySection: marker("memory") }));
vi.mock("../bot-settings/RulesSection", () => ({ RulesSection: marker("rules") }));
vi.mock("../bot-settings/WorkspaceFilesSection", () => ({ WorkspaceFilesSection: marker("files") }));
vi.mock("../bot-settings/AccessSection", () => ({ AccessSection: marker("access") }));
vi.mock("../computer/WorksOnSetting", () => ({ WorksOnSetting: marker("worksOn") }));
vi.mock("../bot-settings/ModelSection", () => ({ ModelSection: marker("model") }));
vi.mock("../bot-settings/PermissionsSection", () => ({ PermissionsSection: marker("permissions") }));
vi.mock("../bot-settings/VoiceSection", () => ({ VoiceSection: marker("voice") }));
vi.mock("../bot-settings/SharingSection", () => ({ SharingSection: marker("sharing") }));
vi.mock("../bot-settings/VisibilitySection", () => ({ VisibilitySection: marker("visibility") }));
vi.mock("../bot-settings/HistorySection", () => ({ HistorySection: marker("history") }));
vi.mock("../bot-settings/UsageSection", () => ({ UsageSection: marker("usage") }));
vi.mock("../appearance/AppearancePane", () => ({ AppearancePane: marker("appearance") }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({
      state: { ...original.initialState, ...fixture.state },
      dispatch: fixture.dispatch,
      flushBotPatches: vi.fn(async () => null),
    }),
  };
});

const { PersonaEditorModal } = await import("./PersonaEditorModal");
const { BOT_PROFILE_TABS, BOT_PROFILE_TAB_SECTIONS, KNOWLEDGE_SECTIONS, botProfileTabFor, personaCategoryForSection } = await import("@/lib/persona-sections");

const bot = {
  id: "pepper", threadId: "t", name: "Pepper", title: "Research", description: "Finds sources.", notifications: true,
  color: "green", unread: false, messages: [], tasks: [], soul: "Be brief.",
  modelSelection: { instanceId: "claude", model: "opus" },
} as unknown as Bot;
const other = { ...bot, id: "other", name: "Other" } as Bot;

function render(section: BotSettingsSection, state: Partial<AppState> = {}) {
  fixture.state = { bots: [bot, other], personaEditor: { botId: bot.id, section }, ...state };
  return renderToStaticMarkup(createElement(PersonaEditorModal));
}

const memberConfig = {
  viewer: { role: "member", principalId: "pr_me", operator: false },
} as unknown as AppState["config"];

beforeEach(() => {
  setLocale("en");
  fixture.advanced = true;
  fixture.perspicax = { identity: { kind: "perspicax" } };
  fixture.dispatch = vi.fn();
  fixture.slackUrl = null;
  fixture.capabilities = null;
  fixture.mail = null;
  fixture.reach = null;
  vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });
});
afterEach(() => vi.unstubAllGlobals());

/** The markup of one folded section, up to the next one. */
function sectionHtml(html: string, id: string): { open: boolean; html: string } {
  const start = html.indexOf(`data-bot-profile-section="${id}"`);
  if (start < 0) return { open: false, html: "" };
  const next = html.indexOf("data-bot-profile-section=", start + 1);
  const chunk = html.slice(start, next < 0 ? undefined : next);
  return { open: /^data-bot-profile-section="\w+" data-persona-section="\w+" data-open=""/.test(chunk), html: chunk };
}
const sectionsOf = (html: string) => [...html.matchAll(/data-bot-profile-section="(\w+)"/g)].map((match) => match[1]);
const bodiesOf = (html: string) => [...html.matchAll(/data-section-body="(\w+)"/g)].map((match) => match[1]);
// The page says which tab it shows (#2173: one tab per setting).
const selectedTab = (html: string) => /data-bot-profile-tab-current="(\w+)"/.exec(html)?.[1];
const tabsOf = (html: string) => [...html.matchAll(/data-bot-profile-tab="(\w+)"/g)].map((match) => match[1]);

const TABS_ALL = ["general", "knowledge", "tools", "activity"];
const TABS_SIMPLE = ["general", "knowledge", "tools"];
/** The index of a marker in the page, -1 when absent. */
const at = (html: string, marker: string) => html.indexOf(marker);

describe("bot profile page shell", () => {
  it("fills the main panel with the appearance header on top and four tabs at most (#2271)", () => {
    const html = render("overview");
    expect(html).toContain('data-bot-profile-placement="main"');
    expect(html).not.toContain("data-detail-panel");
    expect(html).toContain('data-bot-profile-visibility="private"');
    expect(html).toContain("data-slack-logo");
    expect(html).toContain("data-bot-profile-page");
    expect(html).not.toContain('aria-modal="true"');
    expect(html).not.toContain("data-bot-profile-banner");
    expect(html).toContain('data-bot-profile-hero=""');
    expect(html).toContain("data-bot-profile-audience");
    expect(tabsOf(html)).toEqual(TABS_ALL);
    expect(BOT_PROFILE_TABS).toEqual(TABS_ALL);
    expect(html).toContain('role="tablist"');
    for (const label of [">General<", ">Knowledge<", ">Model &amp; tools<", ">Activity<", ">Appearance"]) expect(html).toContain(label);
    // no chevron rows of settings, no Settings fold, no identity card of facts
    expect(html).not.toContain("data-bot-profile-settings-toggle");
    expect(html).not.toContain(">Settings<");
    expect(html).not.toContain(">Identity<");
    expect(selectedTab(html)).toBe("general");
    expect(html).toContain('aria-label="Close"');
  });

  it("regression #2271: the header (name, label, description, colour, Appearance) comes before the tabs, the tabs are four at most, the panels two columns from 900px", () => {
    const html = render("overview");
    const tabs = at(html, 'data-bot-profile-tabs=""');
    expect(tabs).toBeGreaterThan(0);
    for (const marker of ['data-bot-profile-title=""', 'data-bot-profile-label=""', 'data-bot-profile-description=""', 'data-bot-profile-colors=""', 'data-bot-profile-appearance-toggle=""']) {
      expect(at(html, marker)).toBeGreaterThan(0);
      expect(at(html, marker)).toBeLessThan(tabs);
    }
    expect(tabsOf(html).length).toBeLessThanOrEqual(4);
    // the name alone on its line, the label under it, smaller and secondary (JC, never "Name · Label")
    const title = html.slice(at(html, 'data-bot-profile-title=""'), at(html, 'data-bot-profile-label=""'));
    expect(title).toContain(">Pepper<");
    expect(title).not.toContain("Research");
    expect(title).not.toContain(">·<");
    const label = html.slice(at(html, 'data-bot-profile-label=""'), at(html, 'data-bot-profile-audience'));
    expect(label).toContain(">Research<");
    expect(label).toContain("text-ink-secondary");
    expect(label).toContain("text-[15px]");
    // the description and the colour, edited in place
    expect(html).toMatch(/<textarea[^>]*data-bot-profile-description=""[^>]*>Finds sources\.<\/textarea>/);
    expect(html).toMatch(/role="radiogroup" [^>]*data-bot-profile-colors=""/);
    expect(html).toContain('data-mascot-color="green"');
    expect(html).toMatch(/data-mascot-color="green"[^>]*aria-checked="true"|aria-checked="true"[^>]*data-mascot-color="green"/);
    // each tab is a panel of two responsive columns
    for (const tab of TABS_ALL) {
      const panel = html.slice(at(html, `id="bot-profile-panel-${tab}"`), at(html, `id="bot-profile-panel-${tab}"`) + 400);
      expect(panel).toContain('role="tabpanel"');
      expect(panel).toContain("grid-cols-1");
      expect(panel).toContain("min-[900px]:grid-cols-2");
      expect(panel).not.toContain("overflow-x-auto");
    }
    // the tab row wraps instead of scrolling sideways
    expect(html).toMatch(/role="tablist" data-bot-profile-tabs="" [^>]*class="[^"]*flex-wrap/);
    expect(html).not.toContain("overflow-x-auto whitespace-nowrap");
  });

  it("unfolds the Appearance pane under the header, from its pill, the mascot or a link", () => {
    const rest = render("overview");
    expect(rest).toContain('data-bot-profile-appearance-toggle="" aria-expanded="false"');
    expect(rest).not.toContain('data-section-body="appearance"');
    const html = render("appearance");
    expect(selectedTab(html)).toBe("general");
    expect(html).toContain('data-bot-profile-appearance-toggle="" aria-expanded="true"');
    expect(sectionHtml(html, "appearance").open).toBe(true);
    expect(bodiesOf(sectionHtml(html, "appearance").html)).toEqual(["appearance"]);
    expect(at(html, 'id="bot-profile-appearance"')).toBeLessThan(at(html, 'data-bot-profile-tabs=""'));
    expect(tabsOf(html)).not.toContain("appearance");
  });

  it("carries no gear: the bot's settings are its tabs and the bot panel's (#2173)", () => {
    for (const page of ["overview", "appearance", "model"] as const) {
      const html = render(page);
      expect(html).not.toContain("lucide-settings");
      expect(html).not.toContain("data-bot-header-gear");
      expect(html).not.toContain("data-bot-panel-gear");
    }
  });

  it("regression #2313: the header is the mascot hero card, the bot's name and label where the character's name was, Appearance where Randomize was", () => {
    const html = render("overview");
    const hero = at(html, 'data-bot-profile-hero=""');
    expect(hero).toBeGreaterThan(0);
    // the hero card itself (tinted stage, big mascot), no banner nor small avatar card
    expect(html.slice(hero)).toContain("data-mascot-hero");
    expect(html).not.toContain("data-bot-profile-banner");
    expect(html).not.toContain("-mt-[40px]");
    // name (28px), label under it, then the Appearance button, all inside the hero, before who sees it
    const heading = at(html, "data-mascot-heading");
    expect(heading).toBeGreaterThan(hero);
    const title = at(html, 'data-bot-profile-title=""');
    const label = at(html, 'data-bot-profile-label=""');
    const toggle = at(html, 'data-bot-profile-appearance-toggle=""');
    const audience = at(html, "data-bot-profile-audience");
    expect(heading).toBeLessThan(title);
    expect(title).toBeLessThan(label);
    expect(label).toBeLessThan(toggle);
    expect(toggle).toBeLessThan(audience);
    expect(html).toMatch(/<h2 id="bot-profile-title" data-bot-profile-title="" class="[^"]*text-\[28px\]/);
    // Play a move stays, Randomize leaves the header for the Appearance section
    expect(html.slice(hero, audience)).not.toContain("data-mascot-randomize");
    expect(html.slice(toggle, html.indexOf("</button>", toggle))).toContain(">Appearance<");
    // nothing lost under it: who sees it, the description, the colour
    for (const marker of ["data-bot-profile-audience", 'data-bot-profile-description=""', 'data-bot-profile-colors=""']) expect(at(html, marker)).toBeGreaterThan(toggle);
    // the column 1100px at most (two columns) with a 16px gutter on a phone
    expect(html).toMatch(/data-bot-profile-column="" class="mx-auto flex w-full max-w-\[1100px\] flex-col px-4 pb-10 sm:px-6"/);
  });

  it("regression #2313: X and Private / Shared sit on a bar above the scroll, never scrolled away", () => {
    const html = render("overview");
    const bar = at(html, "data-bot-profile-topbar");
    const scroll = at(html, 'data-bot-profile-scroll=""');
    expect(bar).toBeGreaterThan(0);
    expect(bar).toBeLessThan(scroll);
    const barHtml = html.slice(bar, scroll);
    expect(barHtml).toContain("data-window-close");
    expect(barHtml).toContain("data-bot-profile-visibility");
    expect(barHtml).toContain("content-topbar");
    expect(barHtml).toContain("bg-app");
    expect(barHtml).not.toContain("absolute");
  });

  it("names the tabs, the header and the channels in French", () => {
    setLocale("fr");
    const html = render("overview");
    for (const label of [">Général<", ">Connaissances<", ">Modèle et outils<", ">Activité<", ">Apparence", ">Canaux<", ">Comptes du bot<", ">Courriel<", ">Me joindre<"]) expect(html).toContain(label);
    expect(html).not.toContain(">Réglages<");
  });

  it("renders nothing when closed or when the bot is gone", () => {
    fixture.state = { bots: [bot], personaEditor: null };
    expect(renderToStaticMarkup(createElement(PersonaEditorModal))).toBe("");
    fixture.state = { bots: [other], personaEditor: { botId: "pepper", section: "overview" } };
    expect(renderToStaticMarkup(createElement(PersonaEditorModal))).toBe("");
  });

  it("opens a link on the tab that holds its section, shown in place", () => {
    expect(botProfileTabFor("overview")).toBe("general");
    expect(botProfileTabFor("appearance")).toBe("general");
    expect(botProfileTabFor("slack")).toBe("general");
    expect(botProfileTabFor("summary")).toBe("general");
    expect(botProfileTabFor("soul")).toBe("knowledge");
    expect(botProfileTabFor("memory")).toBe("knowledge");
    expect(botProfileTabFor("model")).toBe("tools");
    expect(botProfileTabFor("history")).toBe("activity");
    expect(personaCategoryForSection("routines")).toBeNull();
    for (const page of ["model", "voice", "usage", "access"] as const) {
      const html = render(page);
      const tab = botProfileTabFor(page);
      expect(selectedTab(html)).toBe(tab);
      expect(html).toContain(`data-bot-profile-tab="${tab}" aria-selected="true"`);
      expect(sectionHtml(html, page).open).toBe(true);
      expect(bodiesOf(sectionHtml(html, page).html)).toEqual([page]);
      // the tab's other sections are on the same page, as cards
      for (const id of BOT_PROFILE_TAB_SECTIONS[tab]) expect(sectionsOf(html)).toContain(id);
    }
    const soul = render("soul");
    expect(selectedTab(soul)).toBe("knowledge");
    expect(sectionHtml(soul, "soul").open).toBe(true);
    expect(bodiesOf(sectionHtml(soul, "soul").html)).toEqual(["soul"]);
    // the memory is managed in the Bot folder
    expect(sectionHtml(render("memory"), "files").open).toBe(true);
    // a link to Who can see it lands on Shared with where only that is offered
    const visibility = render("visibility");
    expect(selectedTab(visibility)).toBe("general");
    expect(sectionHtml(visibility, "sharing").open).toBe(true);
    expect(sectionsOf(visibility)).not.toContain("visibility");
  });

  it("draws the top bar's X and Private / Shared from the app's round header control, not a black disc", () => {
    const html = render("overview");
    const tagOf = (marker: string) => {
      const index = html.indexOf(marker);
      return html.slice(html.lastIndexOf("<", index), html.indexOf(">", index) + 1);
    };
    const close = tagOf("data-window-close");
    for (const cls of CIRCLE_CLOSE_BUTTON.split(" ")) expect(close).toContain(cls);
    expect(close).toContain('aria-label="Close"');
    const pill = tagOf("data-bot-profile-visibility");
    for (const cls of CIRCLE_LABEL.split(" ")) expect(pill).toContain(cls);
    for (const tag of [close, pill]) {
      expect(tag).not.toContain("bg-black");
      expect(tag).not.toContain("text-white");
    }
    // same glyph as the other header X: 18px, strokeWidth 1.75
    const x = html.slice(html.indexOf(">", html.indexOf("data-window-close")) + 1, html.indexOf("</button>", html.indexOf("data-window-close")));
    expect(x).toContain('width="18"');
    expect(x).toContain('stroke-width="1.75"');
  });
});

describe("General", () => {
  it("lists the channels with their state and the bot's accounts, then What it does and Shared with", () => {
    fixture.mail = { available: true, address: "pepper@bots.example", enabled: true };
    fixture.reach = { settings: { channels: ["sms"] }, channels: {} };
    fixture.capabilities = {
      engine: { kind: "claude", label: "Claude Code" },
      items: [
        { key: "k1", form: "connector", name: "Outlook", state: "ready", enabled: true, canToggle: true },
        { key: "k2", form: "skill", name: "Summaries", state: "ready", enabled: true, canToggle: true },
      ],
    };
    const html = render("overview");
    expect([...html.matchAll(/data-bot-profile-row="([\w-]+)"/g)].map((match) => match[1])).toEqual(["slack", "email", "reachMe", "messages", "engine", "account-0"]);
    expect(html).toContain("pepper@bots.example");
    expect(html).toContain(">Not offered here<");
    expect(html).toContain('data-bot-profile-action="email"');
    expect(html).toContain('data-bot-profile-action="reachMe"');
    expect(html).toContain(">Claude Code<");
    expect(html).toContain(">Outlook<");
    // skills are Knowledge's, not an account
    expect(html).not.toContain(">Summaries<");
    expect(html).toContain("data-bot-profile-add");
    expect(html).not.toContain("k1");
    // What it does: the server's overview of the bot; Shared with beside it
    expect(sectionHtml(html, "summary").open).toBe(true);
    expect(bodiesOf(sectionHtml(html, "summary").html)).toEqual(["overview"]);
    expect(bodiesOf(sectionHtml(html, "sharing").html)).toEqual(["sharing"]);
    const panel = html.slice(at(html, 'id="bot-profile-panel-general"'), at(html, 'id="bot-profile-panel-knowledge"'));
    expect(at(panel, 'data-bot-profile-column-side="left"')).toBeLessThan(at(panel, 'data-bot-profile-section="summary"'));
    expect(at(panel, 'data-bot-profile-column-side="right"')).toBeLessThan(at(panel, 'data-bot-profile-section="sharing"'));
  });

  it("shows Slack as managed in Admin where the server offers it, and a Slack link opens it", () => {
    fixture.slackUrl = "https://admin.example/slack";
    expect(render("overview")).toContain(">Managed in Admin<");
    expect(render("overview")).not.toContain('data-section-body="slack"');
    const html = render("slack");
    expect(selectedTab(html)).toBe("general");
    expect(html).toContain('data-section-body="slack"');
  });

  it("says when the accounts are loading and when the bot has none", () => {
    expect(render("overview")).toContain("Loading accounts");
    fixture.capabilities = { engine: { kind: "claude", label: "Claude Code" }, items: [] };
    expect(render("overview")).toContain("No accounts connected to this bot yet.");
  });
});

describe("Knowledge", () => {
  it("holds Skills, Personality, Rules and the Bot folder as open cards, and links the Memory page", () => {
    const html = render("skills");
    expect(selectedTab(html)).toBe("knowledge");
    for (const id of KNOWLEDGE_SECTIONS) {
      expect(sectionHtml(html, id).open).toBe(true);
      expect(bodiesOf(sectionHtml(html, id).html)).toEqual([id]);
    }
    expect(html).toContain("data-bot-profile-memory");
    expect(html).toContain(">Open the Memory page<");
  });

  it("keeps the whole tab mounted while another is shown, so a draft survives", () => {
    const html = render("model");
    expect(selectedTab(html)).toBe("tools");
    expect(html).toMatch(/id="bot-profile-panel-knowledge" role="tabpanel"[^>]*hidden=""/);
    expect(bodiesOf(sectionHtml(html, "rules").html)).toEqual(["rules"]);
    expect(bodiesOf(sectionHtml(html, "files").html)).toEqual(["files"]);
  });
});

describe("Model & tools and Activity", () => {
  it("hold the other sections of the editor as cards, the search behind the magnifier", () => {
    const html = render("model");
    expect(tabsOf(html)).toEqual(TABS_ALL);
    for (const id of BOT_PROFILE_TAB_SECTIONS.tools) expect(bodiesOf(sectionHtml(html, id).html)).toEqual([id]);
    // the search opens from its button (Command-F, a slash): closed at rest
    expect(html).toContain('data-bot-profile-search-toggle="" aria-expanded="false"');
    expect(html).not.toContain("data-persona-search");
    const activity = render("usage");
    expect(selectedTab(activity)).toBe("activity");
    for (const id of BOT_PROFILE_TAB_SECTIONS.activity) expect(bodiesOf(sectionHtml(activity, id).html)).toEqual([id]);
  });

  it("follows Simple mode", () => {
    fixture.advanced = false;
    expect(tabsOf(render("model"))).toEqual(TABS_SIMPLE);
    expect(sectionsOf(render("model"))).not.toContain("worksOn");
    expect(sectionsOf(render("model"))).not.toContain("access");
    // a link to a hidden setting lands on General
    expect(selectedTab(render("usage"))).toBe("general");
  });

  it("offers no Perspicax profile configuration on either server type", () => {
    for (const org of [fixture.perspicax, null]) {
      fixture.perspicax = org;
      const html = render("model");
      expect(html).not.toContain('data-section-body="perspicax"');
      expect(html).not.toContain("Perspicax Profiles");
    }
  });

  it("names Rules, Skills and History in French", () => {
    setLocale("fr");
    const html = render("soul");
    expect(html).toContain(">Règles</span>");
    expect(html).toContain(">Compétences</span>");
    expect(html).not.toContain(">Skills<");
    expect(render("history")).toContain(">Changements<");
  });
});

describe("bot profile for an organization member", () => {
  it("opens Rules and the Bot folder on a bot she owns, like the Soul", () => {
    const owned = { ...bot, ownerUserId: "pr_me" } as Bot;
    const state = { config: memberConfig, bots: [owned, other] };
    expect(bodiesOf(sectionHtml(render("soul", state), "soul").html)).toEqual(["soul"]);
    expect(bodiesOf(sectionHtml(render("rules", state), "rules").html)).toEqual(["rules"]);
    expect(bodiesOf(sectionHtml(render("files", state), "files").html)).toEqual(["files"]);
    expect(render("overview", state)).toContain("Private to you<");
  });

  it("shows a bot they do not own locked, with the reason, never hidden", () => {
    const state = { config: memberConfig };
    const soul = sectionHtml(render("soul", state), "soul").html;
    expect(soul).not.toContain('data-section-body="soul"');
    expect(soul).toContain("Only this bot&#x27;s owner or an admin can change this.");
    expect(soul).toContain("Be brief.");
    expect(soul).toContain('aria-readonly="true"');
    expect(sectionHtml(render("rules", state), "rules").html).not.toContain('data-section-body="rules"');
    const history = sectionHtml(render("history", state), "history").html;
    expect(history).not.toContain('data-section-body="history"');
    expect(history).toContain("Only this bot&#x27;s owner or an admin can change this.");
    expect(tabsOf(render("history", state))).toEqual(TABS_ALL);
    // the locked card says so on its heading, not the tab pill
    expect(history).toMatch(/<h3[^>]*>[\s\S]*?aria-label="Read only"/);
    expect(render("history", state)).not.toMatch(/data-bot-profile-tab="activity"[^>]*>Activity<svg/);
  });
});
