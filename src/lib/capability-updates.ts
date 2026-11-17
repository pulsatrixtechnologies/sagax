// Updates of plugins, skills and connectors (#4504). The server answers the
// count and every item in one place, runs one update or all of them, and tells
// the page of a change on the live channel (`capability.updates`). The page
// only reads and calls these routes (the same server function the bots use).
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/state/store";
import { readableError } from "@/lib/plain-error";

export const CAPABILITY_UPDATES_ROUTE = "/api/me/capability-updates";
/** The window event the live frame `capability.updates` raises (use-store-live). */
export const CAPABILITY_UPDATES_EVENT = "sagax:capability-updates";

export type UpdateKind = "plugin" | "skill" | "connector";

export interface CapabilityUpdateItem {
  key: string;
  kind: UpdateKind;
  name: string;
  scope: "me" | "bot" | "installation" | "organization";
  bot?: { id: string; name: string };
  installedVersion?: string;
  availableVersion?: string;
  updateAvailable: boolean;
  updateNotes?: string;
  organization?: "required" | "offered";
  pinned?: string;
  canUpdate: boolean;
}

export interface CapabilityUpdates {
  count: number;
  checkedAt: number | null;
  checking: boolean;
  items: CapabilityUpdateItem[];
}

export interface CapabilityUpdateResult {
  key: string;
  kind: UpdateKind;
  name: string;
  status: "updated" | "current" | "failed";
  from?: string;
  to?: string;
  updateNotes?: string;
  error?: string;
}

export interface CapabilityUpdateAnswer {
  results: CapabilityUpdateResult[];
  count: number;
}

export const loadCapabilityUpdates = (): Promise<CapabilityUpdates> => api(CAPABILITY_UPDATES_ROUTE);
export const runCapabilityUpdates = (body: { keys: string[] } | { all: true }): Promise<CapabilityUpdateAnswer> =>
  api(CAPABILITY_UPDATES_ROUTE, { method: "POST", body: JSON.stringify(body) });

/** What a row of the lists is called in the updates' kinds. */
export const updateKindOf = (kind: "plugin" | "skill" | "app" | "mcp" | "featured"): UpdateKind =>
  kind === "plugin" ? "plugin" : kind === "skill" ? "skill" : "connector";

const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** The update an item has, by its kind and readable name (the lists the page
 * reads carry the server's `updateKey` for the calls; the join to a row is the
 * name, as the rows are named). Only an item with an update that can be run. */
export function updateOf(data: CapabilityUpdates | null | undefined, kind: UpdateKind, name: string): CapabilityUpdateItem | undefined {
  const wanted = norm(name);
  return data?.items.find((item) => item.kind === kind && item.updateAvailable && norm(item.name) === wanted);
}

/** One failed update, named: the item and why; the old version stays. */
export interface UpdateFailure {
  key: string;
  name: string;
  error: string;
}

/** The count, the items, and the two calls, kept current by the live channel. */
export function useCapabilityUpdates(active = true) {
  const [data, setData] = useState<CapabilityUpdates | null>(null);
  const [running, setRunning] = useState<ReadonlySet<string>>(() => new Set());
  const [all, setAll] = useState(false);
  const [failures, setFailures] = useState<UpdateFailure[]>([]);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = useCallback(async () => {
    try {
      const next = await loadCapabilityUpdates();
      if (alive.current) setData(next);
    } catch {
      // a server that does not know the route (older): no marks, nothing shown
    }
  }, []);
  useEffect(() => {
    if (!active) return;
    void load();
    const again = () => void load();
    window.addEventListener(CAPABILITY_UPDATES_EVENT, again);
    return () => window.removeEventListener(CAPABILITY_UPDATES_EVENT, again);
  }, [active, load]);
  const run = useCallback(async (body: { keys: string[] } | { all: true }) => {
    const keys = "keys" in body ? body.keys : data?.items.filter((item) => item.updateAvailable && item.canUpdate).map((item) => item.key) ?? [];
    if ("all" in body) setAll(true);
    setRunning((current) => new Set([...current, ...keys]));
    try {
      const answer = await runCapabilityUpdates(body);
      if (!alive.current) return answer;
      const failed = answer.results.filter((result) => result.status === "failed").map((result) => ({ key: result.key, name: result.name, error: result.error ?? "" }));
      setFailures((current) => [...current.filter((entry) => !answer.results.some((result) => result.key === entry.key)), ...failed]);
      return answer;
    } catch (cause) {
      if (alive.current) setFailures((current) => [...current, ...keys.map((key) => ({ key, name: data?.items.find((item) => item.key === key)?.name ?? key, error: readableError(cause) }))]);
      return null;
    } finally {
      if (alive.current) {
        setRunning((current) => new Set([...current].filter((key) => !keys.includes(key))));
        setAll(false);
        void load();
      }
    }
  }, [data, load]);
  return {
    data,
    running,
    updatingAll: all,
    failures,
    dismissFailure: (key: string) => setFailures((current) => current.filter((entry) => entry.key !== key)),
    update: (keys: string[]) => run({ keys }),
    updateAll: () => run({ all: true }),
  };
}
