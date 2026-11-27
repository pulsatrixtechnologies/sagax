// Which Settings page a section id opens today. The ids live in
// settings-section.ts so this file does not import the store.
import type { AppSettingsSection } from "@/state/settings-section";
import type { LocaleKey } from "@/locales";

/** Sections that are a card of another page now, and that card.
 * 2026-10-14: Integrations ("connections") and Models and accounts
 * ("engines") became one page, Models and voice ("engines").
 * 2026-10-14 (menu simplification, Settings lot): Decision model is a card
 * of Models and voice, Privacy joined Notifications, Memory joined
 * Organization and Email is a card of People. An old link, deep link or
 * saved section keeps working: it opens the page that holds the card, and
 * openSettings opens the card. */
const MERGED: Partial<Record<AppSettingsSection, { section: AppSettingsSection; cardId: string }>> = {
  // 2026-10-30: keys are on Providers
  connections: { section: "providers", cardId: "providers.list" },
  decisionModel: { section: "engines", cardId: "engines.decisionModel" },
  // #4457: Privacy is a card of Permissions
  privacy: { section: "security", cardId: "notifications.privacy" },
  memory: { section: "organization", cardId: "organization.memory" },
  // #2080 (L0): Import is a card of Backups and import.
  import: { section: "backups", cardId: "backups.import" },
  // #2729 (JC 2026-11-08): Experimental is a card of Developer; an old link,
  // deep link or saved section opens Developer on that card.
  experimental: { section: "developer", cardId: "experimental.features" },
  // 2026-10-26 to 2026-10-28 Security keys and the vault were cards of
  // Account; since 2026-10-28 Security ("security") and Vault
  // ("credentials") are pages again (CARD_HOME below sends the old links).
};

/** Cards that moved to another page on 2026-10-28, by the page that holds
 * them now. A link names a page and, often, a card: the card wins, so an old
 * link (Account > Security keys, Models and voice > Voice) opens the page
 * where the card is today.
 * - Security: security keys, the approval rules and the person's tool access
 *   (they were under Account).
 * - Vault: the vault, the one-time card, purchases and 1Password (they were
 *   under Account).
 * - Voice: voice choice, Live calls and the microphone. Provider keys and
 *   endpoints now live in Providers, including old personal-voice-key links. */
export const CARD_HOME: Readonly<Record<string, AppSettingsSection>> = {
  security: "security",
  "security.keys": "security",
  myApprovalRules: "security",
  myToolAccess: "security",
  "credentials.items": "credentials",
  "credentials.wallets": "credentials",
  "credentials.purchases": "credentials",
  "credentials.payments.methods": "credentials",
  "credentials.payments.default": "credentials",
  "credentials.payments.bots": "credentials",
  "credentials.payments.history": "credentials",
  "credentials.onePassword": "credentials",
  "connections.voice": "voice",
  "voice.advanced": "voice",
  // #4457: the microphone is a row of General > System
  "voice.microphone": "general",
  "connections.audio": "general",
  "connections.voiceKeys": "providers",
  // 2026-10-30 (Providers, lot 1): the engines' sign-ins and every key are on Providers
  "engines.keys": "providers",
  "engines.list": "providers",
  "engines.legacy": "providers",
  "engines.setup": "providers",
  "engines.moreProviders": "providers",
  // 2026-11-05 (option B): image generation and web search are Providers > Other services
  "connections.image": "providers",
  "connections.webSearch": "providers",
  // #4329 lot 1: this computer's models and the servers for pi are providers
  // of the list; their cards open on Providers, then on the provider's page.
  "computer.localModels": "providers",
  "providers.localModels": "providers",
  "providers.modelServers": "providers",
  // what stays on Models: online computers, Decision model
  "connections.integrations": "engines",
  "engines.decisionModel": "engines",
  // JC 2026-11-06: the App catch-all split. People's tool access lives on
  // Security, startup and keys on General, feedback on About.
  "general.peopleToolAccess": "security",
  "general.system": "general",
  "general.input": "general",
  "general.interface": "general",
  "general.bots": "general",
  "general.feedback": "about",
  // #2636 (JC 2026-11-07): the technical options are one page, Developer.
  // An old card id (its page of 2026-11-06, or Organization > Bot rules)
  // opens Developer; the card ids themselves did not change.
  "general.threadCleanup": "developer",
  "general.usage": "developer",
  "general.loopGuard": "developer",
  "general.telemetry": "developer",
  "general.diagnostics": "developer",
  "general.logs": "developer",
  "experimental.developer": "developer",
  // #2729: the Experimental features card is on Developer
  "experimental.features": "developer",
  "experimental.needsServerUpdate": "developer",
  "developer.conversation": "developer",
  "developer.diagnostics": "developer",
  "developer.devPods": "developer",
  "organization.roomTurns": "developer",
  "organization.mcpCalls": "developer",
  // #2658 (lot 2): the bot page's technical cards and the Claude Code switches
  "developer.bot": "developer",
  "developer.claudeCode": "developer",
  // old App card ids (#2080 L2) open the page that holds their rows now
  "about.startup": "general",
  "about.input": "general",
  "about.holding": "general",
  "about.help": "about",
  "about.about": "about",
};

