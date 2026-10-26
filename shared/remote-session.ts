import { UUID_FRAGMENT } from "./human-id.ts";

/** A Tailcat remote-support session as the chat and the bot panel may show it.
 * The tunnel address, the node key and the client key never appear here. */

export const REMOTE_SESSION_ID = /^[a-f0-9]{12}$/;
export const REMOTE_SESSION_CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

export type RemoteSessionOs = "windows" | "macos" | "linux";
export type RemoteSessionState = "connected" | "ended";

export interface RemoteSessionSuggestion {
  id: string;
}

/** Facts safe to put in the chat. Strings are already trimmed and bounded. */
export interface RemoteSessionFacts {
  hostname?: string;
  osName?: string;
  user?: string;
  model?: string;
  serial?: string;
  cpu?: string;
  /** Display string, for example "16 Go". */
  ram?: string;
  /** Display string, for example "120 Go libres sur 476 Go". */
  disk?: string;
  /** 0 to 100 when both sizes were read. */
  diskFreePercent?: number;
  ramGb?: number;
}

/** Why the facts (and the screen) are or are not there, so the card says it
 * instead of n/a everywhere:
 * - pending: Sagax is reading the computer (inventory in progress);
 * - ready: read;
 * - no-tunnel: this server does not have the session's tunnel (opened
 *   outside Sagax, for example by a script on another computer);
 * - no-answer: the tunnel is here but the computer did not answer;
 * - os-unknown: the computer answered neither uname nor PowerShell;
 * - no-client: this Sagax server has no ssh client (tailcat execs it). */
export type RemoteInventoryState = "pending" | "ready" | "no-tunnel" | "no-answer" | "os-unknown" | "no-client";

export interface RemoteSessionView {
  id: string;
  code: string;
  state: RemoteSessionState;
  os: RemoteSessionOs;
  elevated: boolean;
  endAt: string;
  hostname?: string;
  osName?: string;
  user?: string;
  model?: string;
  serial?: string;
  cpu?: string;
  ram?: string;
  disk?: string;
  /** The session the Computer tab is showing. Absent on the others. */
  focused?: boolean;
  /** Absent on a card written before 2026-10-22 (treated as ready). */
  inventory?: RemoteInventoryState;
  /** False while the OS is not known yet (`os` is then only a placeholder). */
  osKnown?: boolean;
  /** A server without a desktop (Server Core, a Linux server): shell only. */
  headless?: boolean;
  /** macOS refused the screenshot: Screen Recording is not allowed for the
   * program that runs the session on that Mac. */
  screenDenied?: boolean;
  suggestions: RemoteSessionSuggestion[];
}

const TUNNEL = /tc[0-9A-Za-z_-]{24,}/g;
const GUID = new RegExp(UUID_FRAGMENT.source, "gi");
const NODEKEY = /nodekey:[0-9a-f]{64}/gi;
// oxlint-disable-next-line no-control-regex -- public text must not keep control characters
const CONTROL = /[\u0000-\u001f\u007f]/g;

/** Drop a tunnel token and control characters before anything is stored or shown. */
export function publicText(value: unknown, max = 160): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(TUNNEL, "").replace(NODEKEY, "").replace(GUID, "").replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;
  return cleaned.slice(0, max);
}

export function parseRemoteSessionId(value: unknown): string | null {
  const id = typeof value === "string" ? value.trim().toLowerCase() : "";
  return REMOTE_SESSION_ID.test(id) ? id : null;
}

export function parseRemoteSessionCode(value: unknown): string | null {
  const code = typeof value === "string" ? value.trim().toUpperCase().replace(/-/g, "") : "";
  return REMOTE_SESSION_CODE.test(code) ? code : null;
}

/** The longest Tailcat address both sides accept (the support folder and the tunnel reader). */
export const TAILCAT_ADDRESS_MAX = 8000;

/** `tc` then at least 8 characters, TAILCAT_ADDRESS_MAX in all, no space, no control character. */
export function isTailcatAddress(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("tc") && value.length >= 10 && value.length <= TAILCAT_ADDRESS_MAX && !/\s/.test(value)
    // oxlint-disable-next-line no-control-regex -- a tunnel address never contains control characters
    && !/[\u0000-\u001f\u007f]/.test(value);
}

/** A session's end: at most 15 minutes past and 26 hours ahead (Perspicax caps
 * an open at 24 hours). The same bound for publish_remote_session and for an
 * open the bot made through a Perspicax profile. Null when outside it. */
export function parseRemoteSessionEnd(value: unknown, now: number): number | null {
  if (typeof value !== "string") return null;
  const end = Date.parse(value);
  if (!Number.isFinite(end) || end < now - 15 * 60_000 || end > now + 26 * 60 * 60_000) return null;
  return end;
}

