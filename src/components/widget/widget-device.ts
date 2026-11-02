// The in-app places a widget button opens on this device (2026-11-02): a
// button that names a place ("Open the routine board") opens it at once, the
// way the reference design's cards do, instead of asking the model to. The
// press is then recorded for the bot as done (server/routes/bots-messages.ts).
import { openRoutineRun, type Action } from "@/state/store";
import type { WidgetAppAction } from "../../../shared/widget";

/** Open the place on this device. */
export function performWidgetAppAction(dispatch: (action: Action) => void, action: WidgetAppAction, botId: string): void {
  if (action.type === "open_run") {
    openRoutineRun(dispatch, { runId: action.runId, ...(action.routineId ? { routineId: action.routineId } : {}) });
    return;
  }
  if (action.type === "open_routine") {
    dispatch({ type: "showRoutines", botId: action.botId ?? botId, routineId: action.routineId });
    return;
  }
  switch (action.page) {
    case "routines": dispatch({ type: "showRoutines", botId }); return;
    case "approvals": dispatch({ type: "showApprovals" }); return;
    case "team_map": dispatch({ type: "showTeamMap" }); return;
    case "achievements": dispatch({ type: "showAchievements" }); return;
    case "code": dispatch({ type: "showCode" }); return;
    case "remote_sessions": dispatch({ type: "showRemoteSessions" }); return;
  }
}
