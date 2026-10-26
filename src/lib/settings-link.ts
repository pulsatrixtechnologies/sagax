// A sentence that used to say "Settings > Connections" names the section the
// screen actually shows, and a button opens it. The label is the same one
// the Settings navigation uses, so a renamed section updates every pointer.
import type { LocaleKey } from "@/locales";
import { t } from "@/lib/i18n";
import { requestSettingsCard } from "@/components/SettingsPrimitives";
import type { AppSettingsSection } from "@/state/store";
import { currentSettingsCard, currentSettingsSection, mergedSettingsCard } from "@/lib/settings-sections";

export { currentSettingsSection, mergedSettingsCard };

const SECTION_LABEL = {
  general: "settings.section.general",
  organization: "settings.section.organization",
  appearance: "settings.section.appearance",
  experimental: "settings.section.experimental",
  // Integrations, Connected apps and Decision model are in Models and voice
  // (2026-10-14); Privacy and Memory are cards of Notifications and
  // Organization. A pointer names the page that shows them.
  connections: "settings.section.modelsVoice",
  connectedApps: "settings.section.modelsVoice",
  decisionModel: "settings.section.modelsVoice",
  engines: "settings.section.modelsVoice",
  // Pair devices, Activity and Email are hidden (2026-10-14), People and
  // Installations too (2026-10-15): a pointer names the page an old link opens.
  companion: "settings.section.general",
  computer: "settings.section.computer",
  usage: "settings.section.usage",
  credentials: "settings.section.credentials",
  people: "settings.section.general",
  mail: "settings.section.general",
  activity: "settings.section.general",
  backups: "settings.section.backups",
  import: "settings.section.import",
  workspaces: "settings.section.general",
  privacy: "settings.section.notifications",
  notifications: "settings.section.notifications",
  memory: "settings.section.organization",
  updates: "settings.updates.title",
  security: "settings.section.security",
  pages: "settings.section.pages",
} as const satisfies Record<AppSettingsSection, LocaleKey>;

export type SettingsLinkTarget = { section: AppSettingsSection; cardId?: string };

export function settingsSectionLabel(section: AppSettingsSection): string {
  return t(SECTION_LABEL[section]);
}

type SettingsDispatch = (action:
  | { type: "toggleAppSettings"; open: true; section: AppSettingsSection }
  | { type: "togglePlugins"; open: true; page: "orgAccess" }) => void;

/** Cards that moved out of Settings: Plugins and GitHub is Connect apps >
 * Manage > Organization sources and access (2026-10-15). */
const MOVED_TO_CONNECT_APPS = new Set(["organization.plugins"]);

/** Opens Settings on a section, and a card when the sentence points at one.
 * A section that became a card of another page opens that card. */
export function openSettings(dispatch: SettingsDispatch, section: AppSettingsSection, cardId?: string): void {
  if (cardId && MOVED_TO_CONNECT_APPS.has(cardId)) {
    dispatch({ type: "togglePlugins", open: true, page: "orgAccess" });
    return;
  }
  dispatch({ type: "toggleAppSettings", open: true, section: currentSettingsSection(section, cardId) });
  const card = cardId ? currentSettingsCard(cardId) : mergedSettingsCard(section);
  if (card) requestSettingsCard(card);
}

/** Settings > Models and voice, at the list of keys: where a model that
 * cannot run gets its key (New bot's "no model works" line, 2026-10-14). */
export function openModelKeysSettings(dispatch: SettingsDispatch): void {
  openSettings(dispatch, "engines", "engines.keys");
}

export type SettingsLinkPart = { kind: "text"; text: string } | { kind: "link"; name: string };

/** `{name}` in a translated sentence is a settings link. Other text stays text. */
export function settingsLinkParts(text: string): SettingsLinkPart[] {
  const parts: SettingsLinkPart[] = [];
  const pattern = /\{(\w+)\}/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ kind: "text", text: text.slice(last, index) });
    parts.push({ kind: "link", name: match[1] ?? "" });
    last = index + match[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  if (parts.length === 0) parts.push({ kind: "text", text });
  return parts;
}
