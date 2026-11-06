// The bot editor is the bot's profile page (#2126, Grok Bot's layout): a
// right-hand panel with the banner, the mascot, "Name · Label", who sees it,
// and the tabs General / Knowledge / Settings. Every section of the former
// editor is still there, folded under its tab; locked sections are shown with
// their reason instead of hidden.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot, BotSettingsSection } from "@/state/store";
import { setLocale } from "@/lib/i18n";

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
vi.mock("../BotProfileAvatarCard", () => ({ BotProfileAvatarCard: marker("avatar") }));
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
const { KNOWLEDGE_SECTIONS, SETTINGS_SECTIONS, botProfileTabFor, personaCategoryForSection } = await import("@/lib/persona-sections");

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
// Settings unfolds under General's cards (#2136): the page says which it shows.
const selectedTab = (html: string) => /data-bot-profile-tab-current="(\w+)"/.exec(html)?.[1];

const SETTINGS_ALL = ["overview", "appearance", "sharing", "summary", "model", "worksOn", "access", "permissions", "voice", "usage", "history"];
const SETTINGS_SIMPLE = ["overview", "appearance", "sharing", "summary", "model", "permissions", "voice"];

describe("bot profile page shell", () => {
  it("fills the main panel with the banner, the mascot, Name · Label and two tabs, Settings folded under General", () => {
    const html = render("overview");
    expect(html).toContain('data-bot-profile-placement="main"');
    expect(html).not.toContain("data-detail-panel");
    expect(html).toContain('data-bot-profile-visibility="private"');
    expect(html).toContain("data-slack-logo");
    expect(html).toContain("data-bot-profile-page");
    expect(html).not.toContain('aria-modal="true"');
    expect(html).toContain("data-bot-profile-banner");
    expect(html).toContain('data-section-body="avatar"');
    expect(html).toMatch(/>Pepper<[\s\S]*>·<[\s\S]*>Research</);
    expect(html).toContain("data-bot-profile-audience");
    expect([...html.matchAll(/data-bot-profile-tab="(\w+)"/g)].map((match) => match[1])).toEqual(["general", "knowledge"]);
    expect(html).toContain('data-bot-profile-settings-toggle="" aria-expanded="false"');
    expect(html).toContain('role="tablist"');
    for (const label of [">General<", ">Knowledge<", ">Settings<"]) expect(html).toContain(label);
    expect(selectedTab(html)).toBe("general");
    expect(html).toContain('aria-label="Close"');
  });

  it("draws a quiet grey banner and a 590px content column, like Grok Bot (#2141)", () => {
    const html = render("overview");
    expect(html).toMatch(/data-bot-profile-banner="" class="bot-profile-banner /);
    expect(html).not.toMatch(/data-bot-profile-banner="" style=/);
    // 590px of content: 622 - 2 x 16, 670 - 2 x 40, 730 - 2 x 70
    expect(html).toMatch(/data-bot-profile-column="" class="[^"]*max-w-\[622px\][^"]*px-4[^"]*sm:max-w-\[670px\] sm:px-10 lg:max-w-\[730px\] lg:px-\[70px\]/);
  });

  it("names the tabs and channels in French", () => {
    setLocale("fr");
    const html = render("overview");
    for (const label of [">Général<", ">Connaissances<", ">Réglages<", ">Canaux<", ">Comptes du bot<", ">Courriel<", ">Me joindre<"]) expect(html).toContain(label);
  });

  it("renders nothing when closed or when the bot is gone", () => {
    fixture.state = { bots: [bot], personaEditor: null };
    expect(renderToStaticMarkup(createElement(PersonaEditorModal))).toBe("");
    fixture.state = { bots: [other], personaEditor: { botId: "pepper", section: "overview" } };
    expect(renderToStaticMarkup(createElement(PersonaEditorModal))).toBe("");
  });

  it("opens a link on the tab that holds its section, unfolded", () => {
    expect(botProfileTabFor("overview")).toBe("general");
    expect(botProfileTabFor("slack")).toBe("general");
    expect(botProfileTabFor("soul")).toBe("knowledge");
    expect(botProfileTabFor("memory")).toBe("knowledge");
    expect(botProfileTabFor("appearance")).toBe("settings");
    expect(botProfileTabFor("history")).toBe("settings");
    expect(personaCategoryForSection("routines")).toBeNull();
    for (const page of ["appearance", "model", "voice", "usage"]) {
      const html = render(page as BotSettingsSection);
      expect(selectedTab(html)).toBe("settings");
      expect(sectionHtml(html, page).open).toBe(true);
    }
    const soul = render("soul");
    expect(selectedTab(soul)).toBe("knowledge");
    expect(sectionHtml(soul, "soul").open).toBe(true);
    expect(bodiesOf(sectionHtml(soul, "soul").html)).toEqual(["soul"]);
    // the memory is managed in the Bot folder
    expect(sectionHtml(render("memory"), "files").open).toBe(true);
    // a link to Who can see it lands on Shared with where only that is offered
    expect(sectionHtml(render("visibility"), "sharing").open).toBe(true);
  });
});

describe("General", () => {
  it("lists the channels with their state and the bot's accounts", () => {
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
  it("holds Skills, Personality, Rules and the Bot folder, Skills open, and links the Memory page", () => {
    const html = render("skills");
    expect(selectedTab(html)).toBe("knowledge");
    expect(sectionsOf(html)).toEqual([...KNOWLEDGE_SECTIONS]);
    expect(sectionHtml(html, "skills").open).toBe(true);
    expect(sectionHtml(html, "soul").open).toBe(false);
    expect(html).toContain("data-bot-profile-memory");
    expect(html).toContain(">Open the Memory page<");
  });

  it("keeps Rules and the Bot folder mounted while folded, so a draft survives", () => {
    const html = render("skills");
    expect(bodiesOf(sectionHtml(html, "rules").html)).toEqual(["rules"]);
    expect(bodiesOf(sectionHtml(html, "files").html)).toEqual(["files"]);
    expect(sectionHtml(html, "rules").html).toContain('hidden=""');
  });
});

describe("Settings", () => {
  it("lists every other section of the editor, folded, with the search", () => {
    const html = render("appearance");
    expect(sectionsOf(html)).toEqual(SETTINGS_ALL);
    expect(SETTINGS_SECTIONS).toEqual(expect.arrayContaining(SETTINGS_ALL));
    expect(html).toContain("data-persona-search");
    expect(sectionHtml(html, "voice").open).toBe(false);
    // the identity (description and facts) without the header's mascot and name
    const identity = render("summary");
    expect(sectionHtml(identity, "summary").open).toBe(true);
    expect(bodiesOf(sectionHtml(identity, "summary").html)).toEqual(["overview"]);
  });

  it("follows Simple mode", () => {
    fixture.advanced = false;
    expect(sectionsOf(render("appearance"))).toEqual(SETTINGS_SIMPLE);
  });

  it("offers no Perspicax profile configuration on either server type", () => {
    for (const org of [fixture.perspicax, null]) {
      fixture.perspicax = org;
      const html = render("appearance");
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
    expect(render("history")).toContain(">Changements</span>");
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
    expect(sectionsOf(render("history", state))).toEqual(SETTINGS_ALL);
  });
});
