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
  /** an organization item: its declaration id; its key ends with it (the join for rows that have no updateKey) */
  organizationId?: string;
  pinned?: string;
  canUpdate: boolean;
  /** the source was never reached: no update mark for it, never counted */
  updateUnknown?: true;
}

/** One update done (by itself or by the person), one line per item and version. */
export interface UpdateHistoryLine { kind: UpdateKind; name: string; at: number; from?: string; to?: string }

export interface CapabilityUpdates {
  /** newest first; absent from an older server */
  history?: UpdateHistoryLine[];
  count: number;
  checkedAt: number | null;
  checking: boolean;
  items: CapabilityUpdateItem[];
}

export interface CapabilityUpdateResult {
  key: string;
  kind: UpdateKind;
  name: string;
  status: "updated" | "current" | "failed" | "unknown";
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

/** The update an item has: by the id the server gave the installed item
 * (`updateKey`, carried by the item), so two items with the same name are never
 * confused; an item the server gave no key (older lists) is joined by its kind
 * and readable name. Only an item with an update waiting. */
export function updateOf(data: CapabilityUpdates | null | undefined, kind: UpdateKind, name: string, updateKey?: string, organizationId?: string): CapabilityUpdateItem | undefined {
  if (!data) return undefined;
  if (updateKey) return data.items.find((item) => item.updateAvailable && !item.updateUnknown && item.key === updateKey);
  // an organization row has no updateKey: its declaration id is the join, never its name
  if (organizationId) return data.items.find((item) => item.updateAvailable && !item.updateUnknown && item.organizationId === organizationId);
  const wanted = norm(name);
  return data.items.find((item) => item.kind === kind && item.updateAvailable && !item.updateUnknown && !item.organizationId && norm(item.name) === wanted);
}

/** The locale key of a failed update's reason: the server's sentence is read
 * for what it says and never printed (the person reads their own language). */
export type UpdateReasonKey =
  | "connectApps.updates.reason.unreachable" | "connectApps.updates.reason.organization"
  | "connectApps.updates.reason.signin" | "connectApps.updates.reason.missing" | "connectApps.updates.reason.unknown"
  | "connectApps.updates.reason.uncheckable";
export function updateReasonKey(error: string | undefined): UpdateReasonKey {
  const text = (error ?? "").toLowerCase();
  if (/organi[sz]ation|console|pinned|manages/.test(text)) return "connectApps.updates.reason.organization";
  if (/sign.?in|sign.?out|log.?in|auth|credential|token|unauthori[sz]ed|forbidden|permission|denied/.test(text)) return "connectApps.updates.reason.signin";
  if (/not found|no longer|removed|gone|does not exist|missing/.test(text)) return "connectApps.updates.reason.missing";
  if (/reach|network|timed? ?out|offline|unreachable|connect|dns|refused|unavailable|fetch|rate.?limit/.test(text)) return "connectApps.updates.reason.unreachable";
  return "connectApps.updates.reason.unknown";
}

/** One failed update, named: the item and why; the old version stays. */
export interface UpdateFailure {
  key: string;
  name: string;
  error: string;
  /** not a failure: its source could not be checked just now (nothing changed, nothing was lost) */
  unknown?: true;
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
    const again = () => { void load(); };
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
      const failed = answer.results.filter((result) => result.status === "failed" || result.status === "unknown")
        .map((result): UpdateFailure => ({ key: result.key, name: result.name, error: result.error ?? "", ...(result.status === "unknown" ? { unknown: true as const } : {}) }));
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

/** The last update an item had, from the history the server keeps (one line per item). */
export function lastUpdateOf(data: CapabilityUpdates | null | undefined, kind: UpdateKind, name: string): UpdateHistoryLine | undefined {
  const wanted = norm(name);
  return data?.history?.find((line) => line.kind === kind && norm(line.name) === wanted);
}
