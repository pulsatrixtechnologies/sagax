// The bot editor is the bot's profile page (#2126, #2173, #2271, Grok
// Bot's layout) in the main panel: its top is the bot's appearance (the
// banner, the mascot, the name with its label under it, the description and
// the description, edited in place; the Appearance is its own tab),
// then five pill tabs at most, each one column of cards (the owner 2026-11-06).
// Every section of the former editor is still there, on its tab; locked
// sections are shown with their reason instead of hidden.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot, BotSettingsSection } from "@/state/store";
import { setLocale } from "@/lib/i18n";
import { CIRCLE_CLOSE_BUTTON } from "@/lib/circle-button";
import { MASCOT_PROFILE_SIZE } from "@/components/floating-bots/MascotLookPreview";

import { CHARACTER_PAINT, MASCOT_CHARACTERS, MASCOT_SHAPES, type MascotLook } from "../../../shared/mascot-look";
import { MASCOT_SKIN_IDS } from "../../../shared/mascot-skins";

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
vi.mock("../bot-settings/SkillsSection", () => ({
  SkillsSection: marker("skills"),
  // the Bot folder on Knowledge reads the skills for To review and its skills/ entries (M-20261119-081)
  useManagedSkills: () => ({
    skills: [], staged: [], loading: false, working: "", setWorking: () => {}, error: "", setError: () => {}, reviewing: null, setReviewing: () => {},
    refresh: async () => {}, toggle: async () => {}, enableReviewed: async () => {}, share: async () => {}, unshare: async () => {},
    deciding: "", decideError: "", decideStaged: async () => {}, assignmentBusy: { current: false }, putAssignments: async () => {},
  }),
}));
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
const { DesktopCapabilitiesProvider } = await import("../DesktopCapabilities");
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

/** The page in a desktop window of that platform (its own title bar on macOS and Windows). */
function renderOn(platform: string) {
  vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {}, ogb: { platform } });
  fixture.state = { config: { tts: { configured: false } } as AppState["config"], bots: [bot, other], personaEditor: { botId: bot.id, section: "overview" } };
  return renderToStaticMarkup(createElement(DesktopCapabilitiesProvider, null, createElement(PersonaEditorModal)));
}
/** The opening tag that carries a marker. */
const tagOf = (html: string, marker: string) => {
  const index = html.indexOf(marker);
  return index < 0 ? "" : html.slice(html.lastIndexOf("<", index), html.indexOf(">", index) + 1);
};

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

// #4098: Outcomes is the second tab, read from the routines (no Updates tab).
const TABS_ALL = ["general", "outcomes", "knowledge", "stats"];
const TABS_SIMPLE = ["general", "outcomes", "knowledge"];
// The V6 page (#2612): the sub-page a link opens, and the rows of a tab.
const subPageOf = (html: string) => /data-bot-profile-subpage-current="(\w+)"/.exec(html)?.[1];
const rowsOf = (html: string) => [...html.matchAll(/data-bot-profile-subpage-open="(\w+)"/g)].map((match) => match[1]);
/** The index of a marker in the page, -1 when absent. */
const at = (html: string, marker: string) => html.indexOf(marker);

