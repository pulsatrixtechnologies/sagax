// The Windows install's identity and shortcut rules (electron-builder.yml,
// build/installer.nsh). An update must find the install it replaces: if the
// AppUserModelId, the executable, the per-user folder or the shortcut name
// moved, the update would leave the old shortcuts and taskbar pins pointing
// at nothing (2026-10-19, a Windows report of lost shortcut icons).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";

const root = new URL("../", import.meta.url);
const config = parse(readFileSync(new URL("electron-builder.yml", root), "utf8"));
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const include = readFileSync(new URL("build/installer.nsh", root), "utf8");

test("the install keeps its identity across updates", () => {
  assert.equal(config.appId, "com.openmausbot.app", "AppUserModelId of every shortcut and pin");
  assert.equal(config.productName, "Sagax", "Sagax.exe, the shortcuts' target");
  assert.equal(pkg.name, "openmausbot", "per-user folder %LOCALAPPDATA%\\Programs\\openmausbot");
  assert.equal(config.executableName, undefined, "a top-level executableName would rename Sagax.exe");
  assert.equal(config.win?.executableName, undefined);
  assert.ok(config.win.target.some((target) => target.target === "nsis"));
});

test("one-click, per user, shortcuts made once and kept by updates", () => {
  const nsis = config.nsis;
  assert.equal(nsis.oneClick, true);
  assert.equal(nsis.perMachine, false);
  assert.equal(nsis.allowToChangeInstallationDirectory, false,
    "with it, an update would not try to keep the shortcuts (setIsTryToKeepShortcuts)");
  // true: created on install, kept as the person left them on update.
  // "always" would bring back a shortcut the person deleted.
  assert.equal(nsis.createDesktopShortcut, true);
  assert.equal(nsis.createStartMenuShortcut, true);
  assert.equal(nsis.shortcutName, "Pulsatrix Sagax");
  assert.equal(nsis.runAfterFinish, true, "Sagax opens again after the installer");
  assert.equal(nsis.deleteAppDataOnUninstall ?? false, false, "an update never touches the person's data");
  assert.equal(nsis.include, "build/installer.nsh");
});

test("the installer include only refreshes icons: it never deletes or recreates a shortcut", () => {
  assert.match(include, /!macro customInstall[\s\S]*!macroend/);
  assert.match(include, /SHChangeNotify\(i 0x08000000/);
  for (const forbidden of [/\bDelete\b/, /CreateShortCut/i, /RMDir/i, /customUnInstall/, /customRemoveFiles/]) {
    assert.doesNotMatch(include, forbidden);
  }
});

test("Windows publishes no publisherName while the installer is unsigned", () => {
  // electron-updater rejects every update whose signature does not match it.
  assert.equal(config.win?.publisherName, undefined);
  assert.equal(config.win?.signtoolOptions?.publisherName, undefined);
});
