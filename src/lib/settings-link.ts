// A sentence that used to say "Settings > Connections" names the section the
// screen actually shows, and a button opens it. The label is the same one
// the Settings navigation uses, so a renamed section updates every pointer.
import type { LocaleKey } from "@/locales";
import { requestAbout } from "@/lib/about-ui";
import { requestProviderRow } from "@/lib/provider-row-request";
import { t } from "@/lib/i18n";
import { requestSettingsCard } from "@/components/SettingsPrimitives";
import type { AppSettingsSection } from "@/state/store";
import { currentSettingsCard, currentSettingsSection, mergedSettingsCard } from "@/lib/settings-sections";

export { currentSettingsSection, mergedSettingsCard };

const SECTION_LABEL = {
  account: "settings.section.account",
  general: "settings.section.general",
  organization: "settings.section.organization",
  appearance: "settings.section.appearance",
  experimental: "settings.section.experimental",
  // Integrations, Connected apps and Decision model are in Models
  // (2026-10-14, "Models and voice" until 2026-10-28, when Voice became a
  // page of its own); Privacy and Memory are cards of Notifications and
  // Organization. A pointer names the page that shows them.
  connections: "settings.section.providers",
  connectedApps: "settings.section.models",
  decisionModel: "settings.section.models",
  engines: "settings.section.models",
  providers: "settings.section.providers",
  voice: "settings.section.voice",
  // Pair devices, Activity and Email are hidden (2026-10-14), People and
  // Installations too (2026-10-15): a pointer names the page an old link opens.
  companion: "settings.section.account",
  computer: "settings.section.computer",
  usage: "settings.section.usage",
  // 2026-10-28: Security and Vault are pages again.
  credentials: "settings.section.vault",
  people: "settings.section.account",
  mail: "settings.section.account",
  activity: "settings.section.account",
  backups: "settings.section.backupsAndStorage",
  import: "settings.section.backupsAndStorage",
  workspaces: "settings.section.account",
  privacy: "settings.section.notifications",
  notifications: "settings.section.notifications",
  memory: "settings.section.organization",
  updates: "settings.updates.title",
  // About (was Help and about, JC 2026-11-07); a bare link opens the About window (requestAbout).
  about: "settings.section.about",
  security: "settings.section.security",
  // Published pages are a section of Connect apps > Manage (2026-10-26).
  pages: "connectApps.title",
} as const satisfies Record<AppSettingsSection, LocaleKey>;

export type SettingsLinkTarget = { section: AppSettingsSection; cardId?: string };

export function settingsSectionLabel(section: AppSettingsSection): string {
  return t(SECTION_LABEL[section]);
}

type SettingsDispatch = (action:
  | { type: "toggleAppSettings"; open: true; section: AppSettingsSection }
  | { type: "togglePlugins"; open: true; page: "pages" | "providers" | "sources" }) => void;

/** Opens Settings on a section, and a card when the sentence points at one.
 * A section that became a card of another page opens that card. */
export function openSettings(dispatch: SettingsDispatch, section: AppSettingsSection, cardId?: string): void {
  // Published pages moved to Connect apps > Manage (2026-10-26).
  if (section === "pages") {
    dispatch({ type: "togglePlugins", open: true, page: "pages" });
    return;
  }
  // The About window is its own centred modal; a card (about.* /
  // general.*) opens the page that holds it (CARD_HOME) instead.
  if (section === "about" && !(cardId && /^(about|general)\./.test(cardId))) {
    requestAbout();
    return;
  }
  // The organization's sources and access moved to Connect apps > Sources
  // (2026-10-27).
  if (cardId === "organization.plugins") {
    dispatch({ type: "togglePlugins", open: true, page: "sources" });
    return;
  }
  dispatch({ type: "toggleAppSettings", open: true, section: currentSettingsSection(section, cardId) });
  const card = cardId ? currentSettingsCard(cardId) : mergedSettingsCard(section);
  if (card) requestSettingsCard(card);
}

/** Settings > Providers (2026-10-30; Models > Keys until then): where a
 * model that cannot run gets its key (New bot's "no model works" line). */
export function openModelKeysSettings(dispatch: SettingsDispatch): void {
  openSettings(dispatch, "providers", "providers.list");
}

/** Settings > Providers with the Claude engine row open: where the engine's
 * claude.ai sign-in is changed (a claude.ai card's "Reconnect the account"). */
export function openClaudeEngineSettings(dispatch: SettingsDispatch): void {
  openSettings(dispatch, "providers", "providers.list");
  requestProviderRow("claude");
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
