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

/** The bot's profile page (#2126, #2173, #2271, Grok Bot's layout). Its
 * top is the bot's appearance: the banner, the mascot, "Name · Label", the
 * description and the colour, edited in place, with the full Appearance
 * pane unfolding under them. Under that, four pill tabs, each a page of
 * cards in two columns (one under 900px):
 *
 * - General: the channels, the bot's accounts, What it does, Shared with,
 *   Who can see it.
 * - Knowledge: Skills, Personality, Rules, the Bot folder.
 * - Model & tools: Model, Workspace, Access, Permissions, Voice & alerts.
 * - Activity: Usage, Changes. */
export type BotProfileTab = "general" | "knowledge" | "tools" | "activity";
export const BOT_PROFILE_TABS = ["general", "knowledge", "tools", "activity"] as const satisfies readonly BotProfileTab[];

/** The sections the page's header shows itself (the identity and the
 * appearance): on every tab, never a tab. */
export const HEADER_SECTIONS = ["overview", "appearance"] as const satisfies readonly PersonaCategory[];
export type HeaderSection = (typeof HEADER_SECTIONS)[number];

/** Knowledge's sections, in order (the memory is managed in the Bot folder). */
export const KNOWLEDGE_SECTIONS = ["skills", "soul", "rules", "files"] as const satisfies readonly PersonaCategory[];

/** Each tab's sections, in the page's order. Slack is a row of General's
 * Channels card. */
export const BOT_PROFILE_TAB_SECTIONS: Readonly<Record<BotProfileTab, readonly PersonaCategory[]>> = {
  general: ["slack", "summary", "sharing", "visibility"],
  knowledge: KNOWLEDGE_SECTIONS,
  tools: ["model", "worksOn", "access", "permissions", "voice"],
  activity: ["usage", "history"],
};

export function isHeaderSection(id: PersonaCategory): id is HeaderSection {
  return (HEADER_SECTIONS as readonly string[]).includes(id);
}

/** The tab whose page holds `category`, or null for a header section. */
export function botProfileTabOf(category: PersonaCategory): BotProfileTab | null {
  if (isHeaderSection(category)) return null;
  return BOT_PROFILE_TABS.find((tab) => BOT_PROFILE_TAB_SECTIONS[tab].includes(category)) ?? "general";
}

/** The tab a link to `section` opens: the header's sections and the bot
 * panel's land on General, the rest on the tab that holds them. */
export function botProfileTabFor(section: BotSettingsSection | null | undefined): BotProfileTab {
  if (!section) return "general";
  const category = personaCategoryForSection(section);
  if (!category) return "general";
  return botProfileTabOf(category) ?? "general";
}
