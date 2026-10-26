// How many bots are working now, for the updater (electron/update-away.mjs):
// a restart warns about them, waits for them, and an update that installs
// while the person is away never goes while one works. Only the number
// leaves the page.
import { useEffect } from "react";
import { useStoreOptional, type AppState } from "@/state/store";

/** The page reports this often; main treats an older report as "unknown". */
export const ACTIVITY_REPORT_MS = 30_000;

type Working = { busy?: boolean; working?: boolean; activity?: string; tasks?: Array<{ busy?: boolean; working?: boolean }> };

const isWorking = (item: Working): boolean =>
  item.busy === true || item.working === true || item.activity === "working" || (item.tasks ?? []).some((task) => task.busy === true || task.working === true);

/** Bots and groups with a turn running, a parallel task included. */
export function workingBotCount(state: Pick<AppState, "bots" | "groups">): number {
  return (state.bots as Working[]).filter(isWorking).length + ((state.groups ?? []) as Working[]).filter(isWorking).length;
}

/** Reports the count to the updater (desktop app only), at once on a change and every 30 s. */
export function useReportUpdateActivity(): void {
  const store = useStoreOptional();
  const count = store ? workingBotCount(store.state) : null;
  useEffect(() => {
    const report = window.ogb?.updater?.reportActivity;
    if (!report || count === null) return;
    const send = () => void Promise.resolve(report(count)).catch(() => {});
    send();
    const timer = window.setInterval(send, ACTIVITY_REPORT_MS);
    return () => window.clearInterval(timer);
  }, [count]);
}
