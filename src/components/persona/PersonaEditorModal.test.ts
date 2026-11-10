// The bot editor is the bot's profile page (#2126, #2173, #2271, Grok
// Bot's layout) in the main panel: its top is the bot's appearance (the
// banner, the mascot, the name with its label under it, the description and
// the description, edited in place; the Appearance is its own tab),
// then five pill tabs at most, each one column of cards (the owner 2026-11-06).
// Every section of the former editor is still there, on its tab; locked
// sections are shown with their reason instead of hidden.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot, BotSettingsSection } from "@/state/store";
import { setLocale } from "@/lib/i18n";
import { CIRCLE_CLOSE_BUTTON, CIRCLE_LABEL } from "@/lib/circle-button";
import { MASCOT_HERO_SIZE } from "@/components/floating-bots/MascotLookPreview";

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
vi.mock("../bot-settings/VoiceSection", () => ({ VoiceSection: marker("voice"), NotifyMeRow: marker("notifyMe") }));
vi.mock("../bot-settings/SharingSection", () => ({ SharingSection: marker("sharing") }));
vi.mock("../bot-settings/VisibilitySection", () => ({ VisibilitySection: marker("visibility") }));
vi.mock("../bot-settings/HistorySection", () => ({ HistorySection: marker("history") }));
vi.mock("../bot-settings/BotAnalyticsSection", () => ({ BotAnalyticsSection: marker("usage") }));
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
const { BOT_PROFILE_TABS, BOT_PROFILE_SUBPAGE_SECTIONS, KNOWLEDGE_SECTIONS, botProfileSubPageFor, botProfileTabFor, personaCategoryForSection } = await import("@/lib/persona-sections");

const bot = {
  id: "pepper", threadId: "t", name: "Pepper", title: "Research", description: "Finds sources.", notifications: true,
  color: "green", unread: false, messages: [], tasks: [], soul: "Be brief.",
  modelSelection: { instanceId: "claude", model: "opus" },
} as unknown as Bot;
const other = { ...bot, id: "other", name: "Other" } as Bot;

function render(section: BotSettingsSection, state: Partial<AppState> = {}) {
  // a server with spoken replies: the Voice sub-page has its voice rows
  fixture.state = { config: { tts: { configured: false } } as AppState["config"], bots: [bot, other], personaEditor: { botId: bot.id, section }, ...state };
  return renderToStaticMarkup(createElement(PersonaEditorModal));
}

