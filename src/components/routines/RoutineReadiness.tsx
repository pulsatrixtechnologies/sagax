import { routineReadinessLine } from "@/lib/routine-readiness";
export { routineReadinessLine } from "@/lib/routine-readiness";
import { useRef, useState } from "react";
import { Check, ClipboardCheck, Loader2, X } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { routineDateTime } from "@/lib/routine-display";
import { api } from "@/state/store";
import { PILL } from "../SettingsPrimitives";
import type { RoutineReadinessAnswer, RoutineReadinessCheck } from "../../../shared/routine-readiness";

export function useRoutineReadiness(routineId: string) {
  const [state, setState] = useState<{ id: string; checking?: boolean; answer?: RoutineReadinessAnswer; error?: string }>({ id: routineId });
  const currentId = useRef(routineId);
  currentId.current = routineId;
  const check = async () => {
    setState({ id: routineId, checking: true });
    try {
      const answer = await api<RoutineReadinessAnswer>(`/api/routines/${routineId}/check`, { method: "POST" });
      if (currentId.current === routineId) setState({ id: routineId, answer });
    } catch {
      if (currentId.current === routineId) setState({ id: routineId, error: t("routineReadiness.error") });
    }
  };
  return { ...(state.id === routineId ? state : { id: routineId }), check };
}
export type RoutineReadinessControl = ReturnType<typeof useRoutineReadiness>;
export function RoutineCheckButton({ control, disabled = false }: { control: RoutineReadinessControl; disabled?: boolean }) {
  return <button type="button" data-routine-check title={t(control.checking ? "routineReadiness.checking" : "routineReadiness.action")} aria-label={t(control.checking ? "routineReadiness.checking" : "routineReadiness.action")} disabled={disabled || control.checking} onClick={() => void control.check()} className={cn(PILL, "gap-1.5")}>
    {control.checking ? <Loader2 size={13} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <ClipboardCheck size={13} aria-hidden="true" />}
    {t(control.checking ? "routineReadiness.checking" : "routineReadiness.action")}
  </button>;
}
export function RoutineReadinessList({ checks, checkedAt }: { checks: readonly RoutineReadinessCheck[]; checkedAt?: number }) {
  return <section data-routine-readiness aria-label={t("routineReadiness.action")} className="space-y-2 text-[13px]">
    {checkedAt !== undefined && <p className="text-[12px] text-ink-secondary"><time dateTime={new Date(checkedAt).toISOString()}>{t("routineReadiness.checkedAt", { time: routineDateTime(checkedAt) })}</time></p>}
    <ul className="space-y-2">{[...checks].sort((a, b) => Number(a.ok) - Number(b.ok)).map((check, index) => <li key={`${check.kind}-${index}`} data-readiness-ok={check.ok} className="flex items-start gap-2">
      {check.ok ? <Check size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-success" /> : <X size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-warning" />}
      <span className="sr-only">{t(check.ok ? "routineReadiness.pass" : "routineReadiness.fail")}: </span><span className={check.ok ? "text-ink-secondary" : "text-ink"}>{routineReadinessLine(check)}</span>
    </li>)}</ul>
  </section>;
}
