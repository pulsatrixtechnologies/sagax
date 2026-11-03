// Live activity and waiting-card polling shared by the detail and exchange views.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api } from "@/state/store";
import type { RoutineRun } from "@/lib/routines";
import { loadBotActivityDetail, type BotActivityDetail } from "@/lib/bot-activity";
import { useWaitingCards, type WaitingItem } from "@/lib/use-waiting-cards";
import { waitingSources } from "@/lib/activity-waiting-sources";

const POLL_MS = 3_000;

/** The activity entry of a run (its steps, files, thread), followed while
 * it goes. `load` is the fetch; tests pass their own. */
const loadLive = (botId: string, itemId: string): Promise<BotActivityDetail> => loadBotActivityDetail(api, botId, itemId);

export function useRunActivity(run: Pick<RoutineRun, "id" | "botId" | "status" | "redacted">, load: (botId: string, itemId: string) => Promise<BotActivityDetail> = loadLive) {
  const [detail, setDetail] = useState<BotActivityDetail | null>(null);
  const [error, setError] = useState(false);
  const live = ["queued", "running", "waiting"].includes(run.status);
  const fetchDetail = useCallback(() => {
    if (run.redacted) return Promise.resolve();
    return load(run.botId, `run:${run.id}`).then((next) => { setDetail(next); setError(false); }).catch(() => setError(true));
  }, [load, run.botId, run.id, run.redacted]);
  useEffect(() => { setDetail(null); void fetchDetail(); }, [fetchDetail]);
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => void fetchDetail(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [live, fetchDetail]);
  return { detail, error, reload: fetchDetail };
}


export function RunActivityState({ run, children }: { run: RoutineRun; children: (activity: { detail: BotActivityDetail | null; error: boolean; reload: () => Promise<void>; waiting: WaitingItem[] }) => ReactNode }) {
  const activity = useRunActivity(run);
  // Read the waiting thread's cards again on each poll of the activity.
  const waiting = useWaitingCards(run.status === "waiting" ? waitingSources(activity.detail) : [], `${activity.detail?.updatedAt ?? ""}:${run.status}`);
  return <>{children({ ...activity, waiting })}</>;
}
