// The `team.work` frame (#3461, shared/team-work.ts): one per orchestrator
// and person within TEAM_WORK_FRAME_MS when its hand-overs change state,
// ids only, never per tool call. Module state, so the runtime may report a
// change at any point of the server's boot.
import { TEAM_WORK_FRAME, type TeamWorkFrame } from "../../shared/team-work.ts";

export const TEAM_WORK_FRAME_MS = 1_000;

const pending = new Map<string, { botId: string; person?: string }>();
let timer: ReturnType<typeof setTimeout> | null = null;

/** `organization`: frames name the person they are for (audience); on a
 * one-person server they name no one. */
export function queueTeamWorkFrames(
  changes: ReadonlyArray<{ botId: string; person?: string }>,
  send: (frame: TeamWorkFrame) => void,
  organization: boolean,
  delayMs = TEAM_WORK_FRAME_MS,
): void {
  for (const change of changes) {
    const person = organization ? change.person?.trim().toLowerCase() || undefined : undefined;
    pending.set(`${change.botId}\n${person ?? ""}`, { botId: change.botId, ...(person ? { person } : {}) });
  }
  if (timer || pending.size === 0) return;
  timer = setTimeout(() => {
    timer = null;
    const due = [...pending.values()];
    pending.clear();
    for (const change of due) send({ kind: TEAM_WORK_FRAME, botId: change.botId, ...(change.person ? { audience: change.person } : {}) });
  }, delayMs);
  timer.unref?.();
}
