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
  const resetsAt = "resetsAt" in line && typeof line.resetsAt === "number" ? line.resetsAt : undefined;
  const time = resetsAt !== undefined ? resetClockText(resetsAt, clockLocale(), undefined, now) : "";
  switch (line.kind) {
    case "switched":
      if (line.reason === "model") {
        return t(line.to === "Auto" ? "limitFailover.modelSwitchedAuto" : "limitFailover.modelSwitched", {
          from: line.from, to: line.to,
        });
      }
      // A quick model Sagax picked for this turn: the conversation never goes
      // back to it, Sagax only skips it for quick turns until it resets.
      if (line.detour) return t(line.estimated ? "limitFailover.detourNoReset" : "limitFailover.detour", { from: line.from, time });
      // A backup standing in for the conversation's own engine refused in
      // turn: the conversation goes back to its own engine, never to it.
      if (line.home) {
        const words = { from: line.from, home: line.home, to: line.to, time };
        if (line.owner) return t(line.estimated ? "limitFailover.ownerSwitchedStandInNoReset" : "limitFailover.ownerSwitchedStandIn", words);
        return t(line.estimated ? "limitFailover.switchedStandInNoReset" : "limitFailover.switchedStandIn", words);
      }
      // The engine named no reset: the time is only when Sagax tries it again.
      if (line.estimated) {
        return t(line.owner ? "limitFailover.ownerSwitchedNoReset" : "limitFailover.switchedNoReset", { from: line.from, to: line.to, time });
      }
      return t(line.owner ? "limitFailover.ownerSwitched" : "limitFailover.switched", { from: line.from, to: line.to, time });
    case "back":
      if (line.refused) return t("limitFailover.backAfterLimit", { refused: line.refused, engine: line.engine });
      return t("limitFailover.back", { engine: line.engine });
    case "waiting":
      // A backup standing in for the conversation's own engine refused: the message waits for that engine.
      if (line.home) {
        const words = { from: line.from, home: line.home, time };
        if (line.owner) return t(line.estimated ? "limitFailover.ownerWaitingStandInNoReset" : "limitFailover.ownerWaitingStandIn", words);
        return t(line.estimated ? "limitFailover.waitingStandInNoReset" : "limitFailover.waitingStandIn", words);
      }
      if (line.estimated) return t(line.owner ? "limitFailover.ownerWaitingNoReset" : "limitFailover.waitingNoReset", { from: line.from, time });
      return t(line.owner ? "limitFailover.ownerWaiting" : "limitFailover.waiting", { from: line.from, time });
    case "waitingRoutine":
      if (line.home) {
        return t(line.estimated ? "limitFailover.waitingRoutineStandInNoReset" : "limitFailover.waitingRoutineStandIn", { from: line.from, home: line.home, time });
      }
      return t(line.estimated ? "limitFailover.waitingRoutineNoReset" : "limitFailover.waitingRoutine", { from: line.from, time });
    case "exhausted": {
      const tried = line.tried.filter(Boolean).join(", ") || "the engines tried";
      if (line.resetsAt !== undefined) {
        return t(line.owner ? "limitFailover.ownerExhausted" : "limitFailover.exhausted", {
          tried, time: resetClockText(line.resetsAt, clockLocale(), undefined, now),
        });
      }
      return t(line.owner ? "limitFailover.ownerExhaustedNoTime" : "limitFailover.exhaustedNoTime", { tried });
    }
    case "signedOut":
      return t("limitFailover.signedOut", { from: line.from, to: line.to });
    case "signedOutNotice":
      return t("limitFailover.signedOutNotice", { from: line.from, to: line.to });
  }
}
