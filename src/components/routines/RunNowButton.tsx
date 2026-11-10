// "Run now" on a routine (2026-10-08): one run at once through the
// scheduler's own path (POST /api/routines/:id/run), with the routine's
// Run as person; the schedule and the Active switch stay as they are, and a
// paused routine stays paused. Shown to the bot's owner, the person the
// routine runs as and an admin (the server checks it again); disabled while
// a run of the routine is in flight.
import { useRef, useState } from "react";
import { Loader2, Play } from "lucide-react";

import { t } from "@/lib/i18n";
import type { Routine, RoutineRun } from "@/lib/routines";
import { useStore, type Bot, type ConfigStatus } from "@/state/store";

const IN_FLIGHT = new Set(["queued", "running", "waiting"]);

/** Whether this viewer may run the routine now: on a solo server (no
 * person), the operator, an owner or admin, the bot's owner, or the person
 * the routine runs as. */
export function canRunRoutineNow(config: Pick<ConfigStatus, "viewer"> | null | undefined, routine: Pick<Routine, "runAs" | "canRun">, bot: Pick<Bot, "ownerUserId"> | undefined): boolean {
  // 2026-10-09: the server's word when the listing sent it (a routine seen
  // through a wider scope is read-only unless the write gates allow it).
  if (typeof routine.canRun === "boolean") return routine.canRun;
  const viewer = config?.viewer;
  if (!viewer?.principalId || viewer.operator || viewer.role === "owner" || viewer.role === "admin") return true;
  // 2026-10-09: a profile with routines.runNowAny runs any routine they see.
  if (Array.isArray(viewer.permissions) && viewer.permissions.includes("routines.runNowAny")) return true;
  const me = viewer.principalId.toLowerCase();
  return me === bot?.ownerUserId?.toLowerCase() || me === routine.runAs?.principalId.toLowerCase();
}

/** Whether a run of this routine is queued, running or waiting. */
export function routineRunInFlight(runs: readonly Pick<RoutineRun, "routineId" | "status">[], routineId: string): boolean {
  return runs.some((run) => run.routineId === routineId && IN_FLIGHT.has(run.status));
}

export function RunNowButton({ routine, bot, className, labelClassName, onStarted, onError }: {
  routine: Routine;
  bot: Bot | undefined;
  className: string;
  /** Classes of the label span (an action bar hides it when compact). */
  labelClassName?: string;
  onStarted?: (run: RoutineRun) => void;
  onError?: (error: unknown) => void;
}) {
  const { state, dispatch } = useStore();
  const pending = useRef(false);
  const [starting, setStarting] = useState(false);
  if (!canRunRoutineNow(state.config, routine, bot)) return null;
  // #3294: while a run of this routine is queued, running or waiting, Run
  // now cannot apply (the server answers 409 run_in_flight): hidden, never
  // shown greyed. The click's own start keeps its spinner.
  const inFlight = routineRunInFlight(state.routineRuns, routine.id);
  if (inFlight && !starting) return null;
  const disabled = starting;
  const run = () => {
    if (disabled || pending.current) return;
    pending.current = true;
    setStarting(true);
    dispatch({
      type: "runRoutine",
      routineId: routine.id,
      onStarted: (started) => {
        dispatch({ type: "routineRunPatched", run: started });
        onStarted?.(started);
      },
      ...(onError ? { onError } : {}),
      onSettled: () => { pending.current = false; setStarting(false); },
    });
  };
  return (
    <button type="button" data-run-now onClick={run} disabled={disabled} aria-label={t("routines.runNow")} title={t("routines.runNow")} className={className}>
      {starting ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} fill="currentColor" />}
      <span className={labelClassName}>{starting ? t("routines.runNow.starting") : t("routines.runNow")}</span>
    </button>
  );
}
