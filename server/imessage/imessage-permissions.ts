// Live macOS permission probes for Messages setup. Full Disk Access is
// whether chat.db opens read-only; Automation is whether a no-op tell to
// Messages is allowed (never sends). Probes never log message bodies.
import { existsSync, accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  messagesSetupHostGate,
  type MessagesPermissionState,
  type MessagesSetupPermissions,
  type MessagesSetupStatus,
  type MessagesSetupTestResult,
} from "../../shared/mac-messages-setup.ts";
import type { MessagesHost } from "../../shared/imessage.ts";
import { openMessagesReader } from "./imessage-db.ts";
import { readMessagesSettings } from "./imessage-settings.ts";

const execFileAsync = promisify(execFile);

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

/** Probe Automation without sending. A denied tell application "Messages"
 * surfaces as not permitted; success means the grant is on. */
export async function probeAutomation(run: typeof execFileAsync = execFileAsync): Promise<MessagesPermissionState> {
  if (process.platform !== "darwin") return "unsupported";
  try {
    await run("osascript", ["-e", 'tell application "System Events" to get name of first process whose bundle identifier is "com.apple.MobileSMS"'], {
      timeout: 8_000,
      maxBuffer: 64 * 1024,
    });
    // System Events seeing Messages is not the Automation grant for
    // Sagax→Messages. Ask Messages for a read-only property instead.
  } catch {
    // fall through to the Messages tell
  }
  try {
    await run("osascript", ["-e", 'tell application "Messages" to get name'], {
      timeout: 8_000,
      maxBuffer: 64 * 1024,
    });
    return "granted";
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    if (/not authorized|not allowed|1002|(-1743)/i.test(detail)) return "denied";
    if (/Application isn.t running|(-600)|connection is invalid/i.test(detail)) return "notAsked";
    return "unknown";
  }
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
