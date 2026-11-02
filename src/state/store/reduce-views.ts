// Domain slice of the client store reduce(views).
// Returns the next state when it handles the action, otherwise undefined.
import type {Action, AppState} from "./model";

export type ReduceFn = (state: AppState, action: Action) => AppState;

export function reduceViews(state: AppState, action: Action, _reduce: ReduceFn): AppState | undefined {
  switch (action.type) {
    case "showRoutines":
      return {
        ...state,
        activeView: "routines",
        routinesFocus: { section: action.section, view: action.view, botId: action.botId, routineId: action.routineId, runStatus: action.runStatus, runId: action.runId, nonce: state.routinesFocus.nonce + 1 },
        settingsOpen: false,
        personPanelId: null,
        computerOpen: false,
        inspectorOpen: false,
        activityOpen: false,
        appSettingsOpen: false,
        pluginsOpen: false,
        triggersOpen: false,
      };
    case "showChat":
      return state.activeView === "chat" ? state : { ...state, activeView: "chat" };
    case "showCode":
      return {
        ...state,
        activeView: "code",
        codeFocus: { ...(action.runId ? { runId: action.runId } : {}), nonce: state.codeFocus.nonce + 1 },
        settingsOpen: false,
        computerOpen: false,
        inspectorOpen: false,
        activityOpen: false,
        appSettingsOpen: false,
        pluginsOpen: false,
        triggersOpen: false,
      };
    case "showApprovals":
      return {
        ...state,
        activeView: "approvals",
        settingsOpen: false,
        computerOpen: false,
        inspectorOpen: false,
        activityOpen: false,
        appSettingsOpen: false,
        pluginsOpen: false,
        triggersOpen: false,
      };
    case "showRemoteSessions":
      return {
        ...state,
        activeView: "remote-sessions",
        settingsOpen: false,
        computerOpen: false,
        inspectorOpen: false,
        activityOpen: false,
        appSettingsOpen: false,
        pluginsOpen: false,
        triggersOpen: false,
      };
    case "showAchievements":
      return {
        ...state,
        activeView: "achievements",
        achievementsFocus: { category: action.category ?? "all", nonce: state.achievementsFocus.nonce + 1 },
        settingsOpen: false,
        personPanelId: null,
        computerOpen: false,
        inspectorOpen: false,
        activityOpen: false,
        appSettingsOpen: false,
        appSettingsSubPage: null,
        pluginsOpen: false,
        triggersOpen: false,
        newBotOpen: false,
        shortcutsOpen: false,
        personaEditor: null,
      };
    case "showTeamMap":
      return {
        ...state,
        activeView: "team-map",
        settingsOpen: false,
        computerOpen: false,
        inspectorOpen: false,
        activityOpen: false,
        appSettingsOpen: false,
        pluginsOpen: false,
        triggersOpen: false,
      };
  }
  return undefined;
}
