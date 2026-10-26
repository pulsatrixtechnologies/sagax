// The usage-limit line of a conversation (shared/limit-failover.ts) in the
// reader's language, the reset in the reader's clock ("vers 14 h 05").
import { activeLocale, t } from "@/lib/i18n";
import { resetClockText, type LimitFailoverLine } from "../../shared/limit-failover";

/** The locale a clock is written in: Quebec French for the French UI. */
function clockLocale(): string {
  const active = activeLocale();
  return active === "fr" ? "fr-CA" : active;
}

export function limitFailoverLineText(line: LimitFailoverLine, now = Date.now()): string {
  const time = "resetsAt" in line ? resetClockText(line.resetsAt, clockLocale(), undefined, now) : "";
  switch (line.kind) {
    case "switched":
      return t(line.owner ? "limitFailover.ownerSwitched" : "limitFailover.switched", { from: line.from, to: line.to, time });
    case "back":
      return t("limitFailover.back", { engine: line.engine });
    case "waiting":
      return t(line.owner ? "limitFailover.ownerWaiting" : "limitFailover.waiting", { from: line.from, time });
    case "waitingRoutine":
      return t("limitFailover.waitingRoutine", { from: line.from, time });
  }
}
