// Messages setup on the person's own Mac (Connect apps > Mac > Messages).
// Structure mirrors the reference Mac Messages surface; wording and branding
// stay Sagax's. Tools and the enable switch live only on the solo darwin
// process: never on an organization server or through the desktop bridge.

import { messagesOnBotMac, type MessagesHost } from "./imessage.ts";

export type MessagesPermissionState = "granted" | "denied" | "unknown" | "notAsked" | "unsupported";

export type MessagesPermissionId = "fullDiskAccess" | "automation";

export type MessagesSetupPermissions = {
  fullDiskAccess: MessagesPermissionState;
  automation: MessagesPermissionState;
};

export type MessagesSetupStatus = {
  /** Solo Sagax on this Mac can expose the setup. */
  available: boolean;
  /** False on organization servers, non-darwin hosts, and bridge calls. */
  onThisMac: boolean;
  reason?: "not_darwin" | "organization_server" | "bridge_refused" | "web_or_remote";
  useMessages: boolean;
  permissions: MessagesSetupPermissions;
};

export type MessagesSetupTestResult = {
  /** Number of recent conversation names found. Never include message bodies. */
  conversationCount: number;
  /** Truncated display names for the UI only (synthetic in galleries). */
  names: string[];
};

/** System Settings privacy pane anchors for Messages permissions. */
export const MESSAGES_PRIVACY_PANES = {
  fullDiskAccess: "Privacy_AllFiles",
  automation: "Privacy_Automation",
} as const;

export type MessagesPrivacyPane = keyof typeof MESSAGES_PRIVACY_PANES;

export function messagesPrivacyAnchor(pane: MessagesPrivacyPane): string {
  return MESSAGES_PRIVACY_PANES[pane];
}

export function messagesSetupHostGate(host: MessagesHost): {
  ok: boolean;
  reason?: MessagesSetupStatus["reason"];
} {
  const gate = messagesOnBotMac(host);
  if (gate.ok) return { ok: true };
  return { ok: false, reason: gate.reason };
}

/** Steps the setup screen walks, in order. */
export const MESSAGES_SETUP_STEPS = [
  { id: "fullDiskAccess", permission: "fullDiskAccess" as const, purpose: "read" as const },
  { id: "automation", permission: "automation" as const, purpose: "send" as const },
  { id: "test", permission: null, purpose: "test" as const },
  { id: "enable", permission: null, purpose: "enable" as const },
] as const;

export type MessagesSetupStepId = (typeof MESSAGES_SETUP_STEPS)[number]["id"];

/** A step's live status for the checklist. */
export function messagesStepState(input: {
  step: MessagesSetupStepId;
  permissions: MessagesSetupPermissions;
  useMessages: boolean;
  tested: boolean;
  testOk: boolean;
}): "done" | "todo" | "blocked" | "waiting" {
  if (input.step === "fullDiskAccess") {
    if (input.permissions.fullDiskAccess === "granted") return "done";
    if (input.permissions.fullDiskAccess === "denied") return "blocked";
    return "todo";
  }
  if (input.step === "automation") {
    if (input.permissions.automation === "granted") return "done";
    if (input.permissions.automation === "denied") return "blocked";
    if (input.permissions.automation === "notAsked") return "todo";
    return "todo";
  }
  if (input.step === "test") {
    if (input.permissions.fullDiskAccess !== "granted") return "blocked";
    if (input.tested && input.testOk) return "done";
    if (input.tested && !input.testOk) return "blocked";
    return "todo";
  }
  // enable
  if (input.useMessages) return "done";
  if (input.permissions.fullDiskAccess !== "granted") return "blocked";
  return "todo";
}

/** Cap names shown in the test result; never log message bodies. */
export function messagesTestNamesView(names: readonly string[], limit = 8): { conversationCount: number; names: string[] } {
  const clean = names
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, Math.max(0, limit));
  return { conversationCount: names.filter((name) => name.trim()).length, names: clean };
}
