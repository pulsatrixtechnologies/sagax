import type { RoutineReadinessCheck } from "../../shared/routine-readiness";
import { activeLocale, t } from "./i18n";
/** ISO facts use the viewer's local calendar day and time zone. Old saved labels still render. */
function localTime(value: string): string {
  const at = new Date(value);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(at.getTime())) return value;
  const now = new Date();
  const today = at.toDateString() === now.toDateString();
  return at.toLocaleString(activeLocale(), { hour: "numeric", minute: "2-digit",
    ...(!today ? { month: "short", day: "numeric", ...(at.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) } : {}) });
}
/** Run errors remain English on the wire; every readiness surface uses its stable code. */
export function routineReadinessLine(check: RoutineReadinessCheck): string {
  const params = { ...check.params };
  for (const key of ["at", "until"]) if (params[key]) params[key] = localTime(params[key]);
  return t(check.code === "ready" ? `routineReadiness.ready.${check.kind}` : `routineReadiness.${check.code}`, params);
}