/** Sections hidden from the app since 2026-10-14 (managing several
 * people is Sagax Business's job; the app shows what concerns the person
 * signed in). Their server routes stay. An old link opens the nearest page:
 * Account. General is a page again since 2026-11-06 (system, keys, Advanced mode). 2026-10-15: People and Installations joined them, so Email (a
 * card of People) opens General too. */
const HIDDEN: Partial<Record<AppSettingsSection, AppSettingsSection>> = {
  // #4457: Account is a card of General; these open General.
  companion: "general",
  activity: "general",
  mail: "general",
  people: "general",
  workspaces: "general",
  // Published pages moved to Connect apps > Manage; openSettings opens it there.
  pages: "general",
};

/** Cards of General > Advanced that moved to Organization (2026-10-15):
 * they set how the organization's bots work, not this computer. Old card id
 * to new card id. Thread cleanup, pre-releases and diagnostics stay in
 * General > Advanced. On a desktop with no server (Organization hidden) the
 * same cards stay in General > Advanced, under their new ids. */
export const ORGANIZATION_CARDS_MOVED: Record<string, string> = {
  "general.routinesInConversation": "organization.routinesInConversation",
  // #2636: the two timeouts are on Developer now (CARD_HOME); their ids stay.
  "general.roomTurns": "organization.roomTurns",
  "general.mcpCalls": "organization.mcpCalls",
};

const ORGANIZATION_CARD_IDS = new Set(Object.values(ORGANIZATION_CARDS_MOVED));

/** The id a card has today: an old General > Advanced card id names its
 * Organization card. */
export function currentSettingsCard(cardId: string): string {
  return ORGANIZATION_CARDS_MOVED[cardId] ?? cardId;
}

/** Whether a card is one of those moved from General > Advanced. */
export function isMovedOrganizationCard(cardId: string | null | undefined): boolean {
  return Boolean(cardId) && ORGANIZATION_CARD_IDS.has(currentSettingsCard(cardId!));
}

/** #4457 (the owner, 2026-11-16): Settings has seven pages, with no group
 * titles, as the reference app: General, Computer, Permissions, Vault,
 * Providers, Usage, Updates. Permissions keeps the id "security" (its old
 * links, the keys and rules, land there); the old "permissions" page (this
 * computer's OS permissions) is one of its sub-pages. */
export const RAIL_PAGES = ["general", "computer", "security", "credentials", "providers", "usage", "updates"] as const satisfies readonly AppSettingsSection[];

/** Organization left the rail (#4457: everything is managed in the
 * organization console). Its page stays, reached by the search and by its
 * own address, until the console offers each of its settings. */
export const OFF_RAIL_PAGES = ["organization"] as const satisfies readonly AppSettingsSection[];

/** A sub-page of a page (src/components/SettingsSubPage.tsx): the rail page
 * that holds it, its title, and the former section whose visibility rules it
 * keeps (`gate`: shown where that section would have been). The page itself
 * is drawn by src/components/settings/settings-sub-pages.tsx. */
export interface SettingsSubPageInfo {
  section: AppSettingsSection;
  titleKey: LocaleKey;
  gate?: AppSettingsSection;
}

/** Every sub-page of Settings (#4457 "▸": a page of the settings stack,
 * never a modal). Each holds what a former page or card held; nothing was
 * removed, some things are one page further. */
const SUB_PAGES_DEFINED = {
  // General
  "account.crop": { section: "general", titleKey: "settings.profile.photoCropTitle" },
  "general.appearance": { section: "general", titleKey: "settings.sub.moreAppearance", gate: "appearance" },
  "general.notifications": { section: "general", titleKey: "settings.sub.moreNotifications", gate: "notifications" },
  "general.mascots": { section: "general", titleKey: "settings.mascotsCard.title", gate: "appearance" },
  "general.shortcuts": { section: "general", titleKey: "settings.sub.shortcuts", gate: "general" },
  "general.backups": { section: "general", titleKey: "settings.section.backupsAndStorage", gate: "backups" },
  // Permissions
  "security.rules": { section: "security", titleKey: "myRules.title", gate: "security" },
  "security.toolGrants": { section: "security", titleKey: "myToolAccess.title", gate: "security" },
  "security.peopleToolAccess": { section: "security", titleKey: "settings.toolAccess.people.title", gate: "security" },
  "security.keys": { section: "security", titleKey: "security.keys.title", gate: "security" },
  "security.system": { section: "security", titleKey: "settings.sub.systemPermissions", gate: "permissions" },
  // Providers
  "providers.models": { section: "providers", titleKey: "settings.sub.modelsAndContext", gate: "engines" },
  "providers.voice": { section: "providers", titleKey: "settings.sub.liveCalls", gate: "voice" },
  // Usage
  "usage.traces": { section: "usage", titleKey: "usage.trace.title", gate: "usage" },
  // Updates
  "updates.about": { section: "updates", titleKey: "settings.section.about", gate: "about" },
  // Advanced (former Developer): on General since M-20261127-068
  "general.advanced": { section: "general", titleKey: "settings.advanced.title", gate: "developer" },
} as const satisfies Record<string, SettingsSubPageInfo>;