export function parseRemoteSessionOs(value: unknown): RemoteSessionOs | null {
  return value === "windows" || value === "macos" || value === "linux" ? value : null;
}

/** "17 h 15" in the given zone (the viewer's zone when omitted). */
export function formatEndLabel(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("fr-CA", {
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23",
    ...(timeZone ? { timeZone } : {}),
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value ?? "";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "";
  if (!hour || !minute) return "";
  return `${hour} h ${minute}`;
}

export function formatGigabytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "";
  const rounded = Math.round(value * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace(".", ",");
  return `${text} Go`;
}

/** "120 Go libres sur 476 Go". Empty when the sizes are missing. */
export function formatDisk(freeGb: number, totalGb: number): { text: string; freePercent?: number } {
  if (!Number.isFinite(freeGb) || !Number.isFinite(totalGb) || totalGb <= 0 || freeGb < 0) return { text: "" };
  const text = `${formatGigabytes(freeGb)} libres sur ${formatGigabytes(totalGb)}`;
  return { text, freePercent: Math.round((freeGb / totalGb) * 1000) / 10 };
}

const INVENTORY_KEYS = new Set([
  "hostname", "user", "model", "serial", "cpu", "os", "admin", "gui",
  "ramBytes", "diskFreeKb", "diskTotalKb",
]);

/** Read the fixed `key=value` lines a probe prints. Anything else is ignored. */
export function parseInventory(stdout: string): {
  hostname?: string;
  user?: string;
  model?: string;
  serial?: string;
  cpu?: string;
  osName?: string;
  elevated?: boolean;
  /** false: no desktop on that computer (shell only). */
  gui?: boolean;
  ramGb?: number;
  diskFreeGb?: number;
  diskTotalGb?: number;
} {
  const out: Record<string, string> = {};
  for (const line of stdout.split(/\r?\n/)) {
    const split = line.indexOf("=");
    if (split <= 0) continue;
    const key = line.slice(0, split).trim();
    if (!INVENTORY_KEYS.has(key)) continue;
    const value = publicText(line.slice(split + 1), 200);
    if (value) out[key] = value;
  }
  const ramBytes = Number(out.ramBytes);
  const freeKb = Number(out.diskFreeKb);
  const totalKb = Number(out.diskTotalKb);
  const admin = out.admin?.toLowerCase();
  const gui = out.gui?.toLowerCase();
  return {
    ...(out.hostname ? { hostname: out.hostname } : {}),
    ...(out.user ? { user: out.user } : {}),
    ...(out.model ? { model: out.model } : {}),
    ...(out.serial ? { serial: out.serial } : {}),
    ...(out.cpu ? { cpu: out.cpu } : {}),
    ...(out.os ? { osName: out.os } : {}),
    ...(admin === "true" || admin === "false" ? { elevated: admin === "true" } : {}),
    ...(gui === "true" || gui === "false" ? { gui: gui === "true" } : {}),
    ...(Number.isFinite(ramBytes) && ramBytes > 0 ? { ramGb: ramBytes / (1024 ** 3) } : {}),
    ...(Number.isFinite(freeKb) && freeKb >= 0 ? { diskFreeGb: freeKb / (1024 ** 2) } : {}),
    ...(Number.isFinite(totalKb) && totalKb > 0 ? { diskTotalGb: totalKb / (1024 ** 2) } : {}),
  };
}

/** Short diagnostic hints from the facts we actually read. Ids only: the UI translates them. */
export function remoteSessionSuggestions(facts: RemoteSessionFacts, elevated: boolean): RemoteSessionSuggestion[] {
  const ids: string[] = [];
  if (facts.diskFreePercent !== undefined && facts.diskFreePercent < 15) ids.push("disk-critical");
  else if (facts.diskFreePercent !== undefined && facts.diskFreePercent < 30) ids.push("disk-low");
  if (facts.ramGb !== undefined && facts.ramGb < 8) ids.push("ram-low");
  if (!elevated) ids.push("rights");
  ids.push("cpu", "errors", "startup");
  return ids.slice(0, 5).map((id) => ({ id }));
}

/** A download path the person typed. No traversal, no tunnel token, no control characters. */
export function safeRemotePath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.replace(CONTROL, "").trim();
  if (!path || path.length > 400) return null;
  if (TUNNEL.test(path)) return null;
  TUNNEL.lastIndex = 0;
  const parts = path.split(/[\\/]/);
  if (parts.some((part) => part === "..")) return null;
  return path;
}

/** A file name we choose the destination folder for. */
export function safeUploadName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(CONTROL, "").trim();
  if (!name || name.length > 120 || name.includes("/") || name.includes("\\") || name.startsWith(".")) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._ -]*$/.test(name)) return null;
  return name;
}
