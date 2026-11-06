// Client helpers for Plugins > This Mac > Messages.
//
// Solo: the local server answers /api/messages. With an organization server,
// that server answers 404 messages_not_on_this_mac (Messages lives on this Mac,
// not on the server), so the desktop app answers the same over IPC
// (window.ogb.macApps). Without either, the loader throws a readable error:
// the page never stays blank.
import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import type {
  MessagesSetupStatus,
  MessagesSetupTestResult,
  MessagesPrivacyPane,
} from "../../shared/mac-messages-setup.ts";
import type { MacAppsSetupStatus } from "../../shared/mac-apps-setup.ts";

export type { MessagesSetupStatus, MessagesSetupTestResult, MessagesPrivacyPane };

/** The server says the Apple apps are not on it (organization server, web). */
export function notOnThisMac(cause: unknown): boolean {
  const failure = cause as { status?: unknown; body?: { code?: unknown } } | null;
  const code = failure?.body?.code;
  return failure?.status === 404 && (code === "messages_not_on_this_mac" || code === "mac_apps_not_on_this_mac" || code === undefined);
}

/** The desktop app's own Apple apps, when this page runs in it on a Mac. */
export function desktopMacApps() {
  const ogb = typeof window === "undefined" ? undefined : window.ogb;
  return ogb?.platform === "darwin" && ogb.macApps ? ogb.macApps : null;
}

/** Server first; on "not on this Mac", the desktop app; else a readable error. */
export async function viaServerOrDesktop<T>(server: () => Promise<T>, desktop: (macApps: NonNullable<ReturnType<typeof desktopMacApps>>) => Promise<T>): Promise<T> {
  try {
    return await server();
  } catch (cause) {
    if (!notOnThisMac(cause)) throw cause;
    const macApps = desktopMacApps();
    if (!macApps) throw new Error(t("connectApps.mac.notOnThisMac"));
    return desktop(macApps);
  }
}

export function messagesFromMacApps(status: MacAppsSetupStatus): MessagesSetupStatus {
  const row = status.apps.find((app) => app.id === "messages");
  return {
    available: status.available,
    onThisMac: status.onThisMac,
    ...(status.available ? {} : { reason: "not_darwin" as const }),
    useMessages: row?.enabled === true,
    permissions: {
      fullDiskAccess: row?.permissions.fullDiskAccess ?? "unknown",
      automation: row?.permissions.automation ?? "unknown",
    },
  };
}

export async function loadMessagesSetup(): Promise<MessagesSetupStatus> {
  return viaServerOrDesktop(
    () => api<MessagesSetupStatus>("/api/messages"),
    async (macApps) => messagesFromMacApps(await macApps.status()),
  );
}

export async function setMessagesEnabled(useMessages: boolean): Promise<MessagesSetupStatus> {
  return viaServerOrDesktop(
    () => api<MessagesSetupStatus>("/api/messages", { method: "PUT", body: JSON.stringify({ useMessages }) }),
    async (macApps) => messagesFromMacApps(await macApps.set("messages", useMessages)),
  );
}

export async function testMessagesSetup(): Promise<MessagesSetupTestResult> {
  return viaServerOrDesktop(
    () => api<MessagesSetupTestResult>("/api/messages/test", { method: "POST", body: "{}" }),
    async (macApps) => {
      const result = await macApps.test("messages");
      if (!result.ok) throw new Error(result.error ?? t("connectApps.mac.testFailed"));
      return { conversationCount: result.count, names: result.names };
    },
  );
}

export async function openMessagesPermissionPane(pane: MessagesPrivacyPane): Promise<void> {
  const macApps = desktopMacApps();
  if (macApps) {
    await macApps.openSettings(pane);
    return;
  }
  const electronPane = pane === "fullDiskAccess" ? "fullDisk" : "automation";
  if (window.ogb?.permOpenSettings) {
    await window.ogb.permOpenSettings(electronPane);
    return;
  }
  await api("/api/messages/permissions/open", {
    method: "POST",
    body: JSON.stringify({ pane }),
  });
}

/** Status chip for a permission row. */
export function permissionTone(state: string): "ok" | "warn" | "muted" {
  if (state === "granted") return "ok";
  if (state === "denied") return "warn";
  return "muted";
}