export type SettingsSubPageId = keyof typeof SUB_PAGES_DEFINED;

export const SETTINGS_SUB_PAGES: Readonly<Record<SettingsSubPageId, SettingsSubPageInfo>> = SUB_PAGES_DEFINED;

/** Old sub-page ids that open the same page under a new id (deep links,
 * saved state, e2e helpers). resolveSubPage and openSubPage map them. */
export const SUB_PAGE_ALIASES: Readonly<Record<string, SettingsSubPageId>> = {
  "updates.advanced": "general.advanced",
};

export function canonicalSubPageId(id: string): string {
  return SUB_PAGE_ALIASES[id] ?? id;
}

/** #4457: where each former page lives now: a rail page, or one of its
 * sub-pages. An old link, deep link or saved section opens it there. */
const SECTION_PLACE: Partial<Record<AppSettingsSection, { section: AppSettingsSection; subPage?: SettingsSubPageId }>> = {
  account: { section: "general" },
  // The theme, accent and language are on General's Appearance card; the
  // rest of the former page is General > More appearance.
  appearance: { section: "general" },
  notifications: { section: "general", subPage: "general.notifications" },
  backups: { section: "general", subPage: "general.backups" },
  // Privacy is a card of Permissions
  privacy: { section: "security" },
  permissions: { section: "security", subPage: "security.system" },
  engines: { section: "providers", subPage: "providers.models" },
  // Connected apps joined Models on 2026-10-14 (settings-link.ts names it so)
  connectedApps: { section: "providers", subPage: "providers.models" },
  voice: { section: "providers", subPage: "providers.voice" },
  // M-20261127-068: Advanced left Updates for the end of General
  developer: { section: "general", subPage: "general.advanced" },
  about: { section: "updates", subPage: "updates.about" },
};

/** Cards that sit on a sub-page of their page (#4457), by card id. A link to
 * one opens that sub-page, where the card is. */
const CARD_SUB_PAGE: Readonly<Record<string, SettingsSubPageId>> = {
  "security.keys": "security.keys",
  security: "security.keys",
  myApprovalRules: "security.rules",
  myToolAccess: "security.toolGrants",
  "general.peopleToolAccess": "security.peopleToolAccess",
  "appearance.mascots-hd": "general.mascots",
  "appearance.mascots": "general.mascots",
  "usage.traces": "usage.traces",
};

/** Where a section id (and, often, a card) opens today: a page of the rail
 * (or Organization) and, when the place is one page further, its sub-page. */
export function settingsTarget(section: AppSettingsSection, cardId?: string): { section: AppSettingsSection; subPage?: SettingsSubPageId } {
  const card = cardId && currentSettingsCard(cardId);
  if (card && Object.hasOwn(CARD_SUB_PAGE, card)) {
    const subPage = CARD_SUB_PAGE[card]!;
    return { section: SETTINGS_SUB_PAGES[subPage].section, subPage };
  }
  let page: AppSettingsSection;
  // A card that has a page of its own since 2026-10-28 opens that page
  // (#2636: the timeouts of Bot rules are on Developer, checked first).
  if (card && Object.hasOwn(CARD_HOME, card)) page = CARD_HOME[card]!;
  // A link to a card moved to Organization opens Organization.
  else if (card && isMovedOrganizationCard(card)) page = "organization";
  else page = MERGED[section]?.section ?? HIDDEN[section] ?? section;
  return SECTION_PLACE[page] ?? { section: page };
}

export function currentSettingsSection(section: AppSettingsSection, cardId?: string): AppSettingsSection {
  return settingsTarget(section, cardId).section;
}

/** The card an old section id stands for, opened when a link names only the
 * section. Undefined for a section that is still a page. */
export function mergedSettingsCard(section: AppSettingsSection): string | undefined {
  return MERGED[section]?.cardId;
}

/** #4329 lot 1: an old card of a Providers row that lives on a provider's
 * page now. `computer`: this computer's models; `row`: the Advanced of an
 * engine, a key or a server (`providers.advanced.<id>`), opened on the page
 * of the provider that holds that id. Null for any other card (Providers'
 * own Advanced and its claude.ai connectors stay on the list). */
export function providerCardTarget(cardId: string | null | undefined): { kind: "computer" } | { kind: "botsLink" } | { kind: "row"; id: string } | null {
  if (!cardId) return null;
  // #4329 lot 2: the bots link left Providers > Advanced for the xAI provider's page
  if (cardId === "providers.linkedGrokBot" || cardId.startsWith("providers.linkedGrokBot.")) return { kind: "botsLink" };
  if (cardId === "computer.localModels" || cardId === "providers.localModels" || cardId === "computer.localModels.endpoints") return { kind: "computer" };
  const prefix = "providers.advanced.";
  if (!cardId.startsWith(prefix)) return null;
  const id = cardId.slice(prefix.length);
  // the account connectors' cards (#4408: one per provider) stay on Providers
  return id && id !== "connectors" && !id.startsWith("connectors.") ? { kind: "row", id } : null;
}