const memberConfig = {
  viewer: { role: "member", principalId: "pr_me", operator: false },
  tts: { configured: false },
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

const TABS_ALL = ["general", "appearance", "knowledge", "stats"];
const TABS_SIMPLE = ["general", "appearance", "knowledge"];
// The V6 page (#2612): the sub-page a link opens, and the rows of a tab.
const subPageOf = (html: string) => /data-bot-profile-subpage-current="(\w+)"/.exec(html)?.[1];
const rowsOf = (html: string) => [...html.matchAll(/data-bot-profile-subpage-open="(\w+)"/g)].map((match) => match[1]);
/** The index of a marker in the page, -1 when absent. */
const at = (html: string, marker: string) => html.indexOf(marker);

describe("bot profile page shell", () => {
  it("fills the main panel with the appearance header on top and five tabs at most (#2271)", () => {
    const html = render("overview");
    expect(html).toContain('data-bot-profile-placement="main"');
    expect(html).not.toContain("data-detail-panel");
    expect(html).not.toContain("data-bot-profile-visibility");
    // #3398: no Slack row where the server offers no link (Slack is removed for now)
    expect(render("slack")).not.toContain("data-slack-logo");
    expect(html).toContain("data-bot-profile-page");
    expect(html).not.toContain('aria-modal="true"');
    expect(html).toContain('data-bot-profile-banner=""');
    expect(html).toContain('data-bot-profile-hero=""');
    expect(html).toContain("data-bot-profile-audience");
    expect(tabsOf(html)).toEqual(TABS_ALL);
    expect(BOT_PROFILE_TABS).toEqual(TABS_ALL);
    expect(html).toContain('role="tablist"');
    for (const label of [">General<", ">Knowledge<", ">Analytics<", ">Appearance"]) expect(html).toContain(label);
    // #3398: General is section cards with their controls in place; a row
    // opens a sub-page only for a long setting; no Settings fold, no identity card of facts
    expect(html).not.toContain("data-bot-profile-settings-toggle");
    expect(rowsOf(html)).toEqual(["personality", "model", "beforeActing", "sharing", "rules", "actsAlone", "voice", "advanced", "versions"]);
    for (const label of [">Settings<", ">Channels<", ">Bot accounts<", ">More<"]) expect(html).toContain(label);
    expect(html).not.toContain(">Identity<");
    expect(selectedTab(html)).toBe("general");
    expect(html).toContain('aria-label="Close"');
  });

  it("regression #2271: the header (name, label, description) comes before the tabs, the tabs are five at most, the panels one column (the owner 2026-11-06)", () => {
    const html = render("overview");
    const tabs = at(html, 'data-bot-profile-tabs=""');
    expect(tabs).toBeGreaterThan(0);
    for (const marker of ['data-bot-profile-title=""', 'data-bot-profile-label=""', 'data-bot-profile-description=""']) {
      expect(at(html, marker)).toBeGreaterThan(0);
      expect(at(html, marker)).toBeLessThan(tabs);
    }
    expect(tabsOf(html).length).toBeLessThanOrEqual(5);
    // the name alone on its line, the label under it, smaller and secondary (the owner, never "Name · Label")
    const title = html.slice(at(html, 'data-bot-profile-title=""'), at(html, 'data-bot-profile-label=""'));
    expect(title).toContain(">Pepper<");
    expect(title).not.toContain("Research");
    expect(title).not.toContain(">·<");
    const label = html.slice(at(html, 'data-bot-profile-label=""'), at(html, 'data-bot-profile-audience'));
    expect(label).toContain(">Research<");
    expect(label).toContain("text-ink-secondary");
    expect(label).toContain("text-[15px]");
    // the description, edited in place
    expect(html).toMatch(/<textarea[^>]*data-bot-profile-description=""[^>]*>Finds sources\.<\/textarea>/);
    // each tab is a panel of ONE column (the owner 2026-11-06: no two-column grid)
    for (const tab of ["general"]) {
      const panel = html.slice(at(html, `id="bot-profile-panel-${tab}"`), at(html, `id="bot-profile-panel-${tab}"`) + 400);
      expect(panel).toContain('role="tabpanel"');
      expect(panel).toContain("flex min-w-0 flex-col gap-6");
      expect(panel).not.toContain("grid-cols-2");
      expect(panel).not.toContain("overflow-x-auto");
    }
    expect(html).not.toContain("data-bot-profile-column-side");
    expect(html).not.toContain("min-[900px]:grid-cols-2");
    // the tab row wraps instead of scrolling sideways
    expect(html).toMatch(/role="tablist" data-bot-profile-tabs="" [^>]*class="[^"]*flex-wrap/);
    expect(html).not.toContain("overflow-x-auto whitespace-nowrap");
  });

  it("regression (2026-11-08): Appearance is its own tab, after General, never a dropdown under the header", () => {
    const rest = render("overview");
    expect(tabsOf(rest)).toEqual(TABS_ALL);
    expect(tabsOf(rest).indexOf("appearance")).toBe(1);
    expect(rest).not.toContain("data-bot-profile-appearance-toggle");
    expect(rest).not.toContain('data-section-body="appearance"');
    // a link to the appearance opens its tab, the whole editor in the tab's panel
    const html = render("appearance");
    expect(selectedTab(html)).toBe("appearance");
    expect(subPageOf(html)).toBeUndefined();
    expect(sectionHtml(html, "appearance").open).toBe(true);
    expect(bodiesOf(sectionHtml(html, "appearance").html)).toEqual(["appearance"]);
    const panel = at(html, 'id="bot-profile-panel-appearance"');
    expect(panel).toBeGreaterThan(at(html, 'data-bot-profile-tabs=""'));
    expect(at(html, 'data-bot-profile-section="appearance"')).toBeGreaterThan(panel);
    expect(html).not.toContain("data-bot-profile-appearance-toggle");
  });

  it("regression: nothing of the Appearance shows on General, the description then the tabs (the owner 2026-11-06)", () => {
    const html = render("overview");
    for (const marker of ["data-mascot-color", "data-bot-profile-colors", "data-appearance-modes", "data-appearance-mode=", "data-appearance-reset", "data-mascot-randomize", "data-appearance-tabs"]) {
      expect(html).not.toContain(marker);
    }
    for (const word of [">Generate<", ">Upload<", ">Reset<", ">Randomize<"]) expect(html).not.toContain(word);
    // straight from the description to the General / Appearance / Knowledge / Stats tabs
    const description = at(html, 'data-bot-profile-description=""');
    const tabs = at(html, 'data-bot-profile-tabs=""');
    expect(description).toBeGreaterThan(0);
    expect(html.slice(description, tabs)).not.toContain("<button");
  });

  it("carries no gear: the bot's settings are its tabs and the bot panel's (#2173)", () => {
    for (const page of ["overview", "appearance", "model"] as const) {
      const html = render(page);
      expect(html).not.toContain("lucide-settings");
      expect(html).not.toContain("data-bot-header-gear");
      expect(html).not.toContain("data-bot-panel-gear");
    }
  });

  it("regression (2026-11-09, « mascot more on the left, a bit smaller »): the mascot sits bare and small at the left over a lower banner, the name and label stacked and left-aligned under it", () => {
    const html = render("overview");
    const hero = at(html, 'data-bot-profile-hero=""');
    const audience = at(html, "data-bot-profile-audience");
    expect(hero).toBeGreaterThan(0);
    const banner = at(html, 'data-bot-profile-banner=""');
    expect(banner).toBeGreaterThan(0);
    expect(banner).toBeLessThan(hero);
    expect(html).toMatch(/data-bot-profile-banner="" data-bot-profile-banner-palette="(vivid|neutral)" style="--bot-profile-banner-color:#[0-9a-f]{6}" class="bot-profile-banner h-\[112px\] /i);
    // the mascot over the banner's lower edge, at the left of the column
    expect(html).toMatch(/data-bot-profile-hero=""[^>]*class="relative -mt-\[46px\] flex flex-col items-start/);
    const heroHtml = html.slice(hero, audience);
    expect(heroHtml).toContain("data-mascot-hero");
    // no card: no border, no panel, no tinted ground around the mascot
    const card = /<section[^>]*data-mascot-hero=""[^>]*>/.exec(heroHtml)?.[0] ?? "";
    expect(card).not.toBe("");
    for (const cls of ["border", "rounded-2xl", "radial-gradient", "bg-panel", "p-4"]) expect(card).not.toContain(cls);
    expect(card).toContain("items-start");
    expect(card).not.toContain("items-center");
    // small (84px mascot in an 88px frame) and clipped to it
    const stage = /<button[^>]*data-mascot-stage=""[^>]*>/.exec(heroHtml)?.[0] ?? "";
    expect(stage).toContain(`width:${MASCOT_HERO_SIZE + 4}px`);
    expect(stage).toContain("overflow-hidden");
    // name (28px) then the label, left-aligned, inside the hero, before who sees it
    const heading = at(html, "data-mascot-heading");
    const title = at(html, 'data-bot-profile-title=""');
    const label = at(html, 'data-bot-profile-label=""');
    expect(heading).toBeGreaterThan(hero);
    expect(heading).toBeLessThan(title);
    expect(title).toBeLessThan(label);
    expect(label).toBeLessThan(audience);
    expect(html).toMatch(/<h2 id="bot-profile-title" data-bot-profile-title="" class="[^"]*justify-start text-left text-\[28px\]/);
    // no button row nor summary in the header: they head the Appearance tab
    for (const marker of ["data-mascot-play", "data-mascot-randomize", "data-mascot-summary", "data-mascot-action", "data-bot-profile-appearance-toggle"]) expect(heroHtml).not.toContain(marker);
    // nothing lost under it: who sees it, the description, left-aligned
    expect(html.slice(audience - 200, audience)).toContain("justify-start");
    expect(html).toMatch(/<textarea[^>]*data-bot-profile-description=""[^>]*class="[^"]*text-left/);
    // the column a reading width with a 16px gutter on a phone
    expect(html).toMatch(/data-bot-profile-column="" class="mx-auto flex w-full max-w-\[760px\] flex-col px-4 pb-10 sm:px-6"/);
  });

  it("regression (2026-11-08, « why is it cutting like that »): X and Share float on a clear sticky bar in the scroll, no opaque coloured band", () => {
    const html = render("overview");
    const scroll = at(html, 'data-bot-profile-scroll=""');
    const bar = at(html, "data-bot-profile-topbar");
    const banner = at(html, 'data-bot-profile-banner=""');
    expect(scroll).toBeGreaterThan(0);
    // inside the scroll, before the banner: the banner and the mascot scroll away under it, whole
    expect(bar).toBeGreaterThan(scroll);
    expect(bar).toBeLessThan(banner);
    const barHtml = html.slice(bar, banner);
    expect(barHtml).toContain("data-window-close");
    expect(barHtml).not.toContain("data-bot-profile-visibility");
    const barTag = html.slice(html.lastIndexOf("<", bar), html.indexOf(">", bar) + 1);
    expect(barTag).toContain("sticky top-0");
    expect(barTag).toContain("bg-transparent");
    expect(barTag).toMatch(/-mb-1[24] h-1[24]/);
    // never the skin's opaque header nor the banner's top colour
    expect(barTag).not.toContain("content-topbar");
    expect(barHtml).not.toContain("bot-profile-banner-top");
    // the condensed head (small mascot and the name) is there, hidden until the name scrolls under the bar
    expect(barHtml).toMatch(/data-bot-profile-condensed="" aria-hidden="true" class="[^"]*opacity-0/);
    expect(barHtml).toContain(">Pepper<");
  });

  it("names the tabs, the header and the channels in French", () => {
    setLocale("fr");
    const html = render("overview");
    for (const label of [">Général<", ">Connaissances<", ">Analytique<", ">Apparence", ">Réglages<", ">Canaux<", ">Comptes du bot<", ">Plus<", ">Avant d&#x27;agir<", ">Quand il agit seul<"]) expect(html).toContain(label);
    // the channels are in place on General (#3398); a sub-page's link back names its tab
    for (const label of [">Courriel<", ">Me joindre<"]) expect(html).toContain(label);
    const rules = render("rules");
    expect(rules).toContain('aria-label="Retour à Général"');
    expect(rules).toMatch(/data-bot-profile-back=""[^>]*>[\s\S]*?Général<\/button>/);
  });

  it("renders nothing when closed or when the bot is gone", () => {
    fixture.state = { bots: [bot], personaEditor: null };
    expect(renderToStaticMarkup(createElement(PersonaEditorModal))).toBe("");
    fixture.state = { bots: [other], personaEditor: { botId: "pepper", section: "overview" } };
    expect(renderToStaticMarkup(createElement(PersonaEditorModal))).toBe("");
  });

  it("opens a link on the sub-page that holds its section, shown in place (V6, #2612)", () => {
    expect(botProfileTabFor("overview")).toBe("general");
    expect(botProfileTabFor("appearance")).toBe("appearance");
    expect(botProfileTabFor("slack")).toBe("general");
    expect(botProfileTabFor("summary")).toBe("general");
    expect(botProfileTabFor("soul")).toBe("general");
    expect(botProfileTabFor("model")).toBe("general");
    expect(botProfileTabFor("history")).toBe("general");
    expect(botProfileTabFor("memory")).toBe("knowledge");
    expect(botProfileTabFor("usage")).toBe("stats");
    expect(botProfileSubPageFor("soul")).toBe("personality");
    expect(botProfileSubPageFor("memory")).toBe("folder");
    expect(botProfileSubPageFor("routines")).toBe("routines");
    // #3398: the channels and the accounts are cards in place on General
    expect(botProfileSubPageFor("slack")).toBeNull();
    expect(botProfileSubPageFor("access")).toBeNull();
    expect(personaCategoryForSection("routines")).toBeNull();
    // #3400: the skills are in place on Knowledge, no sub-page
    expect(botProfileSubPageFor("skills")).toBeNull();
    for (const section of ["model", "voice", "soul", "history", "rules"] as const) {
      const html = render(section);
      const page = botProfileSubPageFor(section)!;
      expect(subPageOf(html), section).toBe(page);
      expect(html).toContain(`data-bot-profile-subpage="${page}"`);
      // a sub-page is Back, a title (the Settings page title style, 20 px) and one line of intro, no tab row
      expect(html).toContain("data-bot-profile-back");
      expect(html).toMatch(/data-bot-profile-subpage-title=""[^>]*text-\[20px\]/);
      expect(html).not.toContain('role="tablist"');
      expect(sectionHtml(html, section).open).toBe(true);
      for (const id of BOT_PROFILE_SUBPAGE_SECTIONS[page]) if (id !== "visibility") expect(sectionsOf(html)).toContain(id);
    }
    // Stats is a tab of its own, its usage block on the tab
    const stats = render("usage");
    expect(selectedTab(stats)).toBe("stats");
    expect(subPageOf(stats)).toBeUndefined();
    expect(bodiesOf(sectionHtml(stats, "usage").html)).toEqual(["usage"]);
    // the memory is managed in the Bot folder
    expect(sectionHtml(render("memory"), "files").open).toBe(true);
    // a link to the accounts opens the General tab, no sub-page, the card says when the bot has none
    fixture.capabilities = { engine: { kind: "claude", label: "Claude Code" }, items: [] };
    const accounts = render("access");
    expect(selectedTab(accounts)).toBe("general");
    expect(subPageOf(accounts)).toBeUndefined();
    expect(accounts).toContain("This bot has no accounts yet");
  });

  it("draws the top bar's X from the app's round header control, not a black disc", () => {
    const html = render("overview");
    const tagOf = (marker: string) => {
      const index = html.indexOf(marker);
      return html.slice(html.lastIndexOf("<", index), html.indexOf(">", index) + 1);
    };
    const close = tagOf("data-window-close");
    for (const cls of CIRCLE_CLOSE_BUTTON.split(" ")) expect(close).toContain(cls);
    expect(close).toContain('aria-label="Close"');
    const share = tagOf("data-bot-profile-share");
    for (const cls of CIRCLE_LABEL.split(" ")) expect(share).toContain(cls);
    for (const tag of [close, share]) {
      expect(tag).not.toContain("bg-black");
      expect(tag).not.toContain("text-white");
    }
    // same glyph as the other header X: 18px, strokeWidth 1.75
    const x = html.slice(html.indexOf(">", html.indexOf("data-window-close")) + 1, html.indexOf("</button>", html.indexOf("data-window-close")));
    expect(x).toContain('width="18"');
    expect(x).toContain('stroke-width="1.75"');
  });
});

