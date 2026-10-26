// The routines the Automations page shows for the chosen scope and filters
// (2026-10-09). Mine without a team or owner filter is the store's own live
// listing, as before, enriched with the owner and the canRun / canEdit flags
// the server sends. My teams, Everyone, or a team or owner filter read the
// scoped listing from the server (GET /api/routines?scope=...), which
// decides what the person may see; it is read again when the store's
// routines or runs change and once a minute.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, type ConfigStatus } from "@/state/store";
import type { Routine, RoutineRun } from "@/lib/routines";
import { viewerCan } from "@/lib/viewer";
import { readRoutineScopePrefs, writeRoutineScopePrefs, type RoutineScopePrefs } from "@/lib/routine-scope-prefs";
import {
  routineScopeSearch,
  routineScopeStatuses,
  type RoutineScope,
  type RoutineScopeInfo,
} from "../../shared/routine-scope";

const REFRESH_MS = 60_000;
const SETTLE_MS = 800;

type Listing = { search: string; routines: Routine[]; runs: RoutineRun[]; info: RoutineScopeInfo };

/** An organization server: the scope control only exists there (a solo
 * server's person already sees every routine). */
export function routineScopeAvailable(config: ConfigStatus | null | undefined): boolean {
  return config?.viewer?.profileManagedBy === "perspicax";
}

/** Which scopes the app offers before the server answers (the server's
 * own `allowed` wins once it does). */
export function routineScopesAllowed(config: ConfigStatus | null | undefined): Record<RoutineScope, boolean> {
  const all = viewerCan(config, "routines.viewAll");
  return { mine: true, team: all || viewerCan(config, "routines.viewTeam"), all };
}

/** The scope a person's saved choice comes to: one they lost falls back to Mine. */
export function effectiveRoutineScope(prefs: RoutineScopePrefs, allowed: Record<RoutineScope, boolean>): RoutineScope {
  return allowed[prefs.scope] ? prefs.scope : "mine";
}

export function routineMatchesStatus(routine: Routine, status: RoutineScopePrefs["status"]): boolean {
  return !status || routineScopeStatuses(routine).includes(status);
}

export function useRoutineScope({ config, routines, runs, ignoreStatus = false }: { config: ConfigStatus | null | undefined; routines: Routine[]; runs: RoutineRun[]; /** The Calendar view hides the status filter, so it must not apply. */ ignoreStatus?: boolean }) {
  const principalId = config?.viewer?.principalId ?? null;
  const available = routineScopeAvailable(config);
  const [prefs, setPrefsState] = useState<RoutineScopePrefs>(() => readRoutineScopePrefs(principalId));
  useEffect(() => setPrefsState(readRoutineScopePrefs(principalId)), [principalId]);
  const setPrefs = useCallback((next: RoutineScopePrefs) => {
    setPrefsState(next);
    writeRoutineScopePrefs(principalId, next);
  }, [principalId]);

  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState(false);
  const fallbackAllowed = useMemo(() => routineScopesAllowed(config), [config]);
  const allowed = listing?.info.allowed ?? fallbackAllowed;
  const scope = available ? effectiveRoutineScope(prefs, allowed) : "mine";
  const teamId = scope === "mine" ? undefined : prefs.teamId;
  const ownerId = scope === "mine" ? undefined : prefs.ownerId;
  const live = scope === "mine" && !teamId && !ownerId;
  const search = routineScopeSearch({ scope, ...(teamId ? { teamId } : {}), ...(ownerId ? { ownerId } : {}) });

  const latest = useRef(search);
  latest.current = search;
  const load = useCallback(async () => {
    if (!available) return;
    const asked = latest.current;
    try {
      const body = await api(`/api/routines?${asked}`);
      if (latest.current !== asked) return;
      setListing({
        search: asked,
        routines: Array.isArray(body.routines) ? body.routines : [],
        runs: Array.isArray(body.runs) ? body.runs : [],
        info: { scope: body.scope ?? "mine", allowed: body.allowed ?? fallbackAllowed, facets: body.facets ?? { teams: [], owners: [], botChoices: [] } },
      });
      setError(false);
    } catch {
      if (latest.current === asked) setError(true);
    }
  }, [available, fallbackAllowed]);

  useEffect(() => { void load(); }, [load, search]);
  // The store's routines or runs changed (a live frame, a save, a run): read
  // the scope again once things settle.
  useEffect(() => {
    if (!available) return;
    const timer = setTimeout(() => void load(), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [available, load, routines, runs]);
  useEffect(() => {
    if (!available) return;
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [available, load]);

  const current = listing && listing.search === search ? listing : null;
  const statusFilter = ignoreStatus ? undefined : prefs.status;
  const shownRoutines = useMemo(() => {
    let base: Routine[];
    if (live) {
      // The store's own records, with what the server adds about each one.
      const extra = new Map((current?.routines ?? []).map((routine) => [routine.id, routine]));
      base = routines.map((routine) => {
        const found = extra.get(routine.id);
        return found ? { ...found, ...routine, owner: routine.owner ?? found.owner, teamIds: routine.teamIds ?? found.teamIds, bot: routine.bot ?? found.bot, canRun: routine.canRun ?? found.canRun, canEdit: routine.canEdit ?? found.canEdit } : routine;
      });
    } else {
      base = current?.routines ?? [];
    }
    return base.filter((routine) => routineMatchesStatus(routine, statusFilter));
  }, [live, current, routines, statusFilter]);
  const shownRuns = useMemo(() => {
    const base = live ? runs : current?.runs ?? [];
    if (!statusFilter) return base;
    const ids = new Set(shownRoutines.map((routine) => routine.id));
    return base.filter((run) => ids.has(run.routineId));
  }, [live, runs, current, statusFilter, shownRoutines]);

  return {
    available,
    prefs,
    setPrefs,
    scope,
    allowed,
    live,
    facets: current?.info.facets ?? listing?.info.facets ?? { teams: [], owners: [], botChoices: [] },
    routines: shownRoutines,
    runs: shownRuns,
    loading: !live && !current && !error,
    error: !live && error,
    reload: load,
    /** The query Clear logs sends with the page's bot filter. */
    clearSearch: (botId: string | undefined) => routineScopeSearch({ scope, ...(teamId ? { teamId } : {}), ...(ownerId ? { ownerId } : {}), ...(botId ? { botId } : {}), ...(statusFilter ? { status: statusFilter } : {}) }),
  };
}
