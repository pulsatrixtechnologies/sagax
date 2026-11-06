// Domain slice of the client store reduce(views).
// Returns the next state when it handles the action, otherwise undefined.
import type {Action, AppState} from "./model";

export type ReduceFn = (state: AppState, action: Action) => AppState;

/** 2026-11-02 (JC): a full page (Automations, Code, Approvals, Remote
 * sessions, Achievements, Team map) never keeps a bot's or a person's right
 * panel open: every right-slot panel closes when the page opens. */
export const closedRightPanels = {
  settingsOpen: false,
  computerOpen: false,
  personPanelId: null,
  panelOwner: null,
  inspectorOpen: false,
  activityOpen: false,
  appSettingsOpen: false,
  routineRunWindow: null,
  codingChat: null,
} satisfies Partial<AppState>;

export function reduceViews(state: AppState, action: Action, _reduce: ReduceFn): AppState | undefined {
  switch (action.type) {
    case "showRoutines":
      return {
        ...state,
        activeView: "routines",
        ...closedRightPanels,
        routinesFocus: { section: action.section, view: action.view, botId: action.botId, routineId: action.routineId, runStatus: action.runStatus, runId: action.runId, editRoutineId: action.editRoutineId, nonce: state.routinesFocus.nonce + 1 },
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
      return state.activeView === "chat" && !state.pluginsOpen && !state.memoryManagerOpen && !state.orgImportOpen && !state.archivedBotsOpen
        ? state
        : { ...state, activeView: "chat", pluginsOpen: false, memoryManagerOpen: false, orgImportStaged: null, orgImportOpen: false, archivedBotsOpen: false };
    case "showCode":
      return {
        ...state,
        activeView: "code",
        ...closedRightPanels,
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
        ...closedRightPanels,
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
        ...closedRightPanels,
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
        ...closedRightPanels,
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
      // Restored centred window (was a portal dialog before UX lot 5).
      return {
        ...state,
        archivedBotsOpen: true,
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
        orgImportOpen: false,
      };
    case "closeArchivedBots":
      return state.archivedBotsOpen ? { ...state, archivedBotsOpen: false } : state;
    case "showOrgImport":
      // Restored centred DialogLayer window (was a <dialog> before UX lot 6).
      return {
        ...state,
        orgImportOpen: true,
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
        archivedBotsOpen: false,
      };
    case "closeOrgImport":
      return state.orgImportOpen || state.orgImportStaged
        ? { ...state, orgImportOpen: false, orgImportStaged: null }
        : state;
    case "showTeamMap":
      return {
        ...state,
        activeView: "team-map",
        ...closedRightPanels,
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
