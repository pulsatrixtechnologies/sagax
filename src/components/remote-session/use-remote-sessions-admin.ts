import { useCallback, useEffect, useRef, useState } from "react";

import type { RemoteSessionAdminRow } from "../../../shared/remote-session-admin";
import type { RemoteSessionLogEntry } from "../../../shared/remote-session-admin";
import type { AdminRowFilters } from "../../../shared/remote-session-admin";
import { api } from "@/state/store";

export interface RemoteSessionsAdminState {
  rows: RemoteSessionAdminRow[];
  /** The viewer is a workspace admin (sees the organization's sessions). */
  admin: boolean;
  /** The unattended (Access) path is enabled on this server. False by default:
   * the column is then read-only and no grant or revoke is offered. */
  unattendedEnabled: boolean;
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
  const [unattendedEnabled, setUnattendedEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((value) => value + 1), []);
  const query = queryOf(filters);
  const latest = useRef(query);
  latest.current = query;
  useEffect(() => {
    let stop = false;
    const load = () => {
      api<{ sessions?: RemoteSessionAdminRow[]; admin?: boolean; unattendedEnabled?: boolean }>(`/api/admin/remote-sessions${latest.current}`)
        .then((body) => {
          if (stop) return;
          setRows(Array.isArray(body.sessions) ? body.sessions : []);
          setAdmin(body.admin === true);
          setUnattendedEnabled(body.unattendedEnabled === true);
          setLoading(false);
        })
        .catch(() => { if (!stop) setLoading(false); });
    };
    load();
    const timer = setInterval(load, 5000);
    return () => { stop = true; clearInterval(timer); };
  }, [query, tick]);
  return { rows, admin, unattendedEnabled, loading, reload };
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
