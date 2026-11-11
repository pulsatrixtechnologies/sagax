import { useEffect, useState } from "react";

import { connectedPlanRows, type PlanRow, type PlanUsageReport } from "@/lib/plan-usage";
import { rowsForEngine, weeklyLimitNotice } from "@/lib/usage-notices";
import { api } from "@/state/store";

const REFRESH_MS = 10 * 60_000;

/** A subscription's weekly window at 80 % or more, from the same report as
 * Settings > Usage. Null when the report cannot be read. Shown by the model
 * picker's limit indicator, never as a banner above the chat. Scoped to the
 * given engine instance (or its driver for servers that send no instanceId). */
export function useWeeklyLimit(engine?: string, driver?: string) {
  const [rows, setRows] = useState<PlanRow[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => { void api<PlanUsageReport>("/api/plan-usage").then((report) => { if (alive) setRows(connectedPlanRows(report)); }, () => {}); };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);
  // #2902: only the engine this bot runs on (Auto resolved); another
  // provider's window lives on the Usage page, never in the chat bar. A row
  // folded on a shared login answers for every instance reading it.
  return weeklyLimitNotice(rowsForEngine(rows, engine, driver));
}
