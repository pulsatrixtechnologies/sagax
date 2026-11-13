// Which persona editor page shows a bot settings section. The bot panel
// keeps only Details (with Routines), Library and Computer; every other
// section is reached through the persona editor, so a deep link to one opens
// the editor on that section's own page (store: toggleSettings).
//
// The editor's left column lists groups (2026-10-14); each section of a
// group is its own page (2026-10-15: one long page with Appearance at the
// bottom was confusing). A group's first page is its home: Profile opens on
// the bot's identity, and its other pages (Appearance, Shared with, What it
// does) are listed under it. Permissions, Voice, Usage and Changes are entries of their own
// (2026-10-15). Memory and its files are one page, the Bot folder.
import type { BotSettingsSection } from "@/state/settings-section";

/** Every page the editor can show, in the order they appear. */
export const PERSONA_CATEGORIES = [
  "overview",
  "appearance",
  "sharing",
  "visibility",
  "summary",
  "soul",
  "rules",
  "skills",
  "files",
  "model",
  "worksOn",
  "access",
  "slack",
  "permissions",
  "voice",
  "usage",
  "history",
] as const satisfies readonly BotSettingsSection[];
export type PersonaCategory = (typeof PERSONA_CATEGORIES)[number];

/** The groups of the editor's left column, each with its pages (the first is
 * the group's home). 2026-10-16 (the editor's rail follows Settings'):
 * each group is a grey heading over its pages, every page an entry of its
 * own; the Bot folder joins Instructions, Voice joins Model and tools,
 * Usage and Changes are Activity. */
export const PERSONA_GROUPS = [
  { id: "profile", sections: ["overview", "appearance", "sharing", "visibility", "summary"] },
  { id: "instructions", sections: ["soul", "rules", "skills", "files"] },
  { id: "modelTools", sections: ["model", "worksOn", "access", "slack", "voice"] },
  { id: "security", sections: ["permissions"] },
  { id: "activity", sections: ["usage", "history"] },
] as const satisfies ReadonlyArray<{ id: string; sections: readonly PersonaCategory[] }>;
export type PersonaGroup = (typeof PERSONA_GROUPS)[number]["id"];

/** Sections that stay in the bot panel (the Details tab). */
const PANEL_SECTIONS: ReadonlySet<BotSettingsSection> = new Set(["details", "routines"]);

/** Sections shown inside another page: the memory is managed in the Bot
 * folder (2026-10-15). */
const FOLDED_INTO: Partial<Record<BotSettingsSection, PersonaCategory>> = {
  memory: "files",
};

export function isPersonaCategory(id: BotSettingsSection): id is PersonaCategory {
  return (PERSONA_CATEGORIES as readonly string[]).includes(id);
}

/** The persona page that shows `section`, or null when the bot panel does. */
export function personaCategoryForSection(section: BotSettingsSection): PersonaCategory | null {
  if (PANEL_SECTIONS.has(section)) return null;
  return isPersonaCategory(section) ? section : FOLDED_INTO[section] ?? "overview";
}

/** The group whose pages include `section`. */
export function personaGroupOf(section: BotSettingsSection): PersonaGroup {
  const category = personaCategoryForSection(section) ?? "overview";
  return PERSONA_GROUPS.find((group) => (group.sections as readonly PersonaCategory[]).includes(category))?.id ?? "profile";
}

/** The pages of a group, in order. */
export function personaGroupSections(group: PersonaGroup): readonly PersonaCategory[] {
  return PERSONA_GROUPS.find((entry) => entry.id === group)?.sections ?? [];
}

