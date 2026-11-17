// Client helpers for Plugins > This Mac (Mail, Calendar, Contacts, Reminders,
// Notes; Messages has src/lib/mac-messages-setup.ts). Solo: /api/mac-apps.
// Organization server: the desktop app over IPC (window.ogb.macApps).
import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import type { MacAppPermissionNeed, MacAppSetupId, MacAppsSetupStatus, MacAppTestResult } from "../../shared/mac-apps-setup.ts";
import type { MessagesSetupStatus } from "../../shared/mac-messages-setup.ts";
import { desktopMacApps, viaServerOrDesktop } from "./mac-messages-setup";

export type { MacAppPermissionNeed, MacAppSetupId, MacAppsSetupStatus, MacAppTestResult };

/** Messages setup comes from /api/messages, which has no actions. The one
 * list is the mac-apps status. A failure keeps the page on its two paragraphs. */
export async function attachMessagesActions(status: MessagesSetupStatus): Promise<MessagesSetupStatus> {
  if (!status.available || (status.actions && status.actions.length > 0)) return status;
  try {
    const mac = await loadMacApps();
    const actions = mac.apps.find((row) => row.id === "messages")?.actions;
    if (!actions || actions.length === 0) return status;
    return { ...status, actions };
  } catch {
    return status;
  }
}

export async function loadMacApps(): Promise<MacAppsSetupStatus> {
  return viaServerOrDesktop(() => api<MacAppsSetupStatus>("/api/mac-apps"), (macApps) => macApps.status());
}

export async function setMacAppEnabled(app: MacAppSetupId, enabled: boolean): Promise<MacAppsSetupStatus> {
  return viaServerOrDesktop(
    () => api<MacAppsSetupStatus>("/api/mac-apps", { method: "PUT", body: JSON.stringify({ app, enabled }) }),
    (macApps) => macApps.set(app, enabled),
  );
}

/** Test: names and a count from the app, never content. Throws its error. */
export async function testMacApp(app: MacAppSetupId): Promise<MacAppTestResult> {
  const result = await viaServerOrDesktop(
    () => api<MacAppTestResult>("/api/mac-apps/test", { method: "POST", body: JSON.stringify({ app }) }),
    (macApps) => macApps.test(app),
  );
  if (!result.ok) throw new Error(result.error ?? t("connectApps.mac.testFailed"));
  return result;
}

/** "Ask for access": the macOS Automation prompt for this app, then the
 * refreshed status. */
export async function askMacAppAutomation(app: MacAppSetupId): Promise<MacAppsSetupStatus> {
  return viaServerOrDesktop(
    () => api<MacAppsSetupStatus>("/api/mac-apps/permissions/ask", { method: "POST", body: JSON.stringify({ app }) }),
    (macApps) => macApps.askAutomation(app),
  );
}

export async function openMacAppPermissionPane(pane: MacAppPermissionNeed): Promise<void> {
  const macApps = desktopMacApps();
  if (macApps) {
    await macApps.openSettings(pane);
    return;
  }
  if (window.ogb?.permOpenSettings && (pane === "fullDiskAccess" || pane === "automation")) {
    await window.ogb.permOpenSettings(pane === "fullDiskAccess" ? "fullDisk" : "automation");
    return;
  }
  await api("/api/mac-apps/permissions/open", { method: "POST", body: JSON.stringify({ pane }) });
}
