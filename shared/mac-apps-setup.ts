// The Apple apps of the person's Mac in Plugins > This Mac (one row each).
// Messages keeps its own setup (shared/mac-messages-setup.ts); the others share
// one setup page. The same status comes from the solo server (/api/mac-apps) or,
// with an organization server, from the desktop app over IPC (window.ogb.macApps).
import type { MessagesPermissionState } from "./mac-messages-setup.ts";

export const MAC_APP_SETUP_IDS = ["messages", "mail", "calendar", "contacts", "reminders", "notes"] as const;
export type MacAppSetupId = (typeof MAC_APP_SETUP_IDS)[number];

export const isMacAppSetupId = (value: unknown): value is MacAppSetupId =>
  typeof value === "string" && (MAC_APP_SETUP_IDS as readonly string[]).includes(value);

export type MacAppSetupRow = {
  id: MacAppSetupId;
  enabled: boolean;
  permissions: { automation: MessagesPermissionState; fullDiskAccess?: MessagesPermissionState };
};

export type MacAppsSetupStatus = {
  available: boolean;
  onThisMac: boolean;
  reason?: string;
  apps: MacAppSetupRow[];
};

export type MacAppTestResult = { ok: boolean; error?: string; count: number; names: string[] };

/** The bot tools each app gives (electron/mac-apps.mjs MAC_APP_TOOLS). */
export const MAC_APP_SETUP_TOOLS: Record<MacAppSetupId, readonly string[]> = {
  messages: ["mac_messages_read", "mac_messages_send"],
  mail: ["mac_mail_search", "mac_mail_read", "mac_mail_send"],
  calendar: ["mac_calendar_list", "mac_calendar_create"],
  contacts: ["mac_contacts_search"],
  reminders: ["mac_reminders_list", "mac_reminders_create"],
  notes: ["mac_notes_search", "mac_notes_create"],
};

/** Where a setup page is: Plugins > This Mac > <app>. */
export const macAppSubpage = (id: MacAppSetupId) => `mac-${id}` as const;

/** The section shows only in the desktop app on macOS. */
export function macAppsSectionVisible(ogb: { platform?: string } | null | undefined): boolean {
  return Boolean(ogb) && ogb?.platform === "darwin";
}
