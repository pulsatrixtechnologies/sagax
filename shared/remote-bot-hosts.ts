// Enrolled unattended hosts attached to a bot (Computer tab places,
// 2026-11-01). The person adds endpoints so the bot has access by default.
// host_id stays opaque (`h_` + 32 hex); only the readable hostname is shown.
import { parseUnattendedHostId, type UnattendedHostRow } from "./remote-unattended-host.ts";

const MAX_REMOTE_HOSTS = 64;

/** ScreenPicker / place key for an enrolled host. */
export function hostPlaceKey(hostId: string): string {
  return `host:${hostId}`;
}

/** The host id from a place key, or null when it is not a host place. */
export function parseHostPlaceKey(key: unknown): string | null {
  if (typeof key !== "string" || !key.startsWith("host:")) return null;
  return parseUnattendedHostId(key.slice("host:".length));
}

/** Deduped, validated host ids for a bot record. Invalid entries are dropped. */
export function cleanRemoteHosts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value.slice(0, MAX_REMOTE_HOSTS * 2)) {
    const id = parseUnattendedHostId(entry);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_REMOTE_HOSTS) break;
  }
  return out;
}

/** Whether this bot already has the host attached. */
export function botHasRemoteHost(bot: { remoteHosts?: string[] | null }, hostId: string): boolean {
  const id = parseUnattendedHostId(hostId);
  if (!id) return false;
  return cleanRemoteHosts(bot.remoteHosts).includes(id);
}

/** Attach one host: returns the new list, or null when the id is invalid. */
export function attachRemoteHost(current: unknown, hostId: string): string[] | null {
  const id = parseUnattendedHostId(hostId);
  if (!id) return null;
  const next = cleanRemoteHosts(current);
  if (!next.includes(id)) next.push(id);
  return next.slice(0, MAX_REMOTE_HOSTS);
}

/** Detach one host. Always returns a list (empty when nothing left). */
export function detachRemoteHost(current: unknown, hostId: string): string[] {
  const id = parseUnattendedHostId(hostId);
  if (!id) return cleanRemoteHosts(current);
  return cleanRemoteHosts(current).filter((entry) => entry !== id);
}

export type RemoteHostPlace = {
  hostId: string;
  /** Readable hostname only; never the opaque host id. */
  label: string;
  state: UnattendedHostRow["state"];
  /** Already an endpoint on this bot. */
  attached: boolean;
};

/** Readable place label for a host: hostname when known, else the fallback
 * word. Never the opaque `h_…` id. */
export function remoteHostLabel(
  row: Pick<UnattendedHostRow, "hostname">,
  fallback = "Remote",
): string {
  const name = row.hostname?.trim();
  return name || fallback;
}

/** Hosts the Computer place picker offers: every enrolled catalog host, plus
 * attached hosts that are not revoked. Attach / detach live in the picker's
 * per-place menu; temporary attended sessions never appear here. */
export function remoteHostPlaces(
  attached: unknown,
  catalog: UnattendedHostRow[],
  fallbackLabel = "Remote",
): RemoteHostPlace[] {
  const want = new Set(cleanRemoteHosts(attached));
  const seen = new Set<string>();
  const places: RemoteHostPlace[] = [];
  for (const row of catalog) {
    if (row.state === "revoked") continue;
    const isAttached = want.has(row.hostId);
    // Catalog: enrolled only. Attached: keep until revoked (expired still shown).
    if (!isAttached && row.state !== "enrolled") continue;
    if (seen.has(row.hostId)) continue;
    seen.add(row.hostId);
    places.push({
      hostId: row.hostId,
      label: remoteHostLabel(row, fallbackLabel),
      state: row.state,
      attached: isAttached,
    });
  }
  return places;
}

/** A connected session that belongs to this enrolled host (hostname match).
 * Temporary/coded sessions without a matching hostname are never a place. */
export function sessionForHost(
  sessions: Array<{ state: string; hostname?: string | null }>,
  host: Pick<UnattendedHostRow, "hostname">,
): { state: string; hostname?: string | null } | undefined {
  const name = host.hostname?.trim().toLowerCase();
  if (!name) return undefined;
  return sessions.find((row) => row.state === "connected" && (row.hostname ?? "").trim().toLowerCase() === name);
}

/** Active temporary (attended) sessions for Details: connected ones that do
 * not belong to an attached unattended host place. */
export function temporaryRemoteSessions<T extends { state: string; hostname?: string | null }>(
  sessions: T[],
  attachedHosts: Array<Pick<UnattendedHostRow, "hostname">>,
): T[] {
  const names = new Set(
    attachedHosts
      .map((row) => row.hostname?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value)),
  );
  return sessions.filter((row) => {
    if (row.state !== "connected") return false;
    const name = (row.hostname ?? "").trim().toLowerCase();
    if (name && names.has(name)) return false;
    return true;
  });
}
