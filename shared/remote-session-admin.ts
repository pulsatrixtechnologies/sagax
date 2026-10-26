// The admin "Remote Sessions" page model: one row per Tailcat session the
// viewer may see (a workspace admin sees the org's sessions; a non-admin sees
// only the sessions they own). Pure: the server maps its stored sessions into
// AdminSessionInput and this builds the rows, the filters and the redacted log
// entries the page renders. It carries no tunnel address, no key and no secret.
import { publicText, type RemoteSessionOs } from "./remote-session.ts";
import { isUnattendedActive, type UnattendedConsent } from "./remote-session-consent.ts";

export type RemoteSessionAdminStatus = "connected" | "ended" | "failed";

/** The fields the server hands over for one stored session. */
export interface AdminSessionInput {
  id: string;
  code: string;
  os: RemoteSessionOs;
  osGuessed?: boolean;
  elevated: boolean;
  endAt: string;
  state: "connected" | "ended";
  createdAt: number;
  hostname?: string;
  user?: string;
  serial?: string;
  /** The session owner's principal id (lowercased), for the visibility check:
   * a non-admin sees only their own sessions. Not shown in the row. */
  ownerId: string;
  /** The person who opened the session (its owner), already a human label. */
  openedBy?: string;
  botId: string;
  /** Where reading the computer stands; a failure state at the end marks the
   * row "failed" rather than a plain "ended". */
  inventory?: string;
  reachable: boolean;
}

export interface RemoteSessionAdminRow {
  id: string;
  code: string;
  /** Human host label (hostname, else the support code). */
  host: string;
  user?: string;
  os: RemoteSessionOs;
  osKnown: boolean;
  /** ISO-8601. */
  startedAt: string;
  endAt: string;
  status: RemoteSessionAdminStatus;
  /** Elevated vs standard rights. */
  elevated: boolean;
  /** The bot that initiated the session: human label, with the id for a tooltip. */
  botId: string;
  botLabel: string;
  /** The person who opened or approved the session. */
  openedBy?: string;
  reachable: boolean;
  /** Unattended (a persistent "Sagax Remote Control" service is installed on
   * this host with active install-time consent). */
  unattended: boolean;
  unattendedSince?: string;
  unattendedExpiresAt?: string;
  /** Per host, when unattended: whether the on-screen banner is shown during a
   * control session (an org may turn it off). Auditable on the page. */
  bannerVisible?: boolean;
  /** Per host, when unattended: the agent binary is code-signed. */
  signed?: boolean;
}

const FAILED_INVENTORY = new Set(["no-tunnel", "no-answer", "os-unknown", "no-client"]);

/** The host key a consent record is stored under: serial, else hostname, else
 * the support code. Lowercased. Must match the server's consent-store key. */
export function adminHostKey(input: Pick<AdminSessionInput, "serial" | "hostname" | "code">): string {
  const raw = input.serial || input.hostname || input.code;
  return publicText(raw)?.toLowerCase() ?? input.code.toLowerCase();
}

function statusOf(input: AdminSessionInput): RemoteSessionAdminStatus {
  if (input.state === "connected") return "connected";
  // Ended without ever reading the computer, and the last read failed: the
  // session never really connected.
  if (!input.hostname && input.inventory && FAILED_INVENTORY.has(input.inventory)) return "failed";
  return "ended";
}

export function toAdminRow(input: AdminSessionInput, deps: { botLabel: string; consent?: UnattendedConsent | null; now: number }): RemoteSessionAdminRow {
  const host = publicText(input.hostname) ?? input.code;
  const unattended = isUnattendedActive(deps.consent, deps.now);
  return {
    id: input.id,
    code: input.code,
    host,
    ...(publicText(input.user) ? { user: publicText(input.user) } : {}),
    os: input.os,
    osKnown: !input.osGuessed,
    startedAt: new Date(input.createdAt).toISOString(),
    endAt: input.endAt,
    status: statusOf(input),
    elevated: input.elevated,
    botId: input.botId,
    botLabel: publicText(deps.botLabel) ?? input.botId,
    ...(publicText(input.openedBy) ? { openedBy: publicText(input.openedBy) } : {}),
    reachable: input.reachable,
    unattended,
    ...(unattended && deps.consent ? {
      unattendedSince: deps.consent.installedAt,
      unattendedExpiresAt: deps.consent.expiresAt,
      bannerVisible: deps.consent.bannerVisible,
      signed: deps.consent.signed,
    } : {}),
  };
}

export interface AdminRowFilters {
  activeOnly?: boolean;
  botId?: string;
  /** A host key or label fragment. */
  host?: string;
  unattendedOnly?: boolean;
  /** Free-text search over host, user, code, bot label. */
  search?: string;
}

export function filterAdminRows(rows: readonly RemoteSessionAdminRow[], filters: AdminRowFilters): RemoteSessionAdminRow[] {
  const search = filters.search?.trim().toLowerCase();
  const host = filters.host?.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.activeOnly && row.status !== "connected") return false;
    if (filters.botId && row.botId !== filters.botId) return false;
    if (filters.unattendedOnly && !row.unattended) return false;
    if (host && !`${row.host} ${row.code}`.toLowerCase().includes(host)) return false;
    if (search) {
      const hay = `${row.host} ${row.user ?? ""} ${row.code} ${row.botLabel} ${row.openedBy ?? ""}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

/** Sort the newest first (connected before ended, then by start time). */
export function sortAdminRows(rows: readonly RemoteSessionAdminRow[]): RemoteSessionAdminRow[] {
  const rank = (row: RemoteSessionAdminRow) => (row.status === "connected" ? 0 : 1);
  return [...rows].sort((a, b) => rank(a) - rank(b) || Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

// ── redacted audit log ──

export type RemoteSessionLogKind =
  | "start" | "control.grant" | "control.release" | "control.stop" | "input_blocked"
  | "exec" | "transfer";

/** One line of the logs view. Never a secret, a keystroke or a tunnel address. */
export interface RemoteSessionLogEntry {
  at: string;
  kind: RemoteSessionLogKind;
  /** exec: the command, with any tunnel token / node key / GUID stripped. */
  command?: string;
  /** exec: it only read (no card needed) vs it changed the computer. */
  readOnly?: boolean;
  /** exec: the person allowed this exact command (card approved). */
  approved?: boolean;
  exitCode?: number;
  /** transfer: which way and the file name (never its bytes). */
  direction?: "upload" | "download";
  file?: string;
  /** control.*: how much happened while control was held (counts only). */
  counts?: { keys?: number; chars?: number; moves?: number; clicks?: number };
  reason?: string;
}

/** Strip a tunnel token, a node key and a GUID from a command before it is
 * shown or stored in the log. Reuses the chat redactor. */
export function redactCommand(command: unknown): string {
  return publicText(command, 4000) ?? "";
}
