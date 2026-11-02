// Client helpers for Connect apps > Mac > Messages.
import { api } from "@/state/store";
import type {
  MessagesSetupStatus,
  MessagesSetupTestResult,
  MessagesPrivacyPane,
} from "../../shared/mac-messages-setup.ts";

export type { MessagesSetupStatus, MessagesSetupTestResult, MessagesPrivacyPane };

export async function loadMessagesSetup(): Promise<MessagesSetupStatus | null> {
  try {
    return await api<MessagesSetupStatus>("/api/messages");
  } catch {
    return null;
  }
}

export async function setMessagesEnabled(useMessages: boolean): Promise<MessagesSetupStatus> {
  return api<MessagesSetupStatus>("/api/messages", {
    method: "PUT",
    body: JSON.stringify({ useMessages }),
  });
}

export async function testMessagesSetup(): Promise<MessagesSetupTestResult> {
  return api<MessagesSetupTestResult>("/api/messages/test", { method: "POST", body: "{}" });
}

export async function openMessagesPermissionPane(pane: MessagesPrivacyPane): Promise<void> {
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
