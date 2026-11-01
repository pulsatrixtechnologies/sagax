import { useCallback, useEffect, useRef, useState } from "react";

import type { RemoteSessionAdminRow } from "../../../shared/remote-session-admin";
import type { RemoteSessionLogEntry } from "../../../shared/remote-session-admin";
import type { AdminRowFilters } from "../../../shared/remote-session-admin";
import type { UnattendedHostRow } from "../../../shared/remote-unattended-host";
import { api } from "@/state/store";

export interface RemoteSessionsAdminState {
  rows: RemoteSessionAdminRow[];
  /** The viewer is a workspace admin (sees the organization's sessions). */
  admin: boolean;
  loading: boolean;
  reload: () => void;
}

function queryOf(filters: AdminRowFilters): string {
  const q = new URLSearchParams();
  if (filters.activeOnly) q.set("active", "1");
  if (filters.unattendedOnly) q.set("unattended", "1");
  if (filters.botId) q.set("bot", filters.botId);
  if (filters.host) q.set("host", filters.host);
  if (filters.search) q.set("q", filters.search);
  const text = q.toString();
  return text ? `?${text}` : "";
}

/** All remote sessions the viewer may see, polled while the page is mounted.
 * The server filters by who may see each session; these filters narrow it. */
export function useRemoteSessionsAdmin(filters: AdminRowFilters): RemoteSessionsAdminState {
  const [rows, setRows] = useState<RemoteSessionAdminRow[]>([]);
  const [admin, setAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((value) => value + 1), []);
  const query = queryOf(filters);
  const latest = useRef(query);
  latest.current = query;
  useEffect(() => {
    let stop = false;
    const load = () => {
      api<{ sessions?: RemoteSessionAdminRow[]; admin?: boolean }>(`/api/admin/remote-sessions${latest.current}`)
        .then((body) => {
          if (stop) return;
          setRows(Array.isArray(body.sessions) ? body.sessions : []);
          setAdmin(body.admin === true);
          setLoading(false);
        })
        .catch(() => { if (!stop) setLoading(false); });
    };
    load();
    const timer = setInterval(load, 5000);
    return () => { stop = true; clearInterval(timer); };
  }, [query, tick]);
  return { rows, admin, loading, reload };
}

export function fetchRemoteSessionLog(id: string): Promise<RemoteSessionLogEntry[]> {
  return api<{ entries?: RemoteSessionLogEntry[] }>(`/api/admin/remote-sessions/${encodeURIComponent(id)}/logs`)
    .then((body) => (Array.isArray(body.entries) ? body.entries : []));
}

export function endRemoteSessionAdmin(id: string): Promise<boolean> {
  return api(`/api/admin/remote-sessions/${encodeURIComponent(id)}/end`, { method: "POST" })
    .then(() => true)
    .catch(() => false);
}

export function revokeUnattended(hostKey: string): Promise<boolean> {
  return api("/api/admin/remote-sessions/unattended/revoke", { method: "POST", body: JSON.stringify({ host_key: hostKey }) })
    .then(() => true)
    .catch(() => false);
}

// ── enrolled hosts (unattended access, docs/inscription-hote.md) ──

export interface UnattendedHostsState {
  hosts: UnattendedHostRow[];
  /** Perspicax answered the list (false: not linked, or not shipped yet). */
  available: boolean;
  loading: boolean;
  reload: () => void;
}

/** The hosts Perspicax enrolled, polled slowly while the page is mounted. */
export function useUnattendedHosts(): UnattendedHostsState {
  const [state, setState] = useState<Omit<UnattendedHostsState, "reload">>({ hosts: [], available: false, loading: true });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((value) => value + 1), []);
  useEffect(() => {
    let stop = false;
    const load = () => {
      api<{ hosts?: UnattendedHostRow[]; available?: boolean }>("/api/admin/remote-sessions/hosts")
        .then((body) => {
          if (stop) return;
          setState({
            hosts: Array.isArray(body.hosts) ? body.hosts : [],
            available: body.available === true,
            loading: false,
          });
        })
        .catch(() => { if (!stop) setState((prev) => ({ ...prev, loading: false })); });
    };
    load();
    const timer = setInterval(load, 15_000);
    return () => { stop = true; clearInterval(timer); };
  }, [tick]);
  return { ...state, reload };
}

export type UnattendedHostFailure = "invalid" | "unavailable" | "refused";

function failureOf(error: unknown): UnattendedHostFailure {
  const code = (error as { body?: { code?: unknown } } | null)?.body?.code;
  return code === "invalid" || code === "unavailable" ? code : "refused";
}

/** Open an unattended session against an enrolled host. The session card and
 * row arrive through the usual flow once the host picks it up (client "app"). */
export function openUnattendedHost(hostId: string): Promise<{ ok: true; code: string; botId: string } | { ok: false; error: UnattendedHostFailure }> {
  return api<{ code?: string; botId?: string }>(`/api/admin/remote-sessions/hosts/${encodeURIComponent(hostId)}/open`, { method: "POST", body: JSON.stringify({}) })
    .then((body) => ({ ok: true as const, code: String(body.code ?? ""), botId: String(body.botId ?? "") }))
    .catch((error: unknown) => ({ ok: false as const, error: failureOf(error) }));
}

/** Revoke an enrolled host (offered flag OFF included). Perspicax lets the
 * person who enrolled it, or an admin. `reason` is optional, kept in the audit. */
export function revokeUnattendedHost(hostId: string, reason = ""): Promise<{ ok: true } | { ok: false; error: UnattendedHostFailure }> {
  const trimmed = reason.trim();
  return api(`/api/admin/remote-sessions/hosts/${encodeURIComponent(hostId)}/revoke`, { method: "POST", body: JSON.stringify(trimmed ? { reason: trimmed } : {}) })
    .then(() => ({ ok: true as const }))
    .catch((error: unknown) => ({ ok: false as const, error: failureOf(error) }));
}
