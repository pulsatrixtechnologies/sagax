// The hosts enrolled for unattended access (contract: sagax-remote-access
// docs/inscription-hote.md, "Côté Sagax"). Perspicax is the authority: it
// keeps one row per host in `remote_support_hosts`, keyed by `host_id` (the
// fingerprint of the host's own public key, `h_` and 32 hex, never a hostname
// or a serial: E3 of the review). This module is pure: it turns what Perspicax
// answers into the rows the Remote Sessions page shows, and says which host may
// be opened. It keeps no key and no address; `host_id` stays off the screen
// (tooltip or Copy only).
import { readableOr } from "./human-id.ts";
import { publicText } from "./remote-session.ts";

/** `h_` and 32 hex: the host id Perspicax pins at enrollment. */
export const UNATTENDED_HOST_ID = /^h_[0-9a-f]{32}$/;

export const UNATTENDED_HOST_SCOPES = ["full-control", "view-only", "shell-only"] as const;
export type UnattendedHostScope = typeof UNATTENDED_HOST_SCOPES[number];

/** enrolled: usable; expired: past expires_at; revoked: revoked_at set. */
export type UnattendedHostState = "enrolled" | "expired" | "revoked";

export interface UnattendedHostRow {
  /** For the tooltip, the Copy action and the open / revoke calls. Never shown. */
  hostId: string;
  /** The readable name the host gave at enrollment (display only), or null
   * when it gave none or only an id: the page then says "Unnamed computer". */
  hostname: string | null;
  /** The organization, only when it is a readable name (an org id is left out). */
  org: string | null;
  scope: UnattendedHostScope;
  /** Perspicax account that enrolled the host (`installed_by`). Sagax matches
   * this to the person's IdP subject for ownership (defense in depth when the
   * host list is wider than the person). Null when Perspicax omitted it. */
  installedBy: string | null;
  /** ISO-8601 UTC. */
  enrolledAt: string;
  expiresAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  state: UnattendedHostState;
}

const MAX_HOSTS = 500;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function iso(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** A host id, or null when it is not `h_` and 32 hex. */
export function parseUnattendedHostId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim().toLowerCase();
  return UNATTENDED_HOST_ID.test(id) ? id : null;
}

function scopeOf(value: unknown): UnattendedHostScope {
  return UNATTENDED_HOST_SCOPES.find((scope) => scope === value) ?? "full-control";
}

/** One Perspicax host row (snake_case, table `remote_support_hosts`), or null
 * when it has no valid host id or no dates. */
export function parseUnattendedHost(raw: unknown, now: number): UnattendedHostRow | null {
  if (!isObject(raw)) return null;
  const hostId = parseUnattendedHostId(raw.host_id);
  const enrolledAt = iso(raw.created_at ?? raw.enrolled_at);
  const expiresAt = iso(raw.expires_at);
  if (!hostId || !enrolledAt || !expiresAt) return null;
  const revokedAt = iso(raw.revoked_at);
  const name = publicText(typeof raw.hostname === "string" ? raw.hostname : undefined);
  const hostname = name ? readableOr(name, "") || null : null;
  const orgText = publicText(typeof raw.org === "string" ? raw.org : undefined);
  const org = orgText ? readableOr(orgText, "") || null : null;
  const installedRaw = typeof raw.installed_by === "string" ? raw.installed_by.trim() : "";
  const installedBy = installedRaw ? installedRaw.slice(0, 200) : null;
  const state: UnattendedHostState = revokedAt ? "revoked" : Date.parse(expiresAt) <= now ? "expired" : "enrolled";
  return {
    hostId,
    hostname: hostname && hostname !== hostId ? hostname : null,
    org,
    scope: scopeOf(raw.scope),
    installedBy,
    enrolledAt,
    expiresAt,
    lastSeenAt: iso(raw.last_seen_at),
    revokedAt,
    state,
  };
}

/** Every host in a Perspicax answer (`{ hosts: [...] }` or a bare list),
 * enrolled first, then by name. Rows without a valid host id are dropped. */
export function parseUnattendedHosts(value: unknown, now: number): UnattendedHostRow[] {
  const list = Array.isArray(value) ? value : isObject(value) && Array.isArray(value.hosts) ? value.hosts : [];
  const seen = new Set<string>();
  const rows: UnattendedHostRow[] = [];
  for (const raw of list.slice(0, MAX_HOSTS)) {
    const row = parseUnattendedHost(raw, now);
    if (!row || seen.has(row.hostId)) continue;
    seen.add(row.hostId);
    rows.push(row);
  }
  const rank = (row: UnattendedHostRow) => (row.state === "enrolled" ? 0 : row.state === "expired" ? 1 : 2);
  return rows.sort((a, b) => rank(a) - rank(b) || (a.hostname ?? "￿").localeCompare(b.hostname ?? "￿"));
}

/** Only an enrolled host (not revoked, not expired) is offered for opening.
 * Perspicax refuses the others anyway (C1); this keeps the button honest. */
export function canOpenUnattendedHost(row: Pick<UnattendedHostRow, "state">): boolean {
  return row.state === "enrolled";
}

/** True when this host belongs to the person (or is explicitly shared with
 * them). `ownerSub` is the person's Perspicax subject. When Sagax has no
 * subject (solo desktop), every listed host is treated as theirs. When
 * Perspicax named `installed_by`, it must equal that subject. A row without
 * `installed_by` is refused when a subject is known (fail closed: the MCP
 * list once returned every host of the org). */
export function hostOwnedByPerson(
  row: Pick<UnattendedHostRow, "installedBy">,
  ownerSub: string | null | undefined,
): boolean {
  const sub = typeof ownerSub === "string" ? ownerSub.trim() : "";
  if (!sub) return true;
  const installed = row.installedBy?.trim() ?? "";
  if (!installed) return false;
  return installed === sub;
}

/** Revoke stays offered for any host not yet revoked, whatever the flag (M2). */
export function canRevokeUnattendedHost(row: Pick<UnattendedHostRow, "state">): boolean {
  return row.state !== "revoked";
}
