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

/** Hosts the Computer picker offers: attached and still enrolled. */
export function remoteHostPlaces(
  attached: unknown,
  available: UnattendedHostRow[],
): Array<{ hostId: string; label: string; state: UnattendedHostRow["state"] }> {
  const want = new Set(cleanRemoteHosts(attached));
  if (!want.size) return [];
  const byId = new Map(available.map((row) => [row.hostId, row]));
  const places: Array<{ hostId: string; label: string; state: UnattendedHostRow["state"] }> = [];
  for (const id of want) {
    const row = byId.get(id);
    if (!row || row.state === "revoked") continue;
    places.push({ hostId: id, label: row.hostname ?? id, state: row.state });
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
