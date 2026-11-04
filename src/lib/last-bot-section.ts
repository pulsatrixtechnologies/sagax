// Which bot-settings section this device last had open. One section for all
// bots: the panel remounts per bot (App keys it by bot id), so the store
// keeps the pointer during a session and this lib carries it across launches.
import type { BotSettingsSection } from "@/state/settings-section";

export const LAST_BOT_SECTION_KEY = "openmausbot.lastBotSection.v1";

/** Every section id the rail can show; the test cross-checks this list
 * against BOT_SECTIONS so the two cannot drift. */
export const BOT_SETTINGS_SECTION_IDS: readonly BotSettingsSection[] = [
  "overview",
  "appearance",
  "summary",
  "slack",
  "soul",
  "rules",
  "skills",
  "memory",
  "files",
  "routines",
  "access",
  "worksOn",
  "model",
  "permissions",
  "voice",
  "visibility",
  "sharing",
  "history",
  "usage",
];

/** The section viewed here last, or null when storage holds nothing usable -
 * absent, or an id outside the rail (a value an older or future build could
 * leave behind). */
export function readLastBotSection(): BotSettingsSection | null {
  try {
    const stored = globalThis.localStorage?.getItem(LAST_BOT_SECTION_KEY);
    return stored && (BOT_SETTINGS_SECTION_IDS as readonly string[]).includes(stored)
      ? stored as BotSettingsSection
      : null;
  } catch {
    return null;
  }
}

/** Remember the section viewed for the next launch. */
export function rememberBotSection(section: BotSettingsSection): void {
  try {
    globalThis.localStorage?.setItem(LAST_BOT_SECTION_KEY, section);
  } catch {
    // Private windows may refuse storage; the choice holds for this session.
  }
}
