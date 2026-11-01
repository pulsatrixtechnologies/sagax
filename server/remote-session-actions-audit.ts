// The per-session action audit (exec commands and file transfers) and the
// reader the Remote Sessions logs view uses. It writes one JSONL line per
// action beside the control audit (remote-control.jsonl). It never records a
// secret, a keystroke, the bytes of a file, or a tunnel address: a command is
// redacted (shared/remote-session-admin.ts redactCommand) before it is written,
// and the reader redacts again when it merges the two files. Loi 25
// minimisation: only who / what / when, enough to answer "who connected and
// what ran", never the content.
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

import { redactCommand, type RemoteSessionLogEntry, type RemoteSessionLogKind } from "../shared/remote-session-admin.ts";

const ACTIONS_FILE = "remote-session-actions.jsonl";
const CONTROL_FILE = "remote-control.jsonl";
const MAX_BYTES = 8 * 1024 * 1024;

export interface RemoteSessionActionEvent {
  at: number;
  sessionId: string;
  principalId: string;
  botId: string;
  /** exec / transfer: one session's action. unattended.open /
   * remote_host.revoked: a host-level act on the Remote Sessions page,
   * `principalId` is the person who acted (never the installer, M4) and
   * `hostKey` the host; the per-session log view leaves these out.
   * remote_host.revoked is the name Perspicax gives the same act. */
  kind: "exec" | "transfer" | "unattended.open" | "remote_host.revoked";
  /** Host-level acts: the host the act was on (enrolled host id or consent key). */
  hostKey?: string;
  /** Host-level acts: whether it was accepted. */
  ok?: boolean;
  /** remote_host.revoked: the reason the person gave ("" when none). */
  reason?: string;
  /** remote_host.revoked: when, in UTC (ISO-8601 with Z), beside `at`. */
  atUtc?: string;
  /** unattended.open: scope and rights of the open. */
  scope?: string;
  rights?: string;
  /** exec: the command line, already safe to store (redacted again here). */
  command?: string;
  readOnly?: boolean;
  approved?: boolean;
  exitCode?: number;
  direction?: "upload" | "download";
  file?: string;
}

export function createRemoteSessionActionsAudit(dataDir: string) {
  const path = join(dataDir, ACTIONS_FILE);
  mkdirSync(dataDir, { recursive: true });
  const rotateIfBig = () => {
    try { if (statSync(path).size >= MAX_BYTES) renameSync(path, `${path}.1`); } catch { /* no file yet */ }
  };
  return {
    path,
    write(event: RemoteSessionActionEvent) {
      try {
        rotateIfBig();
        // Redact the command once more at the sink, so a caller that forgot to
        // cannot leak a tunnel token into the file.
        const safe = event.command !== undefined ? { ...event, command: redactCommand(event.command) } : event;
        appendFileSync(path, `${JSON.stringify(safe)}\n`, { mode: 0o600 });
      } catch { /* disk full, read-only */ }
    },
  };
}

function readLines(path: string): unknown[] {
  const out: unknown[] = [];
  for (const file of [path, `${path}.1`]) {
    let text = "";
    try { text = readFileSync(file, "utf8"); } catch { continue; }
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try { out.push(JSON.parse(trimmed)); } catch { /* skip a torn line */ }
    }
  }
  return out;
}

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const CONTROL_KIND: Partial<Record<string, RemoteSessionLogKind>> = {
  "control.start": "start",
  "control.grant": "control.grant",
  "control.release": "control.release",
  "control.stop": "control.stop",
  "control.input_blocked": "input_blocked",
};

function atIso(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === "string") { const ms = Date.parse(value); return Number.isFinite(ms) ? new Date(ms).toISOString() : null; }
  return null;
}

/** The redacted, time-ordered log for one session: control lifecycle +
 * exec + transfers, from both JSONL files. Nothing here carries a key,
 * keystroke, file content or tunnel address. */
export function readRemoteSessionLog(dataDir: string, sessionId: string): RemoteSessionLogEntry[] {
  const entries: RemoteSessionLogEntry[] = [];
  const push = (raw: unknown, source: "control" | "action") => {
    if (!isObject(raw) || raw.sessionId !== sessionId) return;
    const at = atIso(raw.at);
    if (!at) return;
    if (source === "control") {
      const kind = CONTROL_KIND[String(raw.kind)];
      if (!kind) return;
      const counts = { ...(typeof raw.keys === "number" ? { keys: raw.keys } : {}), ...(typeof raw.chars === "number" ? { chars: raw.chars } : {}), ...(typeof raw.moves === "number" ? { moves: raw.moves } : {}), ...(typeof raw.clicks === "number" ? { clicks: raw.clicks } : {}) };
      entries.push({ at, kind, ...(Object.keys(counts).length ? { counts } : {}), ...(typeof raw.reason === "string" ? { reason: raw.reason } : {}) });
      return;
    }
    if (raw.kind === "exec") {
      entries.push({
        at,
        kind: "exec",
        command: redactCommand(raw.command),
        ...(typeof raw.readOnly === "boolean" ? { readOnly: raw.readOnly } : {}),
        ...(typeof raw.approved === "boolean" ? { approved: raw.approved } : {}),
        ...(typeof raw.exitCode === "number" ? { exitCode: raw.exitCode } : {}),
      });
    } else if (raw.kind === "transfer") {
      entries.push({
        at,
        kind: "transfer",
        ...(raw.direction === "upload" || raw.direction === "download" ? { direction: raw.direction } : {}),
        ...(typeof raw.file === "string" ? { file: raw.file.slice(0, 160) } : {}),
      });
    }
  };
  for (const raw of readLines(join(dataDir, CONTROL_FILE))) push(raw, "control");
  for (const raw of readLines(join(dataDir, ACTIONS_FILE))) push(raw, "action");
  return entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
