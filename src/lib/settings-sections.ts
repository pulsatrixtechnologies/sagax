// Which Settings page a section id opens today. The ids live in
// settings-section.ts so this file does not import the store.
import type { AppSettingsSection } from "@/state/settings-section";

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
  privacy: { section: "notifications", cardId: "notifications.privacy" },
  memory: { section: "organization", cardId: "organization.memory" },
  // #2080 (L0): Import is a card of Backups and import.
  import: { section: "backups", cardId: "backups.import" },
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
  "voice.microphone": "voice",
  "connections.audio": "voice",
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
  companion: "account",
  activity: "account",
  mail: "account",
  people: "account",
  workspaces: "account",
  // Published pages moved to Connect apps > Manage; openSettings opens it there.
  pages: "account",
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

export function currentSettingsSection(section: AppSettingsSection, cardId?: string): AppSettingsSection {
  // A card that has a page of its own since 2026-10-28 opens that page
  // (#2636: the timeouts of Bot rules are on Developer, checked first).
  const card = cardId && currentSettingsCard(cardId);
  if (card && Object.hasOwn(CARD_HOME, card)) return CARD_HOME[card]!;
  // A link to a card moved to Organization opens Organization.
  if (card && isMovedOrganizationCard(card)) return "organization";
  return MERGED[section]?.section ?? HIDDEN[section] ?? section;
}

/** The card an old section id stands for, opened when a link names only the
 * section. Undefined for a section that is still a page. */
export function mergedSettingsCard(section: AppSettingsSection): string | undefined {
  return MERGED[section]?.cardId;
}
