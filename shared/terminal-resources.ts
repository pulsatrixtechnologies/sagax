/** Terminal-capable resources: one abstraction for every shell provider. */

export const TERMINAL_IDLE_MS = 15 * 60_000;
export const TERMINAL_MAX_SESSIONS_PER_PERSON = 3;
export const TERMINAL_WS_MAX_FRAME_BYTES = 256 * 1024;
/** Size a shell starts at before the widget measured itself. */
export const TERMINAL_DEFAULT_COLS = 100;
export const TERMINAL_DEFAULT_ROWS = 28;

/** Stable provider ids; adapters register under these kinds. */
export type TerminalProviderKind =
  | "ssh"
  | "unraid"
  | "sandbox"
  | "docker-exec"
  | "vps"
  | "local-vm"
  | "desktop"
  | "cloud-vm"
  | "tailcat"
  | "test";

export type TerminalResourceStatus = "online" | "offline" | "unknown";

/** Who may open a resource (2026-10-15, JC):
 * - "server": a host of the server (SSH, unRAID, VPS). An organization admin
 *   only, as before.
 * - "personal": the signed-in person's own environment (their cloud
 *   computer, their Local VM, their own computer through the Sagax app).
 *   They may open it for their own bot; it always resolves to the person
 *   who opens it, never to someone else's. */
export type TerminalResourceScope = "server" | "personal";

/** A resource the person may open in the in-chat terminal. Credentials never
 * leave the server; the client only sees labels and ids. */
export interface TerminalResource {
  id: string;
  provider: TerminalProviderKind;
  /** Short title ("Serveur unRAID", "Bureau cloud"). */
  label: string;
  /** Host line in the widget header (hostname or alias). */
  hostLabel: string;
  status: TerminalResourceStatus;
  /** Québec-friendly hint when offline. */
  statusNote?: string;
  /** Bot that last offered this resource in the thread, when scoped. */
  botId?: string;
  /** Absent on rows from an older server: treated as "server". */
  scope?: TerminalResourceScope;
}

/** One destination the approval card offers. */
export interface TerminalDestinationChoice {
  resourceId: string;
  provider: TerminalProviderKind;
  label: string;
  hostLabel: string;
}

/** Text frames the widget sends beside the keystrokes (binary frames). */
export type TerminalControlMessage = { type: "resize"; cols: number; rows: number };

/** A resize the widget asked for, or null. Bounds keep a bad frame harmless. */
export function parseTerminalControl(text: string): TerminalControlMessage | null {
  if (!text.startsWith("{") || text.length > 200) return null;
  try {
    const value = JSON.parse(text) as { type?: unknown; cols?: unknown; rows?: unknown };
    if (value.type !== "resize") return null;
    const cols = Number(value.cols);
    const rows = Number(value.rows);
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 1 || cols > 1000 || rows > 500) return null;
    return { type: "resize", cols, rows };
  } catch {
    return null;
  }
}

export interface TerminalSessionPublic {
  id: string;
  resourceId: string;
  provider: TerminalProviderKind;
  hostLabel: string;
  label: string;
  status: "connecting" | "live" | "ended";
  endedReason?: "idle" | "closed" | "error" | "denied";
  openedAt: number;
  lastActivityAt: number;
  /** When true, the bot may send input only if the person enabled it. */
  botInputAllowed: boolean;
}

/** Embedded terminal block in the chat transcript. */
export interface TerminalEmbed {
  sessionId: string;
  resourceId: string;
  provider: TerminalProviderKind;
  hostLabel: string;
  label: string;
  status: TerminalSessionPublic["status"] | "ended";
  endedReason?: TerminalSessionPublic["endedReason"];
}

export function terminalResourceKey(provider: TerminalProviderKind, id: string): string {
  return `${provider}:${id}`;
}

export function parseTerminalResourceKey(key: string): { provider: TerminalProviderKind; id: string } | null {
  const split = key.indexOf(":");
  if (split <= 0) return null;
  const provider = key.slice(0, split) as TerminalProviderKind;
  const id = key.slice(split + 1);
  if (!id) return null;
  return { provider, id };
}
