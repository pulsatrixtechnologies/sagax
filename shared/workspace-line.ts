// The discreet thread line a bot on Auto leaves when its Workspace changes
// (server/auto-computer.ts autoStartTarget): "On your computer", "In the
// cloud", or "Moved to the cloud: your computer is offline" when the place it
// wanted was not available. Routine reasons stay distinct: not allowed on
// the computer, or routines start in the cloud by default. The server writes
// these exact activity names; the client shows them in the person's language
// (src/lib/activity-runs.ts statusActivity), like shared/sandbox-wake.ts. An
// older client shows the English text after "notice:".
import type { SelectedComputer } from "./execution-target.ts";

export type WorkspaceFallbackReason =
  | "offline"
  | "routine-not-allowed"
  | "routine-default"
  | "unavailable";

const PLACE: Record<SelectedComputer, string> = {
  this_computer: "your computer",
  browser: "the browser",
  cloud: "the cloud",
  local_vm: "the Local VM",
};
const ON: Record<SelectedComputer, string> = {
  this_computer: "On your computer",
  browser: "In the browser",
  cloud: "In the cloud",
  local_vm: "In the Local VM",
};
const WHY: Record<WorkspaceFallbackReason, (wanted: SelectedComputer) => string> = {
  offline: () => "your computer is offline",
  "routine-not-allowed": () => "routines are not allowed on your computer",
  "routine-default": () => "routines start in the cloud by default",
  unavailable: (wanted) => `${PLACE[wanted]} is not available`,
};

export interface WorkspaceLine {
  target: SelectedComputer;
  /** Present when the bot wanted another place and could not use it. */
  fallback?: { wanted: SelectedComputer; reason: WorkspaceFallbackReason };
}

/** The activity name the server stores for one line. */
export function workspaceLineName(line: WorkspaceLine): string {
  if (!line.fallback) return `notice: Workspace: ${ON[line.target]}`;
  return `notice: Workspace: moved to ${PLACE[line.target]}: ${WHY[line.fallback.reason](line.fallback.wanted)}`;
}

const TARGETS = Object.keys(PLACE) as SelectedComputer[];
const REASONS = Object.keys(WHY) as WorkspaceFallbackReason[];
const BY_NAME = new Map<string, WorkspaceLine>();
for (const target of TARGETS) {
  BY_NAME.set(workspaceLineName({ target }), { target });
  for (const wanted of TARGETS) {
    if (wanted === target) continue;
    for (const reason of REASONS) {
      // offline ignores wanted, so this_computer and local_vm share one
      // offline name: keep the first (this_computer). Routine reasons have
      // their own wording and never share a name with offline.
      const line = { target, fallback: { wanted, reason } };
      const name = workspaceLineName(line);
      if (!BY_NAME.has(name)) BY_NAME.set(name, line);
    }
  }
}

/** The line an activity name stands for, or null when it is not one. */
export function parseWorkspaceLine(name: string | undefined | null): WorkspaceLine | null {
  return name ? BY_NAME.get(name) ?? null : null;
}

/** The line Auto leaves when a turn starts on the person's own computer
 * ("On your computer"), and when it comes back there from elsewhere. The server still writes it (lastAutoPlace in server/index.ts
 * reads it to know where the thread last was), but no client shows it: the
 * computer is where a bot works by default, so saying so is noise (the maintainer,
 * 2026-10-18). The cloud, browser and Local VM lines and every "moved to"
 * line stay. iOS and Android keep the same name in ChatPreferences. */
export const QUIET_WORKSPACE_LINE = workspaceLineName({ target: "this_computer" });

export function isQuietWorkspaceLine(name: string | undefined | null): boolean {
  return name === QUIET_WORKSPACE_LINE;
}
