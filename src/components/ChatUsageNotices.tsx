import { useEffect, useState } from "react";

import { connectedPlanRows, type PlanRow, type PlanUsageReport } from "@/lib/plan-usage";
import { rowsForEngine, weeklyLimitNotice } from "@/lib/usage-notices";
import { api } from "@/state/store";

const REFRESH_MS = 10 * 60_000;
/** D-20261125-014: while a usage detail is open its figures are read again every minute. */
export const OPEN_REFRESH_MS = 60_000;

/** Every connected plan row of the person, from the same report as Settings >
 * Usage: read once, then every ten minutes; read again when a detail opens
 * and every minute while it stays open (`detailOpen`, D-20261125-014). Empty
 * when the report cannot be read. `initial`: rows its owner already has, shown
 * until the first read answers. */
export function usePlanRows(detailOpen = false, initial: PlanRow[] = []): PlanRow[] {
  const [rows, setRows] = useState<PlanRow[]>(initial);
  useEffect(() => {
    let alive = true;
    const load = () => { void api<PlanUsageReport>("/api/plan-usage").then((report) => { if (alive) setRows(connectedPlanRows(report)); }, () => {}); };
    load();
    const timer = window.setInterval(load, detailOpen ? OPEN_REFRESH_MS : REFRESH_MS);
    return () => { alive = false; window.clearInterval(timer); };
  }, [detailOpen]);
  return rows;
}

/** The plan rows the bot's engine reads its limits from. Scoped to the given
 * engine instance (or its driver for servers that send no instanceId). */
export function useEnginePlanRows(engine?: string, driver?: string, detailOpen = false): PlanRow[] {
  // #2902: only the engine this bot runs on (Auto resolved); another
  // provider's window lives on the Usage page, never in the chat bar. A row
  // folded on a shared login answers for every instance reading it.
  return rowsForEngine(usePlanRows(detailOpen), engine, driver);
}

/** A subscription's weekly window at 80 % or more. Null when the report
 * cannot be read. Shown by the chat bar's usage meter and the model picker's
 * limit indicator, never as a banner above the chat. */
export function useWeeklyLimit(engine?: string, driver?: string) {
  return weeklyLimitNotice(useEnginePlanRows(engine, driver));
}
