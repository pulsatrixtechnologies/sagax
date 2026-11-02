import {describe, expect, it} from "vitest";
import {initialState, type Action, type AppState} from "./model";
import {reduceViews} from "./reduce-views";
import {reduceUi} from "./reduce-ui";

const open: AppState = {
  ...initialState,
  settingsOpen: true,
  computerOpen: true,
  personPanelId: "person-1",
  panelOwner: {botId: "bot-1"} as AppState["panelOwner"],
  inspectorOpen: true,
  activityOpen: true,
  appSettingsOpen: true,
  routineRunSheet: {runId: "run-1"},
};

const pages: Action[] = [
  {type: "showRoutines"} as Action,
  {type: "showCode"} as Action,
  {type: "showApprovals"} as Action,
  {type: "showRemoteSessions"} as Action,
  {type: "showAchievements"} as Action,
  {type: "showTeamMap"} as Action,
];

function expectClosed(next: AppState | undefined) {
  expect(next).toBeDefined();
  expect(next).toMatchObject({
    settingsOpen: false,
    computerOpen: false,
    personPanelId: null,
    panelOwner: null,
    inspectorOpen: false,
    activityOpen: false,
    appSettingsOpen: false,
    routineRunSheet: null,
  });
}

describe("full pages close every right panel", () => {
  for (const action of pages) {
    it(action.type, () => expectClosed(reduceViews(open, action, (s) => s)));
  }
  it("toggleMemoryManager", () => expectClosed(reduceUi(open, {type: "toggleMemoryManager", open: true} as Action, (s) => s)));
  it("toggleTriggers", () => expectClosed(reduceUi(open, {type: "toggleTriggers"} as Action, (s) => s)));
});
