// Live activity and waiting-card polling shared by the detail and exchange views.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api } from "@/state/store";
import type { RoutineRun } from "@/lib/routines";
import { loadBotActivityDetail, type BotActivityDetail } from "@/lib/bot-activity";
import { useWaitingCards, type WaitingItem, type WaitingSource } from "@/lib/use-waiting-cards";
import { waitingSources } from "@/lib/activity-waiting-sources";

const POLL_MS = 3_000;

/** The activity entry of a run (its steps, files, thread), followed while
 * it goes. `load` is the fetch; tests pass their own. */
const loadLive = (botId: string, itemId: string): Promise<BotActivityDetail> => loadBotActivityDetail(api, botId, itemId);

export function useRunActivity(run: Pick<RoutineRun, "id" | "botId" | "status" | "redacted">, load: (botId: string, itemId: string) => Promise<BotActivityDetail> = loadLive) {
  const [detail, setDetail] = useState<BotActivityDetail | null>(null);
  const [error, setError] = useState(false);
  // one more per answered poll: the waiting cards are read again with it
  const [tick, setTick] = useState(0);
  const live = ["queued", "running", "waiting"].includes(run.status);
  const fetchDetail = useCallback(() => {
    if (run.redacted) return Promise.resolve();
    return load(run.botId, `run:${run.id}`).then((next) => { setDetail(next); setError(false); setTick((was) => was + 1); }).catch(() => setError(true));
  }, [load, run.botId, run.id, run.redacted]);
  useEffect(() => { setDetail(null); void fetchDetail(); }, [fetchDetail]);
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => void fetchDetail(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [live, fetchDetail]);
  return { detail, error, reload: fetchDetail, tick };
}


/** The threads whose open cards a run's sheet shows: those its activity
 * says wait, and (2026-11-04) the run's own thread whenever the run is
 * live, so a card is read even before the activity entry says it waits
 * (an approval while the turn holds the run running). */
export function runWaitingSources(run: Pick<RoutineRun, "status" | "threadId" | "botId" | "redacted">, detail: BotActivityDetail | null): WaitingSource[] {
  if (run.redacted || !["running", "waiting"].includes(run.status)) return [];
  const sources = waitingSources(detail);
  if (run.threadId && !sources.some((source) => source.threadId === run.threadId)) sources.unshift({ threadId: run.threadId, botId: run.botId });
  return sources;
}

export function RunActivityState({ run, children }: { run: RoutineRun; children: (activity: { detail: BotActivityDetail | null; error: boolean; reload: () => Promise<void>; waiting: WaitingItem[] }) => ReactNode }) {
  const { tick, ...activity } = useRunActivity(run);
  // Read the waiting thread's cards again on each poll of the activity.
  const waiting = useWaitingCards(runWaitingSources(run, activity.detail), `${tick}:${run.status}`);
  return <>{children({ ...activity, waiting })}</>;
}