describe("General cards and sub-pages", () => {
  it("the General tab holds the channel rows, the accounts with their Add button and the two switches in place (#3398); Shared with its summary row", () => {
    fixture.mail = { available: true, address: "pepper@bots.example", enabled: true };
    fixture.reach = { settings: { channels: ["sms"] }, channels: {} };
    fixture.capabilities = {
      engine: { kind: "claude", label: "Claude Code" },
      items: [
        { key: "k1", form: "connector", name: "Outlook", state: "ready", enabled: true, canToggle: true },
        { key: "k2", form: "skill", name: "Summaries", state: "ready", enabled: true, canToggle: true },
      ],
    };
    const general = render("overview");
    expect(selectedTab(general)).toBe("general");
    expect(subPageOf(general)).toBeUndefined();
    // Settings: the two switches first, then the rows that open a page
    const settings = general.slice(at(general, 'data-settings-group="bot-profile-group-settings"'), at(general, 'data-settings-group="bot-profile-channels"'));
    expect(settings).toContain('data-settings-row="botCollaboratorsCreateRoutines"');
    expect(settings).toContain('data-section-body="notifyMe"');
    expect(at(settings, 'data-settings-row="botCollaboratorsCreateRoutines"')).toBeLessThan(at(settings, 'data-bot-profile-subpage-open="personality"'));
    // Channels in place: no team chat row where the server offers no link (Slack is removed for now)
    const channels = general.slice(at(general, 'data-settings-group="bot-profile-channels"'), at(general, 'data-settings-group="bot-profile-accounts"'));
    expect([...channels.matchAll(/data-bot-profile-row="([\w-]+)"/g)].map((match) => match[1])).toEqual(["email", "reachMe", "messages"]);
    expect(general).not.toContain('data-bot-profile-row="slack"');
    expect(general).not.toContain("Not offered here");
    expect(channels).toContain("pepper@bots.example");
    expect(channels).toContain('data-bot-profile-action="email"');
    expect(channels).toContain('data-bot-profile-action="reachMe"');
    // Bot accounts in place, one name, its Add button
    const accounts = general.slice(at(general, 'data-settings-group="bot-profile-accounts"'));
    expect(general).not.toContain("What it can use");
    expect([...accounts.matchAll(/data-bot-profile-row="([\w-]+)"/g)].map((match) => match[1]).slice(0, 2)).toEqual(["engine", "account-0"]);
    expect(accounts).toContain(">Claude Code<");
    expect(accounts).toContain(">Outlook<");
    // skills are Knowledge's, not an account
    expect(accounts).not.toContain(">Summaries<");
    expect(accounts).toContain("data-bot-profile-add");
    expect(accounts).not.toContain("k1");
    // #3399: the MCP servers card is gone from General; each server is a row of the card
    expect(bodiesOf(accounts)).not.toContain("access");
    // Personality: What it does (the server's overview), then the Soul
    const personality = render("summary");
    expect(subPageOf(personality)).toBe("personality");
    expect(bodiesOf(sectionHtml(personality, "summary").html)).toEqual(["overview"]);
    expect(at(personality, 'data-bot-profile-section="summary"')).toBeLessThan(at(personality, 'data-bot-profile-section="soul"'));
    // Shared with is a summary row whose Manage opens the top bar's Share
    // popover (the owner 2026-11-06: the people are managed in ONE place)
    const html = render("sharing");
    expect(subPageOf(html)).toBe("sharing");
    const sharing = sectionHtml(html, "sharing").html;
    expect(sharing).not.toContain('data-section-body="sharing"');
    expect(sharing).toContain('data-bot-profile-row="sharing"');
    expect(sharing).toContain(">People and groups<");
    expect(sharing).toContain('data-bot-profile-share-open=""');
    expect(html.match(/data-bot-profile-share-open=""/g)).toHaveLength(1);
    expect(html.match(/data-bot-profile-share=""/g)).toHaveLength(1);
  });

  it("keeps the Slack row for a server that offers its link, and a Slack link opens it on General", () => {
    fixture.slackUrl = "https://admin.example/slack";
    expect(render("overview")).toContain(">Managed in Admin<");
    expect(render("overview")).not.toContain('data-section-body="slack"');
    const html = render("slack");
    expect(selectedTab(html)).toBe("general");
    expect(subPageOf(html)).toBeUndefined();
    expect(html).toContain('data-section-body="slack"');
  });

  it("says when the accounts are loading and when the bot has none", () => {
    expect(render("access")).toContain("Loading accounts");
    fixture.capabilities = { engine: { kind: "claude", label: "Claude Code" }, items: [] };
    expect(render("access")).toContain("This bot has no accounts yet");
  });

  it("each row carries its name, description and value; the permissions and access pieces each live in one sub-page", () => {
    fixture.state = {};
    const html = render("overview");
    for (const id of ["personality", "model", "beforeActing", "sharing", "actsAlone"]) expect(html).toContain(`data-bot-profile-row="page-${id}"`);
    expect(html).toContain(">Before it acts<");
    expect(html).toContain(">What it does alone, what it asks<");
    expect(html).toContain("data-bot-profile-value");
    // the permissions body sits on Before it acts, When it acts alone, Rules and Advanced, never on the home
    expect(bodiesOf(html)).not.toContain("permissions");
    for (const section of ["permissions"] as const) {
      expect(subPageOf(render(section))).toBe("beforeActing");
      expect(bodiesOf(render(section))).toEqual(expect.arrayContaining(["permissions"]));
    }
  });
});

