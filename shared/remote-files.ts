// The remote file browser of a Tailcat session: which folder paths a request
// may name, how a listing reads, and the path arithmetic the browser needs.
// A path is data: the server hands it to the remote computer encoded, never
// pasted into a command (server/remote-session-files.ts).
import type { RemoteSessionOs } from "./remote-session.ts";

/** Entries kept from one folder; the rest is reported as cut. */
export const REMOTE_LIST_MAX = 500;
const PATH_MAX = 400;
// oxlint-disable-next-line no-control-regex -- a path or a name never keeps a control character
const CONTROL = /[\u0000-\u001f\u007f]/;
const TUNNEL = /tc[0-9A-Za-z_-]{24,}/;

export interface RemoteEntry {
  name: string;
  kind: "dir" | "file";
  /** bytes, files only */
  size?: number;
  /** ISO time of the last change */
  modifiedAt?: string;
}

export interface RemoteListing {
  path: string;
  parent: string | null;
  /** the person's profile folder */
  home?: string;
  /** drives on Windows, "/" elsewhere */
  roots: string[];
  entries: RemoteEntry[];
  truncated: boolean;
}

export type RemoteListingError = "notfound" | "notdir" | "denied" | "unreadable";

const windows = (os: RemoteSessionOs) => os === "windows";

/** A folder (or file) path a request may name: absolute, no `..`, no control
 * character, no tunnel address. "" (or nothing) means the person's profile.
 * Windows paths come back with backslashes and an upper-case drive. */
export function safeRemoteDir(value: unknown, os: RemoteSessionOs): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  if (CONTROL.test(value)) return null;
  // spaces at either end of a folder name are part of it: never trimmed
  if (!value.trim()) return "";
  const raw = value;
  if (raw.length > PATH_MAX || TUNNEL.test(raw)) return null;
  if (raw.split(/[\\/]/).some((part) => part === "..")) return null;
  if (windows(os)) {
    const path = raw.replaceAll("/", "\\");
    const drive = /^([A-Za-z]):(\\.*)?$/.exec(path);
    if (!drive) return null;
    const rest = (drive[2] ?? "\\").replace(/\\+$/, "");
    if (rest.includes("\\\\")) return null;
    return `${drive[1]!.toUpperCase()}:${rest || "\\"}`;
  }
  if (!raw.startsWith("/") || raw.includes("\\")) return null;
  const trimmed = raw.replace(/\/+$/, "");
  if (trimmed.includes("//")) return null;
  return trimmed || "/";
}

