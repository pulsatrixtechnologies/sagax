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

/** The bot's profile page (#2126, #2173, Grok Bot's layout): a row of pill
 * tabs. General holds the channels, the bot's accounts and the identity,
 * Knowledge what it knows and how it behaves, then one tab per setting
 * (Appearance, Shared with, What it does, Model, ...). */
export type BotProfileTab = "general" | "knowledge" | SettingsTab;

/** Knowledge's sections, in order (the memory is managed in the Bot folder). */
export const KNOWLEDGE_SECTIONS = ["skills", "soul", "rules", "files"] as const satisfies readonly PersonaCategory[];

/** The sections General shows itself: the identity is the page's header,
 * Slack a row of Channels. */
const GENERAL_SECTIONS: ReadonlySet<PersonaCategory> = new Set(["slack"]);

/** Settings' sections, in the editor's order: every page that is neither a
 * Knowledge section nor shown by General. The identity (description and
 * facts) stays here as its first section. */
export const SETTINGS_SECTIONS: readonly PersonaCategory[] = PERSONA_CATEGORIES.filter(
  (id) => !GENERAL_SECTIONS.has(id) && !(KNOWLEDGE_SECTIONS as readonly PersonaCategory[]).includes(id),
);

/** The settings that are tabs of their own (#2173): every setting but the
 * identity, which General shows under its cards. */
export type SettingsTab = Exclude<PersonaCategory, "overview" | "slack" | (typeof KNOWLEDGE_SECTIONS)[number]>;
export const SETTINGS_TABS: readonly SettingsTab[] = SETTINGS_SECTIONS.filter((id): id is SettingsTab => id !== "overview");

export const BOT_PROFILE_TABS: readonly BotProfileTab[] = ["general", "knowledge", ...SETTINGS_TABS];

export function isSettingsTab(tab: BotProfileTab): tab is SettingsTab {
  return (SETTINGS_TABS as readonly string[]).includes(tab);
}

/** The tab a link to `section` opens: the plain opening (Identity) and
 * Slack are General, the instructions Knowledge, every other setting its
 * own tab. */
export function botProfileTabFor(section: BotSettingsSection | null | undefined): BotProfileTab {
  if (!section || section === "overview" || section === "details" || section === "routines") return "general";
  const category = personaCategoryForSection(section);
  if (!category || category === "overview" || GENERAL_SECTIONS.has(category)) return "general";
  if ((KNOWLEDGE_SECTIONS as readonly PersonaCategory[]).includes(category)) return "knowledge";
  return category as SettingsTab;
}
