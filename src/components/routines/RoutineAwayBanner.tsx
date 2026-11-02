// "Routines paused while you were away" (server/routines/routine-away.ts): on the
// Automations page, once the person is back, the routines set to "Only when
// I'm here" that skipped runs meanwhile, each with how many and when. Run it
// now (the routine's ordinary Run now) or mark it seen (POST
// /api/routines/:id/away-seen); nothing shows while there is nothing to say.
import { useState } from "react";
import { CirclePause, Play } from "lucide-react";

import { t, activeLocale } from "@/lib/i18n";
import type { Routine } from "@/lib/routines";
import { api, type Action } from "@/state/store";
import { readableError } from "@/lib/plain-error";

type AwayRoutine = Pick<Routine, "id" | "name" | "awaySkips">;

/** The routines to report: skipped runs, and the person is back. Pure. */
export function awayReports<R extends AwayRoutine>(routines: readonly R[]): R[] {
  return routines.filter((routine) => routine.awaySkips?.reportedAt !== undefined && routine.awaySkips.count > 0);
}

/** "3 runs skipped" / "1 run skipped". Pure. */
export function awaySkipsLabel(count: number): string {
  return count === 1 ? t("routines.away.skippedOne") : t("routines.away.skippedMany", { count });
}

export function RoutineAwayBanner({ routines, dispatch, request = api }: {
  routines: readonly Routine[];
  dispatch: (action: Action) => void;
  request?: typeof api;
}) {
  const reports = awayReports(routines);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  if (reports.length === 0) return null;
  const seen = async (id: string) => {
    const answer = await request<{ routine: Routine }>(`/api/routines/${id}/away-seen`, { method: "POST" });
    dispatch({ type: "routinePatched", routine: answer.routine });
  };
  const act = async (id: string, work: () => Promise<void>) => {
    setBusy(id);
    setError("");
    try {
      await work();
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(null);
    }
  };
  const when = (at: number) => new Date(at).toLocaleString(activeLocale(), { dateStyle: "short", timeStyle: "short" });
  return (
    <section data-routines-away aria-labelledby="routines-away-title" className="mx-4 mt-3 rounded-xl border border-hairline/50 bg-panel px-4 py-3">
      <div className="flex items-start gap-3">
        <CirclePause size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-secondary" />
        <div className="min-w-0 flex-1">
          <h2 id="routines-away-title" className="text-[13px] font-semibold text-ink">{t("routines.away.title")}</h2>
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">{t("routines.away.intro")}</p>
          <ul className="mt-2 space-y-1.5">
            {reports.map((routine) => (
              <li key={routine.id} data-routine-away={routine.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
                <span className="min-w-0 flex-1 truncate text-ink">
                  {routine.name}
                  <span className="text-ink-secondary"> · {awaySkipsLabel(routine.awaySkips!.count)} · {when(routine.awaySkips!.firstAt)}{routine.awaySkips!.lastAt !== routine.awaySkips!.firstAt ? ` · ${when(routine.awaySkips!.lastAt)}` : ""}</span>
                </span>
                <button type="button" disabled={busy !== null} data-routine-away-run
                  onClick={() => void act(routine.id, async () => {
                    await request(`/api/routines/${routine.id}/run`, { method: "POST" });
                    await seen(routine.id);
                  })}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-accent hover:bg-raised disabled:opacity-40">
                  <Play size={12} aria-hidden="true" />{t("routines.away.runNow")}
                </button>
                <button type="button" disabled={busy !== null} data-routine-away-seen
                  onClick={() => void act(routine.id, () => seen(routine.id))}
                  className="rounded-md px-2 py-1 text-[12px] text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-40">
                  {t("routines.away.dismiss")}
                </button>
              </li>
            ))}
          </ul>
          {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
        </div>
      </div>
    </section>
  );
}
