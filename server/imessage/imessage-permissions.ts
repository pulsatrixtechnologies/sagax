// Live macOS permission probes for Messages setup. Full Disk Access is
// whether chat.db opens read-only; Automation is the grant macOS holds for
// Sagax over Messages (read by the helper, never a prompt). Probes never log
// message bodies.
import { existsSync, accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  messagesSetupHostGate,
  type MessagesPermissionState,
  type MessagesSetupPermissions,
  type MessagesSetupStatus,
  type MessagesSetupTestResult,
} from "../../shared/mac-messages-setup.ts";
import type { MessagesHost } from "../../shared/imessage.ts";
import { probeMacAppAutomation, requestMacAppAutomation } from "../../electron/mac-apps.mjs";
import { openMessagesReader } from "./imessage-db.ts";
import { readMessagesSettings } from "./imessage-settings.ts";

export function messagesLibraryDir(home = homedir()): string {
  return join(home, "Library", "Messages");
}

export function messagesChatDbPath(home = homedir()): string {
  return join(messagesLibraryDir(home), "chat.db");
}

/** Probe Full Disk Access by opening chat.db read-only. Existence alone is
 * not enough: without FDA the file can exist and still refuse a read. */
export function probeFullDiskAccess(home = homedir()): MessagesPermissionState {
  if (process.platform !== "darwin") return "unsupported";
  const file = messagesChatDbPath(home);
  if (!existsSync(file)) {
    // No Messages database yet: FDA cannot be confirmed from chat.db.
    try {
      accessSync(messagesLibraryDir(home), constants.R_OK);
      return "unknown";
    } catch {
      return "denied";
    }
  }
  try {
    const opened = openMessagesReader(messagesLibraryDir(home));
    try {
      // Opening alone is not enough: SQLite can open a garbage file. Require
      // the Messages chat table so corrupt or empty stubs count as denied.
      opened.reader.findChats({ limit: 1 });
    } finally {
      opened.close();
    }
    return "granted";
  } catch {
    return "denied";
  }
}

/** The real Automation grant Sagax holds for Messages, read from macOS by the
 * helper (AEDeterminePermissionToAutomateTarget, never a prompt). Before,
 * a tell to Messages here could itself raise the prompt, or report "not
 * asked" forever when Messages was closed. */
export async function probeAutomation(
  probe: typeof probeMacAppAutomation = probeMacAppAutomation,
): Promise<MessagesPermissionState> {
  if (process.platform !== "darwin") return "unsupported";
  return (await probe("messages").catch(() => null)) ?? "unknown";
}

/** "Ask for access": the helper shows the macOS prompt for Messages once. */
export async function askMessagesAutomation(
  dataDir: string,
  request: typeof requestMacAppAutomation = requestMacAppAutomation,
): Promise<MessagesPermissionState> {
  if (process.platform !== "darwin") return "unsupported";
  return request(dataDir, "messages");
}

export async function readMessagesPermissions(home = homedir()): Promise<MessagesSetupPermissions> {
  return {
    fullDiskAccess: probeFullDiskAccess(home),
    automation: await probeAutomation(),
  };
}

/** Recent conversation display names only. Never returns message text. */
export function testMessagesConversationNames(home = homedir(), limit = 20): MessagesSetupTestResult {
  if (probeFullDiskAccess(home) !== "granted") {
    return { conversationCount: 0, names: [] };
  }
  const opened = openMessagesReader(messagesLibraryDir(home));
  try {
    const chats = opened.reader.findChats({ limit });
    const names = chats.map((chat) => {
      const label = (chat.displayName ?? "").trim();
      if (label) return label;
      if (chat.handles[0]) return chat.handles[0];
      return chat.identifier;
    });
    return {
      conversationCount: names.length,
      names: names.slice(0, 8),
    };
  } finally {
    opened.close();
  }
}

export async function buildMessagesSetupStatus(input: {
  dataDir: string;
  host: MessagesHost;
  /** Web / remote renderer without Electron: setup actions are limited. */
  desktopHelper?: boolean;
  home?: string;
}): Promise<MessagesSetupStatus> {
  const gate = messagesSetupHostGate(input.host);
  const useMessages = readMessagesSettings(input.dataDir).useMessages;
  if (!gate.ok) {
    return {
      available: false,
      onThisMac: false,
      reason: gate.reason,
      useMessages: false,
      permissions: { fullDiskAccess: "unsupported", automation: "unsupported" },
    };
  }
  const permissions = await readMessagesPermissions(input.home);
  return {
    available: true,
    onThisMac: true,
    useMessages,
    permissions,
  };
}
