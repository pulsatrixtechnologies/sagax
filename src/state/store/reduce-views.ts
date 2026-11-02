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
        memoryManagerOpen: false,
      };
    case "showChat":
      return state.activeView === "chat" && !state.pluginsOpen && !state.memoryManagerOpen
        ? state
        : { ...state, activeView: "chat", pluginsOpen: false, memoryManagerOpen: false, orgImportStaged: null };
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
        memoryManagerOpen: false,
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
        memoryManagerOpen: false,
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
        memoryManagerOpen: false,
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
        memoryManagerOpen: false,
        newBotOpen: false,
        shortcutsOpen: false,
        personaEditor: null,
        botWizard: null,
      };
    case "showArchivedBots":
      // 2026-11-01 (lot 5): archived bots as a content-frame list, not a window.
      return {
        ...state,
        activeView: "archived-bots",
        settingsOpen: false,
        personPanelId: null,
        computerOpen: false,
        inspectorOpen: false,
        activityOpen: false,
        appSettingsOpen: false,
        pluginsOpen: false,
        triggersOpen: false,
        memoryManagerOpen: false,
        newBotOpen: false,
        shortcutsOpen: false,
        personaEditor: null,
        botWizard: null,
      };
    case "showOrgImport":
      // 2026-11-01 (lot 6): bring bots from a solo Sagax as a content view.
      return {
        ...state,
        activeView: "org-import",
        orgImportStaged: action.staged ?? null,
        settingsOpen: false,
        personPanelId: null,
        computerOpen: false,
        inspectorOpen: false,
        activityOpen: false,
        appSettingsOpen: false,
        pluginsOpen: false,
        triggersOpen: false,
        memoryManagerOpen: false,
        newBotOpen: false,
        shortcutsOpen: false,
        personaEditor: null,
        botWizard: null,
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
        memoryManagerOpen: false,
      };
  }
  return undefined;
}