describe("bot profile page shell", () => {
  it("fills the main panel with the appearance header on top and four tabs at most (#2271)", () => {
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
    for (const label of [">General<", ">Outcomes<", ">Knowledge<", ">Analytics<"]) expect(html).toContain(label);
    // #3398: General is section cards with their controls in place; a row
    // opens a sub-page only for a long setting; no Settings fold, no identity card of facts
    expect(html).not.toContain("data-bot-profile-settings-toggle");
    expect(rowsOf(html)).toEqual(["model", "beforeActing", "rules", "actsAlone", "voice", "advanced", "versions"]);
    for (const label of [">Settings<", ">Channels<", ">Access<", ">More<"]) expect(html).toContain(label);
    expect(html).not.toContain(">Identity<");
    expect(selectedTab(html)).toBe("general");
    expect(html).toContain('aria-label="Close"');
  });

  it("regression #2271: the header (name, label, description) comes before the tabs, the tabs are five at most, the panels one column (the owner 2026-11-06)", () => {
    const html = render("overview");
    const tabs = at(html, 'data-bot-profile-tabs=""');
    expect(tabs).toBeGreaterThan(0);
    for (const marker of ['data-bot-profile-title=""', 'data-bot-profile-label=""']) {
      expect(at(html, marker)).toBeGreaterThan(0);
      expect(at(html, marker)).toBeLessThan(tabs);
    }
    expect(tabsOf(html).length).toBeLessThanOrEqual(5);
    // ONE line "Name · Label" (the owner 2026-11-17, as the reference): the name, a separator, the label, secondary
    const title = html.slice(at(html, 'data-bot-profile-title=""'), at(html, 'data-bot-profile-label=""'));
    expect(title).toContain(">Pepper<");
    expect(title).toContain("data-bot-profile-separator");
    expect(title).not.toContain("Research");
    const label = html.slice(at(html, 'data-bot-profile-label=""'), at(html, 'data-bot-profile-audience'));
    expect(label).toContain(">Research<");
    expect(label).toContain("text-ink-secondary");
    // the label sits inside the heading, on its line, and shrinks first
    const heading = html.slice(at(html, 'data-bot-profile-title=""'), at(html, 'data-bot-profile-audience'));
    expect(heading.indexOf("</h2>")).toBeGreaterThan(heading.indexOf('data-bot-profile-label=""'));
    expect(label).toContain("min-w-0 shrink");
    // no description line in the header, even when the bot has one (the bot changes it when asked)
    expect(html).not.toContain("data-bot-profile-description");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("Finds sources.");
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

  it("regression (owner 2026-11-19): Appearance is not a tab, the header mascot is the button that opens its modal", () => {
    const html = render("overview");
    expect(tabsOf(html)).toEqual(TABS_ALL);
    expect(tabsOf(html)).not.toContain("appearance");
    expect(html).not.toContain('id="bot-profile-panel-appearance"');
    expect(html).not.toContain('data-bot-profile-row="page-appearance"');
    expect(html).not.toContain("data-bot-profile-appearance-toggle");
    expect(html).not.toContain('data-section-body="appearance"');
    // the mascot: a button with a tooltip, a name and the hand cursor
    expect(html).toMatch(/<button[^>]*aria-label="Appearance"[^>]*title="Appearance"[^>]*data-mascot-activate=""[^>]*class="[^"]*cursor-pointer/);
    // the editor is drawn only once the modal is open, never on a tab
    expect(html).not.toContain("data-appearance-pane");
  });

  it("regression: nothing of the Appearance shows on General, the audience line then the tabs (the owner 2026-11-06)", () => {
    const html = render("overview");
    for (const marker of ["data-mascot-color", "data-bot-profile-colors", "data-appearance-modes", "data-appearance-mode=", "data-appearance-reset", "data-mascot-randomize", "data-appearance-tabs"]) {
      expect(html).not.toContain(marker);
    }
    for (const word of [">Generate<", ">Upload<", ">Reset<", ">Randomize<"]) expect(html).not.toContain(word);
    // straight from the audience line to the General / Appearance / Knowledge / Stats tabs
    const audience = at(html, "data-bot-profile-audience");
    const tabs = at(html, 'data-bot-profile-tabs=""');
    expect(audience).toBeGreaterThan(0);
    expect(html.slice(audience, tabs)).not.toContain("<button");
  });

  it("carries no gear: the bot's settings are its tabs and the bot panel's (#2173)", () => {
    for (const page of ["overview", "appearance", "model"] as const) {
      const html = render(page);
      expect(html).not.toContain("lucide-settings");
      expect(html).not.toContain("data-bot-header-gear");
      expect(html).not.toContain("data-bot-panel-gear");
    }
  });

  it("every character and shape wears the one soft shadow and no outline", () => {
    function check(look: MascotLook, mascotSkin?: Bot["mascotSkin"]) {
      const html = render("overview", { bots: [{ ...bot, mascotSkin, mascotLook: look }] });
      expect(html).toContain('data-mascot-frame=""');
      expect(html.match(/profile-mascot-shadow/g)?.length, JSON.stringify(look)).toBe(1);
      expect(html).not.toContain("profile-mascot-contour");
    }
    for (const shape of MASCOT_SHAPES) check({ character: "shape", shape });
    for (const character of MASCOT_CHARACTERS) {
      if (character === "owl") {
        for (const skin of MASCOT_SKIN_IDS) check({ character }, skin);
      } else {
        for (const skin of CHARACTER_PAINT[character].skins) check({ character, skins: { [character]: skin } });
      }
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
    expect(html).toMatch(/data-bot-profile-banner="" data-bot-profile-banner-palette="(vivid|neutral)"[^>]*class="[^"]*bot-profile-banner[^"]*h-\[124px\]/i);
    // the mascot over the banner's lower edge, at the left of the column
    expect(html).toMatch(/data-bot-profile-hero=""[^>]*class="relative -mt-\[84px\] flex flex-col items-start/);
    const heroHtml = html.slice(hero, audience);
    expect(heroHtml).toContain("data-mascot-hero");
    // no card: no border, no panel, no tinted ground around the mascot
    const card = /<section[^>]*data-mascot-hero=""[^>]*>/.exec(heroHtml)?.[0] ?? "";
    expect(card).not.toBe("");
    for (const cls of ["border", "rounded-2xl", "radial-gradient", "bg-panel", "p-4"]) expect(card).not.toContain(cls);
    expect(card).toContain("items-start");
    expect(card).not.toContain("items-center");
    const frame = /<span[^>]*data-mascot-frame=""[^>]*>/.exec(heroHtml)?.[0] ?? "";
    expect(frame).toContain("size-[168px]");
    expect(frame).not.toMatch(/rounded|border|bg-/);
    expect(heroHtml).toContain("profile-mascot-shadow");
    expect(heroHtml).not.toContain("profile-mascot-contour");
    const stage = /<button[^>]*data-mascot-stage=""[^>]*>/.exec(heroHtml)?.[0] ?? "";
    expect(stage).toContain(`width:${MASCOT_PROFILE_SIZE}px`);
    expect(stage).not.toContain("overflow-hidden");
    // name (26px, #4420) then the label, left-aligned, inside the hero, before who sees it
    const heading = at(html, "data-mascot-heading");
    const title = at(html, 'data-bot-profile-title=""');
    const label = at(html, 'data-bot-profile-label=""');
    expect(heading).toBeGreaterThan(hero);
    expect(heading).toBeLessThan(title);
    expect(title).toBeLessThan(label);
    expect(label).toBeLessThan(audience);
    expect(html).toMatch(/<h2 id="bot-profile-title" data-bot-profile-title="" class="[^"]*justify-start text-left text-\[26px\] font-medium/);
    // the avatar of the header: large, a real picture of the bot (2026-11-19)
    expect(MASCOT_PROFILE_SIZE).toBeGreaterThanOrEqual(150);
    // no button row nor summary in the header: they head the Appearance tab
    for (const marker of ["data-mascot-play", "data-mascot-randomize", "data-mascot-summary", "data-mascot-action", "data-bot-profile-appearance-toggle"]) expect(heroHtml).not.toContain(marker);
    // nothing lost under it: who sees it, left-aligned (no description line, the bot is asked for it)
    expect(html.slice(audience - 200, audience)).toContain("justify-start");
    // the column the reference's reading width (#4420) with a 16px gutter on a phone
    expect(html).toMatch(/data-bot-profile-column="" class="mx-auto flex w-full max-w-\[920px\] flex-col px-4 pb-12 sm:px-8"/);
  });

  it("regression (2026-11-08, « why is it cutting like that »): X and Share float on a clear sticky bar in the scroll, no opaque coloured band", () => {
    const html = render("overview");
    const scroll = at(html, 'data-bot-profile-scroll=""');
    const bar = at(html, "data-bot-profile-topbar");
    const banner = at(html, 'data-bot-profile-banner=""');
    expect(scroll).toBeGreaterThan(0);
    // inside the scroll, right after the banner and before the column: the
    // banner and the mascot scroll away under it, whole (after the banner
    // since the review of PR #5381: the banner is the window's drag handle
    // and the two buttons are cut out of it, which takes a later element)
    expect(banner).toBeGreaterThan(scroll);
    expect(bar).toBeGreaterThan(banner);
    const column = at(html, 'data-bot-profile-column=""');
    expect(bar).toBeLessThan(column);
    expect(banner).toBeLessThan(bar);
    const barHtml = html.slice(bar, column);
    expect(barHtml).toContain("data-window-close");
    expect(barHtml).not.toContain("data-bot-profile-visibility");
    const barTag = html.slice(html.lastIndexOf("<", bar), html.indexOf(">", bar) + 1);
    expect(barTag).toContain("sticky top-0");
    expect(barTag).toContain("bg-transparent");
    // the frame's shared header height, so Share and the X sit as far under the top edge as every other round control of the top row (owner, 2026-11-25, #5379)
    expect(barTag).toContain("h-(--app-topbar-height)");
    // and no room in the flow: pulled up over the 124px banner, the rest of the banner's height given back under it
    expect(barTag).toContain("-mt-[124px] mb-[calc(124px-var(--app-topbar-height))] h-(--app-topbar-height)");
    expect(html).toMatch(/class="[^"]*bot-profile-banner[^"]*h-\[124px\]/);
    // never the skin's opaque header nor the banner's top colour
    expect(barTag).not.toContain("content-topbar");
    expect(barHtml).not.toContain("bot-profile-banner-top");
  });

  // Owner, 2026-11-25 (#5371), the reference beside Sagax: "the top bar that
  // says the bot name and the section is not doing that" there. No bar: the
  // round buttons float at the top right and nothing else is drawn, at
  // the top of the page or once it has scrolled. Edit banner (M-20261127-183)
  // joins Share and Close when the owner may change the banner.
  it("regression #5371: no top bar, only the round controls floating at the top right, whatever the scroll", () => {
    const html = render("overview");
    const bar = at(html, "data-bot-profile-topbar");
    const barHtml = html.slice(bar, at(html, 'data-bot-profile-column=""'));
    const barTag = html.slice(html.lastIndexOf("<", bar), html.indexOf(">", bar) + 1);
    // no mascot, no name, no section in it
    expect(barHtml).not.toContain("data-bot-profile-condensed");
    expect(barHtml).not.toContain("Pepper");
    expect(barHtml).not.toMatch(/<img|<canvas/);
    // its only children are the round controls, at the right
    expect(barTag).toContain("justify-end");
    expect(barHtml.match(/<button/g)?.length).toBeGreaterThanOrEqual(2);
    expect(barHtml).toContain('data-bot-profile-share=""');
    expect(barHtml).toContain("data-window-close");
    expect(barHtml).toContain('data-bot-profile-banner-edit=""');
    // Share stays an icon, never the word
    const share = at(html, 'data-bot-profile-share=""');
    expect(html.slice(share, html.indexOf("</button>", share))).not.toMatch(/>\s*Share\s*</);
    // and no state turns it into a strip: no ground, no blur, no rule under it
    const source = readFileSync(new URL("../bot-profile/BotProfilePage.tsx-parts/BotProfileTopBar.tsx", import.meta.url), "utf8");
    const code = source.slice(source.indexOf("export function BotProfileTopBar(")).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(code).not.toMatch(/condensed|backdrop-blur|shadow-|bg-app|border-b|hairline|BotAvatar/);
    expect(code).toContain("bg-transparent");
    const pageSource = readFileSync(new URL("../bot-profile/BotProfilePage.tsx", import.meta.url), "utf8");
    expect(pageSource).not.toMatch(/setCondensed|condensed=\{/);
  });

  // Independent review of PR #5381 (#5371): the row was clear but still a
  // full width, 56px box that took the clicks and, in the desktop app, was
  // the window's drag handle, over whatever row had scrolled under it. "Two
  // buttons float, no bar": only the two buttons take the pointer. The
  // window is still moved by the top of the page: the banner is the handle,
  // and it scrolls away with the page, so it never sits over a row.
  it.each([["macOS", "darwin"], ["Windows", "win32"]])("regression #5371 (review): on %s the clear row takes no click and is no window handle, the two buttons do, the banner is the handle", (_name, platform) => {
    const html = renderOn(platform);
    const barTag = tagOf(html, "data-bot-profile-topbar");
    const actionsTag = tagOf(html, 'data-bot-profile-topbar-actions=""');
    const bannerTag = tagOf(html, 'data-bot-profile-banner=""');
    // the row lets every click through to the page under it; the group of the two buttons takes its own
    expect(barTag).toMatch(/class="[^"]*\bpointer-events-none\b/);
    expect(actionsTag).toMatch(/class="[^"]*\bpointer-events-auto\b/);
    expect(actionsTag).not.toContain("pointer-events-none");
    // the sticky row is no drag region: it stays over the page while it scrolls
    expect(barTag).not.toContain("data-window-drag");
    expect(barTag).not.toContain("app-region");
    // the banner is, by the app's one means (useCaptionChrome().dragProps)
    expect(bannerTag).toContain('data-window-drag=""');
    expect(bannerTag).toContain("-webkit-app-region:drag");
    // the two buttons float over the banner at the top of the page and the
    // mascot overlaps its lower edge: both are cut out of the handle, and
    // both come after the banner, since a later no-drag cuts an earlier drag
    expect(actionsTag).toContain("-webkit-app-region:no-drag");
    expect(tagOf(html, 'data-bot-profile-hero=""')).toContain("-webkit-app-region:no-drag");
    expect(at(html, 'data-bot-profile-banner=""')).toBeLessThan(at(html, "data-bot-profile-topbar"));
    expect(at(html, 'data-bot-profile-banner=""')).toBeLessThan(at(html, 'data-bot-profile-hero=""'));
  });

  it("regression #5371 (review): with a native title bar (Linux, a browser) the row still takes no click and nothing drags", () => {
    const html = renderOn("linux");
    expect(tagOf(html, "data-bot-profile-topbar")).toMatch(/class="[^"]*\bpointer-events-none\b/);
    expect(tagOf(html, 'data-bot-profile-topbar-actions=""')).toMatch(/class="[^"]*\bpointer-events-auto\b/);
    for (const marker of ["data-bot-profile-topbar", 'data-bot-profile-topbar-actions=""', 'data-bot-profile-banner=""', 'data-bot-profile-hero=""']) {
      expect(tagOf(html, marker), marker).not.toContain("app-region");
      expect(tagOf(html, marker), marker).not.toContain("data-window-drag");
    }
  });

  it("regression #4470: a link to a sub-page's section opens the bot page with that sub-page as a modal over it, and no link back in the top bar", () => {
    for (const section of ["permissions", "soul", "model", "rules"] as const) {
      const html = render(section);
      const page = botProfileSubPageFor(section)!;
      const modal = at(html, `data-bot-page-modal="page-${page}"`);
      expect(modal, section).toBeGreaterThan(0);
      // the page is all there under it: the banner, the tab row, the tab's cards
      expect(at(html, 'data-bot-profile-banner=""'), section).toBeLessThan(modal);
      expect(at(html, 'role="tablist"'), section).toBeLessThan(modal);
      expect(at(html, 'data-bot-profile-panel="'), section).toBeLessThan(modal);
      // the modal: the reference's frame, its centred header, the sub-page's cards
      const tag = html.slice(html.lastIndexOf("<", modal), html.indexOf(">", modal) + 1);
      expect(tag, section).toContain('role="dialog"');
      expect(tag, section).toContain('aria-modal="true"');
      for (const cls of ["rounded-[20px]", "border-[0.5px]"]) expect(tag, section).toContain(cls);
      // large (an editor, a list) or medium (a few fields): BOT_PAGE_MODAL.size
      expect(tag, section).toMatch(/w-\[min\((900|720)px,calc\(100vw-40px\)\)\]/);
      expect(html.slice(modal), section).toMatch(/data-bot-page-modal-header=""[^>]*text-center[^>]*><h2 [^>]*text-\[22px\] font-medium leading-7/);
      expect(html.slice(modal), section).toContain(`data-bot-profile-subpage="${page}"`);
      // no link back left in the top bar; the X stays last, after Share (#4420)
      expect(html, section).not.toContain("data-bot-profile-back");
      expect(at(html, "data-window-close"), section).toBeGreaterThan(at(html, 'data-bot-profile-share=""'));
    }
    expect(render("overview")).not.toContain("data-bot-page-modal");
  });

  it("names the tabs, the header and the channels in French", () => {
    setLocale("fr");
    const html = render("overview");
    for (const label of [">Général<", ">Connaissances<", ">Analytique<", ">Réglages<", ">Canaux<", ">Accès<", ">Plus<", ">Avant d&#x27;agir<", ">Quand il agit seul<"]) expect(html).toContain(label);
    // the channels are in place on General (#3398); a sub-page's modal is named in French (#4470)
    for (const label of [">Courriel<", ">Me joindre<"]) expect(html).toContain(label);
    // the header's mascot is named in French (its tooltip and aria-label)
    expect(html).toContain('aria-label="Apparence"');
    expect(html).toContain('title="Apparence"');
    const rules = render("rules");
    expect(rules).toMatch(/data-bot-page-modal="page-rules"[\s\S]*?<h2 [^>]*>Règles<\/h2>/);
    expect(rules).toContain('aria-label="Fermer"');
  });

  it("renders nothing when closed or when the bot is gone", () => {
    fixture.state = { bots: [bot], personaEditor: null };
    expect(renderToStaticMarkup(createElement(PersonaEditorModal))).toBe("");
    fixture.state = { bots: [other], personaEditor: { botId: "pepper", section: "overview" } };
    expect(renderToStaticMarkup(createElement(PersonaEditorModal))).toBe("");
  });

  it("opens a link on the sub-page that holds its section, shown in place (V6, #2612)", () => {
    expect(botProfileTabFor("overview")).toBe("general");
    expect(botProfileTabFor("appearance")).toBe("general");
    expect(botProfileTabFor("slack")).toBe("general");
    expect(botProfileTabFor("summary")).toBe("general");
    expect(botProfileTabFor("soul")).toBe("general");
    expect(botProfileTabFor("model")).toBe("general");
    expect(botProfileTabFor("history")).toBe("general");
    expect(botProfileTabFor("memory")).toBe("knowledge");
    expect(botProfileTabFor("usage")).toBe("stats");
    expect(botProfileSubPageFor("soul")).toBe("personality");
    // M-20261119-081: the folder is in place on Knowledge, no sub-page
    expect(botProfileSubPageFor("memory")).toBeNull();
    expect(botProfileSubPageFor("files")).toBeNull();
    expect(botProfileSubPageFor("routines")).toBe("routines");
    // #3398: the channels and the accounts are cards in place on General
    expect(botProfileSubPageFor("slack")).toBeNull();
    expect(botProfileSubPageFor("access")).toBeNull();
    expect(personaCategoryForSection("routines")).toBeNull();
    // the skills have no sub-page: the Bot folder's "..." opens the Skills card in a modal (M-20261119-081)
    expect(botProfileSubPageFor("skills")).toBeNull();
    for (const section of ["model", "voice", "soul", "history", "rules"] as const) {
      const html = render(section);
      const page = botProfileSubPageFor(section)!;
      expect(subPageOf(html), section).toBe(page);
      expect(html).toContain(`data-bot-profile-subpage="${page}"`);
      // #4470: a sub-page is a modal over the page (its title and intro in the header), the tab row under it
      expect(html).toContain(`data-bot-page-modal="page-${page}"`);
      expect(html).toContain('role="tablist"');
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
    expect(accounts).toContain("This bot has no access yet");
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
    // Share is the same round icon button as the X: no word, a name and a tooltip, the 18px glyph
    for (const cls of CIRCLE_CLOSE_BUTTON.split(" ")) expect(share).toContain(cls);
    expect(share).toContain('aria-label="Share"');
    expect(share).toContain('title="Share"');
    const shareStart = html.indexOf("data-bot-profile-share");
    const shareInner = html.slice(html.indexOf(">", shareStart) + 1, html.indexOf("</button>", shareStart));
    expect(shareInner).not.toMatch(/>\s*Share\s*</);
    expect(shareInner).toContain('width="18"');
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

// #4420 (the owner 2026-11-15, a capture of the reference above Sagax:
// "il manque des subtilités pour avoir un look identique"): the header
// measured on the reference app's bot page.
describe("regression #4420: the bot page's header is the reference's", () => {
  it("puts Share then the round close button together at the top right, nothing at the top left of the home", () => {
    const html = render("overview");
    const bar = at(html, "data-bot-profile-topbar");
    const column = at(html, 'data-bot-profile-column=""');
    const actions = at(html, 'data-bot-profile-topbar-actions=""');
    const share = at(html, 'data-bot-profile-share=""');
    const close = at(html, "data-window-close");
    expect(actions).toBeGreaterThan(bar);
    // the right group holds Share, then the X, its last control
    expect(share).toBeGreaterThan(actions);
    expect(close).toBeGreaterThan(share);
    expect(close).toBeLessThan(column);
    // nothing before the right group: no X, no name (#5371)
    expect(html.slice(bar, actions)).not.toContain("data-window-close");
    // Share is a round icon button with no word (2026-11-19), named for assistive tech
    const shareButton = html.slice(share, html.indexOf("</button>", share));
    expect(shareButton).toContain("<svg");
    expect(shareButton).not.toMatch(/>\s*Share\s*</);
    expect(shareButton).toContain('aria-label="Share"');
  });

  it("draws a 124px banner, the mascot on its lower edge, the name at 26px medium, and one left edge for the name, the tabs and the cards' labels", () => {
    const html = render("overview");
    expect(html).toMatch(/class="[^"]*bot-profile-banner[^"]*h-\[124px\][^"]*w-full[^"]*shrink-0/);
    expect(html).toMatch(/data-bot-profile-hero=""[^>]*class="relative -mt-\[84px\] /);
    expect(html).toMatch(/<h2 id="bot-profile-title" data-bot-profile-title="" class="[^"]*text-\[26px\] font-medium leading-8 tracking-\[-0\.015em\]/);
    // the header 12px into the column; the cards' grey labels on the same edge
    expect(html).toMatch(/<header data-bot-profile-header=""[^>]*class="flex min-w-0 flex-col px-3"/);
    const settings = at(html, 'data-settings-group="bot-profile-group-settings"');
    const labelRow = html.slice(settings, html.indexOf("</h3>", settings));
    expect(labelRow).toMatch(/class="flex min-w-0 items-center gap-1\.5 px-3"/);
    // what Sagax shows beyond the reference stays: the label, who sees it, the description, the search, Outcomes
    for (const marker of ['data-bot-profile-label=""', "data-bot-profile-audience", "data-bot-profile-search-toggle", 'data-bot-profile-tab="outcomes"']) expect(html).toContain(marker);
  });
});

describe("General cards and sub-pages", () => {
  it("the General tab holds the channel rows, the accounts with their Add button and the two switches in place (#3398); no Personality and no Shared with row", () => {
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
    expect(at(settings, 'data-settings-row="botCollaboratorsCreateRoutines"')).toBeLessThan(at(settings, 'data-bot-profile-subpage-open="model"'));
    expect(settings).not.toContain('data-bot-profile-subpage-open="personality"');
    // Channels in place: no team chat row where the server offers no link (Slack is removed for now)
    const channels = general.slice(at(general, 'data-settings-group="bot-profile-channels"'), at(general, 'data-settings-group="bot-profile-accounts"'));
    expect([...channels.matchAll(/data-bot-profile-row="([\w-]+)"/g)].map((match) => match[1])).toEqual(["email", "reachMe", "messages"]);
    expect(general).not.toContain('data-bot-profile-row="slack"');
    expect(general).not.toContain("Not offered here");
    expect(channels).toContain("pepper@bots.example");
    expect(channels).toContain('data-bot-profile-action="email"');
    expect(channels).toContain('data-bot-profile-action="reachMe"');
    // Access in place (#4075), one name, its Add button
    const accounts = general.slice(at(general, 'data-settings-group="bot-profile-accounts"'));
    expect(general).not.toContain("What it can use");
    expect([...accounts.matchAll(/data-bot-profile-row="([\w-]+)"/g)].map((match) => match[1]).slice(0, 1)).toEqual(["account-0"]);
    // the engine is not a row of Access any more (owner 2026-11-19): Settings > Model holds it
    expect(accounts.slice(0, accounts.indexOf("bot-profile-group-more") > 0 ? accounts.indexOf("bot-profile-group-more") : undefined)).not.toContain('data-bot-profile-row="engine"');
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
    // Shared with is no page and no row (owner 2026-11-19): a link to it opens the top bar's
    // Share popover (the people are managed in ONE place), the page shows its button once
    const html = render("sharing");
    expect(subPageOf(html)).toBeUndefined();
    expect(html).not.toContain('data-bot-profile-row="sharing"');
    expect(html).not.toContain('data-bot-profile-share-open=""');
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

  it("says when the access list is loading and when the bot has none", () => {
    expect(render("access")).toContain("Loading access");
    fixture.capabilities = { engine: { kind: "claude", label: "Claude Code" }, items: [] };
    expect(render("access")).toContain("This bot has no access yet");
  });

  it("each row carries its name, description and value; the permissions and access pieces each live in one sub-page", () => {
    fixture.state = {};
    const html = render("overview");
    for (const id of ["model", "beforeActing", "actsAlone"]) expect(html).toContain(`data-bot-profile-row="page-${id}"`);
    // owner 2026-11-19: no row for Personality (SOUL.md in Folder and memory opens it) and none for Shared with (the Share popover)
    for (const id of ["personality", "sharing"]) expect(html).not.toContain(`data-bot-profile-row="page-${id}"`);
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
  // M-20261119-081: To review, then the Bot folder in place; no Skills card, no Write a command, no Its work
  it("draws To review and the Bot folder in place; no Skills card, no Routines or Folder and memory row", () => {
    expect(KNOWLEDGE_SECTIONS).toEqual(["skills", "files"]);
    for (const id of KNOWLEDGE_SECTIONS) {
      const html = render(id);
      expect(selectedTab(html), id).toBe("knowledge");
      expect(subPageOf(html), id).toBeUndefined();
      // nothing waits in this first paint, so the To review card is not drawn
      // (M-20261125-066); with a learning staged it comes first, as
      // BotFolderCard.dom.test.ts checks
      expect(html).not.toContain('data-settings-group="bot-profile-review"');
      expect(bodiesOf(sectionHtml(html, "files").html), id).toEqual(["files"]);
      expect(html).not.toContain('data-bot-profile-row="page-routines"');
      expect(html).not.toContain('data-bot-profile-row="page-folder"');
      expect(html).not.toContain('data-bot-profile-row="page-skills"');
      // the Skills card is not on the tab (it opens in a modal from the folder's menu)
      expect(html).not.toContain('data-section-body="skills"');
      expect(html).not.toContain(">Its work<");
    }
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
    // the skills are managed from the Bot folder (M-20261119-081), named in French too
    expect(render("skills")).toContain('aria-label="Dossier du bot"');
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
