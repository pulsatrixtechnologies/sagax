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
  artifactPanel: { botId: "bot-1", artifactId: "art_1", title: "Live table" },
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
    artifactPanel: null,
  });
}

describe("full pages close every right panel", () => {
  for (const action of pages) {
    it(action.type, () => expectClosed(reduceViews(open, action, (s) => s)));
  }
  it("toggleMemoryManager", () => expectClosed(reduceUi(open, {type: "toggleMemoryManager", open: true} as Action, (s) => s)));
  it("toggleTriggers", () => expectClosed(reduceUi(open, {type: "toggleTriggers"} as Action, (s) => s)));
});

describe("openArtifactPanel", () => {
  it("opens the artifact panel and closes every other right panel", () => {
    const next = reduceUi(open, {
      type: "openArtifactPanel",
      panel: { botId: "bot-2", artifactId: "art_2", title: "Sales" },
    }, (s) => s);
    expect(next).toMatchObject({
      artifactPanel: { botId: "bot-2", artifactId: "art_2", title: "Sales" },
      settingsOpen: false,
      computerOpen: false,
      personPanelId: null,
      panelOwner: null,
      inspectorOpen: false,
      activityOpen: false,
      appSettingsOpen: false,
    });
  });

  it("closes when panel is null", () => {
    const next = reduceUi(
      { ...initialState, artifactPanel: { botId: "bot-1", artifactId: "art_1", title: "Live" } },
      { type: "openArtifactPanel", panel: null },
      (s) => s,
    );
    expect(next?.artifactPanel).toBeNull();
  });

  it("opening settings closes the artifact panel", () => {
    const start = { ...initialState, artifactPanel: { botId: "bot-1", artifactId: "art_1", title: "Live" }, bots: [{ id: "bot-1", hidden: false } as AppState["bots"][number]] };
    const next = reduceUi(start, { type: "toggleSettings", open: true, botId: "bot-1" }, (s) => s);
    expect(next?.artifactPanel).toBeNull();
    expect(next?.settingsOpen).toBe(true);
  });
});
