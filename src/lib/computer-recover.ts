// Settings > Computer: recover the bot's computer when it is stuck, or
// update it now (parity R7, system 6 and 5). Sagax keeps no snapshot of the
// computer: recover is the same rebuild as an update (POST
// /api/computer/update, server/routes/computer-status.ts), from the current
// image, files kept. The phone decides it the same way
// (ios/Sources/CompanionCore/Parity3F.swift ComputerCare.needsRecover).
import { api } from "@/state/store";

export interface ComputerStatusView {
  kind?: "org-sandbox" | "local";
  configured: boolean;
  state: string;
  problem?: string;
  waking?: { since: number; elapsedMs: number };
}

/** Up and usable: Update now is offered. */
const RUNNING = new Set(["running", "ready", "idle"]);
/** Asleep or not created yet, on purpose (an organization's environments
 * sleep off hours): it starts with the next task, nothing to offer. */
const ASLEEP = new Set(["stopped", "paused", "missing", "starting"]);

/** A real failure: the computer reports a problem, or a state that is
 * neither up nor asleep (unavailable, or one this app does not know). */
export function needsRecover(status: ComputerStatusView): boolean {
  if (!status.configured) return false;
  if (status.problem?.trim()) return true;
  return !RUNNING.has(status.state) && !ASLEEP.has(status.state);
}

/** The one action the row offers, or none (no computer here, asleep, or
 * waking: it comes up by itself). */
export function computerAction(status: ComputerStatusView | null): "recover" | "update" | null {
  if (!status?.configured) return null;
  if (needsRecover(status)) return "recover";
  if (status.waking) return null;
  return RUNNING.has(status.state) ? "update" : null;
}

export function loadComputerStatus(signal?: AbortSignal): Promise<ComputerStatusView> {
  return api<ComputerStatusView>("/api/computer/status", signal ? { signal } : {});
}

/** Rebuild from the current image; the person's files stay. */
export function updateComputer(): Promise<ComputerStatusView> {
  return api<ComputerStatusView>("/api/computer/update", { method: "POST", body: "{}" });
}

/** The heavier rebuild (Reset): from the last snapshot, confirmed by the
 * caller. Unlike update it is not held back by a working bot (it is confirmed
 * first); the server erases the organization workspace or recreates the Local
 * VM container per its own rules (server/routes/computer-status.ts). */
export function resetComputer(): Promise<ComputerStatusView> {
  return api<ComputerStatusView>("/api/computer/reset", { method: "POST", body: JSON.stringify({ confirm: true }) });
}
