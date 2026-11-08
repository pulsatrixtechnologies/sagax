import { useEffect, useState } from "react";
import { X } from "lucide-react";

import { t } from "@/lib/i18n";
import { connectedPlanRows, type PlanRow, type PlanUsageReport } from "@/lib/plan-usage";
import { dismissNotice, noticeDismissed, showsGroupCostNotice, weeklyLimitNotice } from "@/lib/usage-notices";
import { api } from "@/state/store";

const GROUP_KEY = "group-cost";
const REFRESH_MS = 10 * 60_000;

function Notice({ children, dismissLabel, onDismiss, tone = "info", ...rest }: {
  children: React.ReactNode; dismissLabel: string; onDismiss: () => void; tone?: "info" | "warning"; "data-notice": string;
}) {
  return (
    <div className="w-full px-5">
      <div role="status" {...rest}
        className={`mb-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px] ${tone === "warning" ? "border-warning/30 bg-warning/10 text-warning" : "border-hairline/40 bg-panel text-ink-secondary"}`}>
        <div className="min-w-0 flex-1 break-words">{children}</div>
        <button type="button" onClick={onDismiss} aria-label={dismissLabel} title={dismissLabel} className="shrink-0 rounded p-0.5 hover:bg-raised"><X size={13} /></button>
      </div>
    </div>
  );
}

/** A group answers with several bots, and each one reads the whole thread:
 * it costs more than one bot. Dismissed once, it stays gone. */
export function GroupCostNotice({ group }: { group: { dm?: boolean; peopleDm?: boolean; memberIds: string[] } }) {
  const [hidden, setHidden] = useState(() => noticeDismissed(GROUP_KEY));
  if (hidden || !showsGroupCostNotice(group)) return null;
  return (
    <Notice data-notice="group-cost" dismissLabel={t("chat.notice.groupCost.dismiss")} onDismiss={() => { dismissNotice(GROUP_KEY); setHidden(true); }}>
      {t("chat.notice.groupCost")}
    </Notice>
  );
}

/** A subscription's weekly window at 80 % or more, from the same report as
 * Settings > Usage. Null when the report cannot be read. Shown by the model
 * picker's limit indicator, never as a banner above the chat. */
export function useWeeklyLimit() {
  const [rows, setRows] = useState<PlanRow[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => { void api<PlanUsageReport>("/api/plan-usage").then((report) => { if (alive) setRows(connectedPlanRows(report)); }, () => {}); };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);
  return weeklyLimitNotice(rows);
}