// Characters scp must never see in a remote path: a legacy (non-SFTP) scp
// hands the path to the remote shell, and tailcat cp runs the system scp.
// oxlint-disable-next-line no-control-regex -- control characters are refused too
const SCP_UNSAFE = /[$`;"'*?|&<>!%\u0000-\u001f\u007f]/;

/** A path that may go to `tailcat cp` (the system scp) as is. */
export function scpSafePath(path: string): boolean {
  return !SCP_UNSAFE.test(path);
}

// Folders a file is never sent into, even by the owner: what lands there runs
// at sign-in or start-up, or replaces a key or a system file. Matched on whole
// path segments, case-insensitively on Windows and macOS.
const SENSITIVE_WINDOWS = [
  /^[a-z]:\\windows(\\|$)/,
  /\\\.ssh(\\|$)/,
  /\\start menu\\programs\\startup(\\|$)/,
];
const SENSITIVE_UNIX = [
  /^\/etc(\/|$)/,
  /^\/(usr\/lib|var\/spool)\/cron(\/|$)/,
  /^\/var\/at(\/|$)/,
  /\/\.ssh(\/|$)/,
  /\/launch(agents|daemons)(\/|$)/,
  /^\/library\/startupitems(\/|$)/,
  /^\/system(\/|$)/,
  /\/\.config\/(systemd|autostart)(\/|$)/,
];

/** A system folder Sagax refuses as an upload destination (start-up, keys,
 * scheduled tasks, the OS itself). */
export function sensitiveRemoteDir(path: string, os: RemoteSessionOs): boolean {
  const lower = path.toLowerCase();
  return (windows(os) ? SENSITIVE_WINDOWS : SENSITIVE_UNIX).some((rule) => rule.test(lower));
}

export function remoteJoin(dir: string, name: string, os: RemoteSessionOs): string {
  const sep = windows(os) ? "\\" : "/";
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
}

export function remoteParent(path: string, os: RemoteSessionOs): string | null {
  if (windows(os)) {
    if (/^[A-Z]:\\?$/i.test(path)) return null;
    const cut = path.lastIndexOf("\\");
    if (cut < 0) return null;
    const up = path.slice(0, cut);
    return /^[A-Z]:$/i.test(up) ? `${up}\\` : up;
  }
  if (path === "/") return null;
  const cut = path.lastIndexOf("/");
  if (cut < 0) return null;
  return cut === 0 ? "/" : path.slice(0, cut);
}

/** The breadcrumb of a folder, root first. */
export function remoteCrumbs(path: string, os: RemoteSessionOs): Array<{ label: string; path: string }> {
  if (windows(os)) {
    const [drive, ...parts] = path.split("\\").filter(Boolean);
    if (!drive) return [];
    const crumbs = [{ label: drive, path: `${drive}\\` }];
    let at = drive;
    for (const part of parts) {
      at = `${at}\\${part}`;
      crumbs.push({ label: part, path: at });
    }
    return crumbs;
  }
  const crumbs = [{ label: "/", path: "/" }];
  let at = "";
  for (const part of path.split("/").filter(Boolean)) {
    at = `${at}/${part}`;
    crumbs.push({ label: part, path: at });
  }
  return crumbs;
}

function entryName(name: string): string | null {
  if (!name || name === "." || name === ".." || name.length > 255) return null;
  if (CONTROL.test(name) || name.includes("/") || name.includes("\\") || TUNNEL.test(name)) return null;
  return name;
}

/** Reads what the listing command printed: `PWD`, `HOME`, `ROOT` lines, then
 * `d|f <tab> size <tab> unix seconds <tab> name` per entry, `MORE` when the
 * folder held more, or `ERR <tab> reason`. */
export function parseRemoteListing(stdout: string, os: RemoteSessionOs): RemoteListing | { error: RemoteListingError } {
  let path = "";
  let home: string | undefined;
  const roots: string[] = [];
  const entries: RemoteEntry[] = [];
  let truncated = false;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line) continue;
    const fields = line.split("\t");
    const tag = fields[0];
    if (tag === "ERR") {
      const reason = fields[1]?.trim();
      return { error: reason === "notfound" || reason === "notdir" || reason === "denied" ? reason : "unreadable" };
    }
    if (tag === "MORE" && fields.length === 1) { truncated = true; continue; }
    if (fields.length === 2 && (tag === "PWD" || tag === "HOME" || tag === "ROOT")) {
      const value = safeRemoteDir(fields[1], os);
      if (!value) continue;
      if (tag === "PWD") path = value;
      else if (tag === "HOME") home = value;
      else if (!roots.includes(value) && roots.length < 26) roots.push(value);
      continue;
    }
    if (fields.length !== 4 || (tag !== "d" && tag !== "f")) continue;
    const name = entryName(fields[3]!);
    if (!name) continue;
    if (entries.length >= REMOTE_LIST_MAX) { truncated = true; continue; }
    const entry: RemoteEntry = { name, kind: tag === "d" ? "dir" : "file" };
    const size = Number(fields[1]);
    if (tag === "f" && /^\d+$/.test(fields[1]!) && Number.isSafeInteger(size)) entry.size = size;
    const seconds = Number(fields[2]);
    if (/^\d+$/.test(fields[2]!) && seconds > 0 && seconds < 32_503_680_000) entry.modifiedAt = new Date(seconds * 1000).toISOString();
    entries.push(entry);
  }
  if (!path) return { error: "unreadable" };
  if (!roots.length) roots.push(windows(os) ? path.slice(0, 3) : "/");
  // Folders first, then names in a stable, case-insensitive order.
  const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
  entries.sort((a, b) => (a.kind === b.kind ? collator.compare(a.name, b.name) : a.kind === "dir" ? -1 : 1));
  return { path, parent: remoteParent(path, os), ...(home ? { home } : {}), roots, entries, truncated };
}
