// Open Sagax when the person signs in to this Mac. The choice is theirs.
// Unset does not touch login items: nothing starts until they accept on screen.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const CHOICES = new Set(["unset", "on", "off"]);

export function parseChoice(raw) {
  if (!raw || typeof raw !== "object") return "unset";
  return CHOICES.has(raw.choice) ? raw.choice : "unset";
}

export function readChoiceFile(file) {
  try {
    return parseChoice(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return "unset";
  }
}

export function choiceDocument(choice) {
  if (!CHOICES.has(choice) || choice === "unset") throw new Error("choice must be on or off");
  return JSON.stringify({ choice });
}

/** Applies the saved choice. Unset returns without calling the login-item API. */
export function applyLoginItem(app, choice, platform) {
  if (platform !== "darwin" || choice === "unset") return { applied: false, openAtLogin: false };
  const openAtLogin = choice === "on";
  // Electron 45 removed openAsHidden (and wasOpenedAsHidden / restoreState).
  app.setLoginItemSettings({ openAtLogin });
  return { applied: true, openAtLogin };
}

export function installOpenAtLogin({ ipcMain, app, guard }) {
  const file = () => join(app.getPath("userData"), "open-at-login.json");
  const read = () => readChoiceFile(file());
  const apply = (choice) => applyLoginItem(app, choice, process.platform);
  ipcMain.handle("open-at-login:get", guard("open-at-login:get", () => ({
    choice: read(),
    platform: process.platform,
  })));
  ipcMain.handle("open-at-login:set", guard("open-at-login:set", (_event, choice) => {
    if (choice !== "on" && choice !== "off") throw new Error("choice must be on or off");
    const path = file();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, choiceDocument(choice));
    apply(choice);
    return { choice, platform: process.platform };
  }));
  void app.whenReady().then(() => apply(read()));
}
