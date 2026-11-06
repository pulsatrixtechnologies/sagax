import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createSystemTray } from "./system-tray.mjs";

const iconPath = fileURLToPath(new URL("./resources/app-icon.png", import.meta.url));
class Window extends EventEmitter {
  constructor(options = {}) {
    super(); this.options = options; this.destroyed = false; this.visible = false;
    this.webContents = new EventEmitter();
  }
  isDestroyed() { return this.destroyed; }
  destroy() { this.destroyed = true; this.emit("closed"); }
  show() { this.visible = true; this.emit("show"); }
  showInactive() { this.show(); }
  hide() { this.visible = false; }
  focus() { this.focused = true; }
  isMinimized() { return this.minimized ?? false; }
  minimize() { this.minimized = true; }
  restore() { this.minimized = false; }
  maximize() { this.maximized = true; }
  setSkipTaskbar(value) { this.skipTaskbar = value; }
}
function fixture() {
  const calls = [];
  let trayInstance;
  class Tray extends EventEmitter {
    constructor(_icon, guid) { super(); this.guid = guid; trayInstance = this; }
    setToolTip(value) { this.tooltip = value; }
    setContextMenu(value) { this.menu = value; }
    isDestroyed() { return this.destroyed ?? false; }
    destroy() { this.destroyed = true; calls.push("destroy-tray"); }
  }
  let active;
  const tray = createSystemTray({ Tray, Menu: { buildFromTemplate: value => value },
    nativeImage: { createFromPath: () => ({ resize: () => ({}) }) }, iconPath,
    getWindow: () => active, onQuit: () => calls.push("quit"), platform: "win32" });
  const win = new Window();
  win.on("show", () => tray.windowShown(win));
  return { tray, trayInstance, win, calls, setActive: value => { active = value; } };
}

test("tray restores minimized windows, supports explicit quit, and disposes once", async () => {
  const { win, tray, trayInstance, setActive, calls } = fixture();
  setActive(win);
  win.minimize(); tray.hide(win); trayInstance.emit("click");
  assert.equal(win.minimized, false); assert.equal(win.focused, true);
  assert.equal(win.skipTaskbar, false);
  trayInstance.menu[2].click();
  tray.destroy(); tray.destroy();
  assert.deepEqual(calls, ["quit", "destroy-tray"]);
  win.destroy(); assert.equal(tray.show(), false);
});

const mainSource = readFileSync(new URL("./main.mjs", import.meta.url), "utf8");

test("the splash screen is gone: no module, preload or window for it", () => {
  assert.equal(existsSync(new URL("./startup-screen.mjs", import.meta.url)), false);
  assert.equal(existsSync(new URL("./startup-screen-preload.cjs", import.meta.url)), false);
  assert.doesNotMatch(mainSource, /startup-screen|createStartupScreen|startupScreen|openStartupScreen/);
});

test("the main window is created hidden for its first paint and shown without a splash", () => {
  const create = mainSource.slice(mainSource.indexOf("function createWindow("));
  assert.match(create, /show: false,/);
  assert.match(create, /win\.once\("ready-to-show", showWindow\)/);
  assert.match(create, /backgroundColor: "#070707"/);
});
