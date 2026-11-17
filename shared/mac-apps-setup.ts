// The Apple apps of the person's Mac in Plugins > This Mac (one row each).
// Messages keeps its own setup (shared/mac-messages-setup.ts); the others share
// one setup page. The same status comes from the solo server (/api/mac-apps) or,
// with an organization server, from the desktop app over IPC (window.ogb.macApps).

export const MAC_APP_SETUP_IDS = ["messages", "mail", "calendar", "contacts", "reminders", "notes"] as const;
export type MacAppSetupId = (typeof MAC_APP_SETUP_IDS)[number];

export const isMacAppSetupId = (value: unknown): value is MacAppSetupId =>
  typeof value === "string" && (MAC_APP_SETUP_IDS as readonly string[]).includes(value);

/** A permission a tool can name. Calendar, Reminders and Contacts are the
 * panes the detail opens when a later status names them. */
export const MAC_APP_PERMISSION_NEEDS = ["fullDiskAccess", "automation", "calendars", "reminders", "contacts"] as const;
export type MacAppPermissionNeed = (typeof MAC_APP_PERMISSION_NEEDS)[number];

const MAC_APP_PRIVACY_ANCHORS: Record<MacAppPermissionNeed, string> = {
  fullDiskAccess: "Privacy_AllFiles",
  automation: "Privacy_Automation",
  calendars: "Privacy_Calendars",
  reminders: "Privacy_Reminders",
  contacts: "Privacy_Contacts",
};

export function isMacAppPermissionNeed(value: unknown): value is MacAppPermissionNeed {
  return typeof value === "string" && (MAC_APP_PERMISSION_NEEDS as readonly string[]).includes(value);
}

/** System Settings anchor for one permission pane. */
export function macAppPrivacyAnchor(pane: MacAppPermissionNeed): string {
  return MAC_APP_PRIVACY_ANCHORS[pane];
}

/** One thing bots can do with an app (electron/mac-apps.mjs MAC_APP_TOOLS):
 * the tool, its class, the permission it needs and whether it is granted. */
/** A macOS permission as the desktop reads it (Messages and every This Mac app). */
export type MessagesPermissionState = "granted" | "denied" | "unknown" | "notAsked" | "unsupported";

export type MacAppSetupAction = {
  tool: string;
  kind: "read" | "write" | "delete" | "send";
  needs: MacAppPermissionNeed;
  granted: boolean;
};

export type MacAppSetupRow = {
  id: MacAppSetupId;
  enabled: boolean;
  permissions: Partial<Record<MacAppPermissionNeed, MessagesPermissionState>> & {
    automation: MessagesPermissionState;
    fullDiskAccess?: MessagesPermissionState;
  };
  /** Absent from an older desktop app. */
  actions?: MacAppSetupAction[];
};

/** What the detail shows: granted actions as the list, the rest under the
 * permission they wait on. Null when the status has no actions (older app). */
export type MacAppDetailActions = {
  offered: MacAppSetupAction[];
  byNeed: MacAppPermissionNeed[];
  waiting: Partial<Record<MacAppPermissionNeed, MacAppSetupAction[]>>;
};

export function macAppDetailActions(actions: readonly MacAppSetupAction[] | undefined): MacAppDetailActions | null {
  if (!actions || actions.length === 0) return null;
  const offered: MacAppSetupAction[] = [];
  const waiting: Partial<Record<MacAppPermissionNeed, MacAppSetupAction[]>> = {};
  const seen = new Set<MacAppPermissionNeed>();
  for (const action of actions) {
    if (!isMacAppPermissionNeed(action.needs)) continue;
    seen.add(action.needs);
    if (action.granted === true) offered.push(action);
    else {
      const bucket = waiting[action.needs] ?? [];
      bucket.push(action);
      waiting[action.needs] = bucket;
    }
  }
  const byNeed = MAC_APP_PERMISSION_NEEDS.filter((need) => seen.has(need));
  if (byNeed.length === 0) return null;
  return { offered, byNeed, waiting };
}

export type MacAppsSetupStatus = {
  available: boolean;
  onThisMac: boolean;
  reason?: string;
  apps: MacAppSetupRow[];
};

export type MacAppTestResult = { ok: boolean; error?: string; count: number; names: string[] };

/** Where a setup page is: Plugins > This Mac > <app>. */
export const macAppSubpage = (id: MacAppSetupId) => `mac-${id}` as const;

/** The section shows only in the desktop app on macOS. */
export function macAppsSectionVisible(ogb: { platform?: string } | null | undefined): boolean {
  return Boolean(ogb) && ogb?.platform === "darwin";
}