/** The bot's profile page, V6 (#2612, the "Épuré Grok Bot" canvas): the
 * hero (banner, mascot, name with its title under it, description), then
 * the tabs. General is section cards with their controls in place (#3398);
 * a row opens its own sub-page (Back, a title, one line of intro, then the
 * same section bodies as before) only for a setting too long for a card.
 * Stats shows the usage in place.
 *
 * - General: Settings (two switches in place, then Personality, Model,
 *   Appearance, Before it acts), the Channels card and the Access card in
 *   place, More (Shared with, Rules, When it acts alone, Voice, Advanced
 *   settings, Versions). Appearance is a row whose sub-page holds the whole
 *   mascot editor (character, shape, colour, style, moves): no tab of its
 *   own any more, to keep fewer tabs (the owner 2026-11-13, #4147).
 * - Knowledge (#3400): To review and Skills in place (the learnings that
 *   wait, decided in place; the skills with their "+ Add"), then Its work
 *   (Routines, Folder and memory).
 * - Stats: the usage over 7, 30 or 90 days.
 * - Outcomes (#4098), the second tab: each result the person wants kept
 *   true, read from the bot's routines (shared/outcomes.ts); it holds no
 *   section of its own. No Updates tab: what a bot reports is told once,
 *   in its one conversation. */
export type BotProfileTab = "general" | "outcomes" | "knowledge" | "stats";
export const BOT_PROFILE_TABS = ["general", "outcomes", "knowledge", "stats"] as const satisfies readonly BotProfileTab[];

/** The sub-pages a row of a tab opens. */
export const BOT_PROFILE_SUBPAGES = [
  "personality",
  "model",
  "appearance",
  "beforeActing",
  "sharing",
  "rules",
  "actsAlone",
  "voice",
  "advanced",
  "versions",
  "routines",
  "folder",
] as const;
export type BotProfileSubPage = (typeof BOT_PROFILE_SUBPAGES)[number];

/** The persona sections whose deep link opens each sub-page (a sub-page
 * with none, such as When it acts alone, holds parts of other sections). */
export const BOT_PROFILE_SUBPAGE_SECTIONS: Readonly<Record<BotProfileSubPage, readonly PersonaCategory[]>> = {
  personality: ["summary", "soul"],
  model: ["model", "worksOn"],
  appearance: ["appearance"],
  beforeActing: ["permissions"],
  sharing: ["sharing", "visibility"],
  rules: ["rules"],
  actsAlone: [],
  voice: ["voice"],
  advanced: [],
  versions: ["history"],
  routines: [],
  folder: ["files"],
};

/** The cards a tab draws in place, controls and all (#3398): the
 * channels and the bot's accounts; Knowledge's To review and Skills
 * (#3400). Not sub-pages any more. */
export const BOT_PROFILE_CARDS = ["channels", "accounts", "skills"] as const;
export type BotProfileCard = (typeof BOT_PROFILE_CARDS)[number];

/** The persona sections each in-place card holds (a deep link to one opens
 * the General tab at its card). */
export const BOT_PROFILE_CARD_SECTIONS: Readonly<Record<BotProfileCard, readonly PersonaCategory[]>> = {
  channels: ["slack"],
  accounts: ["access"],
  skills: ["skills"],
};

/** The card's grey group on the page, for a deep link to scroll to. */
export const BOT_PROFILE_CARD_GROUP: Readonly<Record<BotProfileCard, string>> = {
  channels: "bot-profile-channels",
  accounts: "bot-profile-accounts",
  // a link to the skills lands on To review, the top of the two cards
  skills: "bot-profile-review",
};

/** The groups of each tab in the page's order: a card drawn in place, or
 * rows under a grey label that each open a sub-page. Shared with is under
 * More: the Channels card holds channels only (sharing's other door is the
 * Share button of the top bar). */
export const BOT_PROFILE_TAB_GROUPS: Readonly<Record<BotProfileTab, ReadonlyArray<{ id: string; pages: readonly BotProfileSubPage[]; card?: BotProfileCard }>>> = {
  general: [
    { id: "settings", pages: ["personality", "model", "appearance", "beforeActing"] },
    { id: "channels", pages: [], card: "channels" },
    { id: "accounts", pages: [], card: "accounts" },
    { id: "more", pages: ["sharing", "rules", "actsAlone", "voice", "advanced", "versions"] },
  ],
  outcomes: [],
  knowledge: [
    { id: "skills", pages: [], card: "skills" },
    { id: "work", pages: ["routines", "folder"] },
  ],
  stats: [],
};

