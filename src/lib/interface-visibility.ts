// What Simple mode hides. Advanced shows the screen as it is. The composer
// decides for itself (JC, 2026-10-14): two approval choices instead of five
// (ApprovalModeSelector), no place chip unless the conversation has one
// pinned (Composer). The providers behind "Provider ›" (ModelMenu) are no
// longer Simple's alone (2026-10-18). Hiding never changes a
// stored value, and nothing in these lists is required to chat: engine
// sign-in stays on the model picker and the empty-engines screen.
// 2026-10-15: Usage shows in Simple too: it is the person's own plan and
// cost, and a member who chose Simple must see it.
import type { AppSettingsSection, BotSettingsSection } from "@/state/store";

const HIDDEN_SETTINGS: ReadonlySet<AppSettingsSection> = new Set([
  "experimental",
  "connections",
  "connectedApps",
  "decisionModel",
  "engines",
  "computer",
  "mail",
  "activity",
  "backups",
  "import",
  "workspaces",
  "people",
]);

const HIDDEN_BOT: ReadonlySet<BotSettingsSection> = new Set([
  "access",
  "worksOn",
  "perspicax",
  "usage",
  "history",
  "skills",
]);

export function simpleHidesSettingsSection(id: AppSettingsSection): boolean {
  return HIDDEN_SETTINGS.has(id);
}

export function simpleHidesBotSection(id: BotSettingsSection): boolean {
  return HIDDEN_BOT.has(id);
}

export function simpleHidesPanelTab(id: string): boolean {
  return id === "computer";
}
