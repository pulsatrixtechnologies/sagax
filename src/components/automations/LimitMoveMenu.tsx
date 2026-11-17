// The one action of the old usage banner (2026-11-17, owner: no banner on the
// Routines page): for each engine near its limit with routines due before its
// reset, "Move after reset" moves just their next run to after the reset. It is
// a row of the page menu, drawn only while it applies (no row: no menu).
import { useEffect, useState, type RefObject } from "react";
import { Check, Hourglass } from "lucide-react";

import { PAGE_INDICATOR, PageMenu, PageMenuItem } from "@/components/content-page";
import { t } from "@/lib/i18n";

import { dueBeforeReset, limitLine, nearLimitEngines, useEngineLimits, type EngineLimit } from "@/lib/limit-resets";
import type { Routine } from "@/lib/routines";
import { api, useStore } from "@/state/store";

export function LimitMoveMenu({ botFilter, menuRef }: { botFilter: string; menuRef: RefObject<HTMLDetailsElement | null> }) {
  const { state, dispatch } = useStore();
  const engines = nearLimitEngines(useEngineLimits());
  const [busy, setBusy] = useState<string | null>(null);
  // The result shows where the person looks: a failure on the store's own error line, a success as a short
  // confirmation beside the menu (the old banner said "Moved").
  const [moved, setMoved] = useState(false);
  useEffect(() => {
    if (!moved) return;
    const timer = setTimeout(() => setMoved(false), 5000);
    return () => clearTimeout(timer);
  }, [moved]);
  const botEngine = (botId: string) => state.bots.find((bot) => bot.id === botId)?.modelSelection?.instanceId;
  const routines = state.routines.filter((routine) => botFilter === "all" || routine.botId === botFilter);
  const moves = engines.map((limit) => ({ limit, due: dueBeforeReset(routines, botEngine, limit) })).filter(({ due }) => due.length > 0);
  if (!moves.length && !moved) return null;
  const move = async (limit: EngineLimit, due: Routine[]) => {
    menuRef.current?.removeAttribute("open");
    setBusy(limit.engine);
    setMoved(false);
    try {
      for (const routine of due) {
        const response = await api<{ routine: Routine }>("/api/limit-resets/after-reset", { method: "POST", body: JSON.stringify({ routineId: routine.id, engine: limit.engine }) });
        dispatch({ type: "routinePatched", routine: response.routine });
      }
      setMoved(true);
    } catch (cause) {
      dispatch({ type: "error", message: cause instanceof Error && cause.message ? cause.message : String(cause) });
    } finally {
      setBusy(null);
    }
  };
  return <>
    {moved && <span role="status" data-limit-moved="" className={PAGE_INDICATOR}><Check size={13} aria-hidden="true" />{t("limits.moved")}</span>}
    {moves.length > 0 && <PageMenu name="automations" menuRef={menuRef} label={t("routineCalendar.automationMenu")}>
      {moves.map(({ limit, due }) => <PageMenuItem key={limit.engine} icon={Hourglass} data-limit-move={limit.engine} aria-disabled={busy === limit.engine || undefined}
        title={`${limitLine(limit)} · ${t(due.length === 1 ? "limits.dueOne" : "limits.dueMany", { count: due.length })}`}
        trailing={moves.length > 1 ? <span className="ml-auto text-[12px] text-ink-secondary">{limit.name}</span> : undefined}
        onClick={() => void move(limit, due)}>{t("limits.moveAfterReset")}</PageMenuItem>)}
    </PageMenu>}
  </>;
}