describe("Knowledge", () => {
  it("draws Skills in place (#3400); Routines and the Folder open as sub-pages, the folder links the Memory page", () => {
    const home = render("skills");
    expect(selectedTab(home)).toBe("knowledge");
    expect(subPageOf(home)).toBeUndefined();
    expect(home).toContain('data-bot-profile-row="page-routines"');
    expect(home).toContain('data-bot-profile-row="page-folder"');
    expect(home).not.toContain('data-bot-profile-row="page-skills"');
    for (const id of KNOWLEDGE_SECTIONS) {
      const html = render(id);
      expect(sectionHtml(html, id).open).toBe(true);
      expect(bodiesOf(sectionHtml(html, id).html)).toEqual([id]);
    }
    const folder = render("files");
    expect(folder).toContain("data-bot-profile-memory");
    expect(folder).toContain(">Open the Memory page<");
  });
});

describe("Stats and Simple mode", () => {
  it("the search sits behind the magnifier; Usage is the Stats tab's, once on the page", () => {
    const html = render("overview");
    expect(tabsOf(html)).toEqual(TABS_ALL);
    // the search opens from its button (Command-F, a slash): closed at rest
    expect(html).toContain('data-bot-profile-search-toggle="" aria-expanded="false"');
    expect(html).not.toContain("data-persona-search");
    const versions = render("history");
    expect(subPageOf(versions)).toBe("versions");
    expect(bodiesOf(sectionHtml(versions, "history").html)).toEqual(["history"]);
    expect(sectionsOf(versions)).not.toContain("usage");
    const stats = render("usage");
    expect(selectedTab(stats)).toBe("stats");
    expect(stats.match(/data-section-body="usage"/g)).toHaveLength(1);
  });

  it("follows Simple mode", () => {
    fixture.advanced = false;
    expect(tabsOf(render("overview"))).toEqual(TABS_SIMPLE);
    expect(rowsOf(render("overview"))).not.toContain("advanced");
    expect(sectionsOf(render("model"))).not.toContain("worksOn");
    // a link to a hidden setting lands on General
    expect(selectedTab(render("usage"))).toBe("general");
    expect(subPageOf(render("usage"))).toBeUndefined();
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
    // Section bodies are mocked, so the names come from the page's own landmarks.
    expect(render("rules")).toContain('aria-label="Règles"');
    expect(render("skills")).toContain('aria-label="Compétences"');
    expect(render("skills")).not.toContain(">Skills<");
    expect(render("history")).toContain('aria-label="Changements"');
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
    expect(subPageOf(render("history", state))).toBe("versions");
    // the locked card says so in its own row, not the tab pill
    expect(history).toContain('data-bot-profile-locked=""');
    expect(history).toMatch(/<p role="note" data-persona-locked="" aria-label="Read only"/);
    expect(render("overview", state)).not.toMatch(/data-bot-profile-tab="general"[^>]*>General<svg/);
  });
});
