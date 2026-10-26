// Which Settings page a section id opens today. Kept free of imports so the
// store's reducer can use it.
import type { AppSettingsSection } from "@/state/store";

/** Sections that are a card of another page now, and that card.
 * 2026-10-14: Integrations ("connections") and Models and accounts
 * ("engines") became one page, Models and voice ("engines").
 * 2026-10-14 (menu simplification, Settings lot): Decision model is a card
 * of Models and voice, Privacy joined Notifications, Memory joined
 * Organization and Email is a card of People. An old link, deep link or
 * saved section keeps working: it opens the page that holds the card, and
 * openSettings opens the card. */
const MERGED: Partial<Record<AppSettingsSection, { section: AppSettingsSection; cardId: string }>> = {
  connections: { section: "engines", cardId: "engines.keys" },
  decisionModel: { section: "engines", cardId: "engines.decisionModel" },
  privacy: { section: "notifications", cardId: "notifications.privacy" },
  memory: { section: "organization", cardId: "organization.memory" },
};

/** Sections hidden from the app since 2026-10-14 (JC: managing several
 * people is Sagax Business's job; the app shows what concerns the person
 * signed in). Their server routes stay. An old link opens the nearest page:
 * General. 2026-10-15: People and Installations joined them, so Email (a
 * card of People) opens General too. */
const HIDDEN: Partial<Record<AppSettingsSection, AppSettingsSection>> = {
  companion: "general",
  activity: "general",
  mail: "general",
  people: "general",
  workspaces: "general",
};

/** Cards of General > Advanced that moved to Organization (2026-10-15, JC):
 * they set how the organization's bots work, not this computer. Old card id
 * to new card id. Thread cleanup, pre-releases and diagnostics stay in
 * General > Advanced. On a desktop with no server (Organization hidden) the
 * same cards stay in General > Advanced, under their new ids. */
export const ORGANIZATION_CARDS_MOVED: Record<string, string> = {
  "general.routinesInConversation": "organization.routinesInConversation",
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
  // A link to a card moved to Organization opens Organization.
  if (cardId && isMovedOrganizationCard(cardId)) return "organization";
  return MERGED[section]?.section ?? HIDDEN[section] ?? section;
}

/** The card an old section id stands for, opened when a link names only the
 * section. Undefined for a section that is still a page. */
export function mergedSettingsCard(section: AppSettingsSection): string | undefined {
  return MERGED[section]?.cardId;
}
