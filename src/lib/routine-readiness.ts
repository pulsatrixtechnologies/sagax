import type { RoutineReadinessCheck } from "../../shared/routine-readiness";
import { t } from "./i18n";
/** Run errors remain English on the wire; every readiness surface uses its stable code. */
export function routineReadinessLine(check: RoutineReadinessCheck): string {
  return t(check.code === "ready" ? `routineReadiness.ready.${check.kind}` : `routineReadiness.${check.code}`, check.params);
}