/** The header's section (the identity): on every tab, never a row. */
export const HEADER_SECTIONS = ["overview"] as const satisfies readonly PersonaCategory[];
export type HeaderSection = (typeof HEADER_SECTIONS)[number];

/** Each tab's sub-pages, in order. */
export function botProfileTabPages(tab: BotProfileTab): readonly BotProfileSubPage[] {
  return BOT_PROFILE_TAB_GROUPS[tab].flatMap((group) => group.pages);
}

/** Each tab's in-place cards, in order. */
export function botProfileTabCards(tab: BotProfileTab): readonly BotProfileCard[] {
  return BOT_PROFILE_TAB_GROUPS[tab].flatMap((group) => (group.card ? [group.card] : []));
}

/** Each tab's sections, through its sub-pages and its cards (Stats holds
 * its section itself). */
export const BOT_PROFILE_TAB_SECTIONS: Readonly<Record<BotProfileTab, readonly PersonaCategory[]>> = {
  general: [
    ...botProfileTabPages("general").flatMap((page) => BOT_PROFILE_SUBPAGE_SECTIONS[page]),
    ...botProfileTabCards("general").flatMap((card) => BOT_PROFILE_CARD_SECTIONS[card]),
  ],
  outcomes: [],
  knowledge: [
    ...botProfileTabCards("knowledge").flatMap((card) => BOT_PROFILE_CARD_SECTIONS[card]),
    ...botProfileTabPages("knowledge").flatMap((page) => BOT_PROFILE_SUBPAGE_SECTIONS[page]),
  ],
  stats: ["usage"],
};

/** Knowledge's sections, in order (the memory is managed in the folder). */
export const KNOWLEDGE_SECTIONS = BOT_PROFILE_TAB_SECTIONS.knowledge;

export function isHeaderSection(id: PersonaCategory): id is HeaderSection {
  return (HEADER_SECTIONS as readonly string[]).includes(id);
}

/** The sub-page that holds `category`, or null (the header, Usage). */
export function botProfileSubPageOf(category: PersonaCategory): BotProfileSubPage | null {
  return BOT_PROFILE_SUBPAGES.find((page) => BOT_PROFILE_SUBPAGE_SECTIONS[page].includes(category)) ?? null;
}

/** The in-place card that holds `category`, or null. */
export function botProfileCardOf(category: PersonaCategory): BotProfileCard | null {
  return BOT_PROFILE_CARDS.find((card) => BOT_PROFILE_CARD_SECTIONS[card].includes(category)) ?? null;
}

/** The tab of a sub-page. */
export function botProfileTabOfPage(page: BotProfileSubPage): BotProfileTab {
  return BOT_PROFILE_TABS.find((tab) => botProfileTabPages(tab).includes(page)) ?? "general";
}

/** The tab whose page holds `category`, or null for a header section. */
export function botProfileTabOf(category: PersonaCategory): BotProfileTab | null {
  if (isHeaderSection(category)) return null;
  if (category === "usage") return "stats";
  const page = botProfileSubPageOf(category);
  if (page) return botProfileTabOfPage(page);
  const card = botProfileCardOf(category);
  return BOT_PROFILE_TABS.find((tab) => card !== null && botProfileTabCards(tab).includes(card)) ?? "general";
}

/** The tab a link to `section` opens: the header's sections and the bot
 * panel's land on General, the rest on the tab that holds them. */
export function botProfileTabFor(section: BotSettingsSection | null | undefined): BotProfileTab {
  if (!section) return "general";
  const category = personaCategoryForSection(section);
  if (!category) return "general";
  return botProfileTabOf(category) ?? "general";
}

/** The sub-page a link to `section` opens, or null (the tab's list). */
export function botProfileSubPageFor(section: BotSettingsSection | null | undefined): BotProfileSubPage | null {
  if (!section) return null;
  if (section === "routines") return "routines";
  const category = personaCategoryForSection(section);
  return category ? botProfileSubPageOf(category) : null;
}
