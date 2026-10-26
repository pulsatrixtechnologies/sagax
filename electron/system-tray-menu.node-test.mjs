import assert from "node:assert/strict";
import test from "node:test";
import { buildTrayMenuTemplate, createSystemTray, macTrayImage, normalizeBotHotkeyConfig, normalizeRoster, normalizeTrayLabels, rosterLabel, slotAccelerator, statusDotBitmap } from "./system-tray.mjs";
import { createBotHotkeys } from "./mascot-hotkey.mjs";

const bot = (n, extra = {}) => ({ id: `b${n}`, name: `Bot ${n}`, color: "#FF0000", working: false, unread: 0, ...extra });

test("the roster is checked: nine bots, no nameless or idless entries, a bad color falls back", () => {
  const raw = Array.from({ length: 12 }, (_, i) => bot(i + 1));
  assert.equal(normalizeRoster(raw).length, 9);
  assert.deepEqual(normalizeRoster([{ id: "", name: "x" }, { id: "a", name: "  " }, null, 3]), []);
  assert.equal(normalizeRoster([bot(1, { color: "red; evil" })])[0].color, "#8E8E93");
  assert.equal(normalizeRoster([bot(1, { unread: 500 })])[0].unread, 99);
  assert.deepEqual(normalizeRoster("nope"), []);
});

test("a bot line names its state", () => {
  assert.equal(rosterLabel(bot(1)), "Bot 1");
  assert.equal(rosterLabel(bot(1, { working: true, unread: 2 })), "Bot 1 (working)");
  assert.equal(rosterLabel(bot(1, { unread: 1 })), "Bot 1 (unread)");
  assert.equal(rosterLabel(bot(1, { unread: 3 })), "Bot 1 (3 unread)");
});

test("macOS keeps Cmd+Shift+3, 4 and 5 for screenshots", () => {
  assert.equal(slotAccelerator(1, "darwin"), "CommandOrControl+Shift+1");
  for (const slot of [3, 4, 5]) assert.equal(slotAccelerator(slot, "darwin"), null);
  assert.equal(slotAccelerator(4, "win32"), "CommandOrControl+Shift+4");
  assert.equal(slotAccelerator(10, "win32"), null);
});

test("the menu lists the bots with their shortcut, then Open and Quit; a click opens that bot", () => {
  const opened = [];
  const menu = buildTrayMenuTemplate({
    roster: [bot(1, { working: true }), bot(2, { unread: 1 })], platform: "darwin",
    icon: (b) => `dot-${b.id}`, onOpenBot: (id) => opened.push(id), onShow: () => opened.push("show"), onQuit: () => opened.push("quit"),
  });
  assert.deepEqual(menu.map((item) => item.label ?? item.type), ["Bots (1 unread)", "Bot 1 (working)", "Bot 2 (unread)", "separator", "Open Sagax", "separator", "Quit Sagax"]);
  assert.equal(menu[1].accelerator, "CommandOrControl+Shift+1");
  assert.equal(menu[1].registerAccelerator, false);
  assert.equal(menu[2].icon, "dot-b2");
  menu[2].click();
  menu[4].click();
  menu[6].click();
  assert.deepEqual(opened, ["b2", "show", "quit"]);
});

test("Windows shows no shortcut it does not register", () => {
  const menu = buildTrayMenuTemplate({ roster: [bot(1)], platform: "win32", onOpenBot() {}, onShow() {}, onQuit() {} });
  assert.equal(menu[1].accelerator, undefined);
});

test("without bots the menu is the plain Open and Quit", () => {
  const menu = buildTrayMenuTemplate({ roster: [], onOpenBot() {}, onShow() {}, onQuit() {} });
  assert.deepEqual(menu.map((item) => item.label ?? item.type), ["Open Sagax", "separator", "Quit Sagax"]);
});

test("the status dot is a colored round bitmap, transparent at the corners", () => {
  const { buffer, width, height } = statusDotBitmap("#336699", { working: false });
  assert.equal(buffer.length, width * height * 4);
  assert.equal(buffer[3], 0);
  const center = ((height / 2) * width + width / 2) * 4;
  assert.deepEqual([buffer[center], buffer[center + 1], buffer[center + 2], buffer[center + 3]], [0x99, 0x66, 0x33, 255]);
  const working = statusDotBitmap("#336699", { working: true });
  assert.deepEqual([working.buffer[center], working.buffer[center + 1], working.buffer[center + 2]], [255, 255, 255]);
});

test("the macOS tray opens its menu on a click and rebuilds it with the roster", () => {
  const menus = [];
  const handlers = [];
  class Tray {
    constructor() { this.tip = ""; }
    setToolTip(value) { this.tip = value; }
    setContextMenu(value) { menus.push(value); }
    on(name) { handlers.push(name); }
    isDestroyed() { return false; }
    destroy() {}
  }
  const image = { resize: () => ({}) };
  const tray = createSystemTray({ Tray, Menu: { buildFromTemplate: (v) => v }, platform: "darwin",
    nativeImage: { createFromPath: () => image, createFromBitmap: () => ({}) }, iconPath: "x", getWindow: () => null, onQuit() {} });
  assert.deepEqual(handlers, []);
  assert.equal(tray.setRoster([bot(1, { working: true })]).length, 1);
  assert.equal(menus.length, 2);
  assert.equal(menus[1][1].label, "Bot 1 (working)");
});

test("bot hotkeys follow the roster: one key per bot, released when it shrinks or empties", () => {
  const registered = new Map();
  const pressed = [];
  const globalShortcut = {
    register: (accelerator, cb) => { if (accelerator.endsWith("+7")) return false; registered.set(accelerator, cb); return true; },
    unregister: (accelerator) => registered.delete(accelerator),
  };
  const logs = [];
  const keys = createBotHotkeys({ globalShortcut, onSlot: (n) => pressed.push(n), slotFor: (n) => slotAccelerator(n, "darwin"), log: (l) => logs.push(l) });
  assert.deepEqual(keys.sync(6), [1, 2, 6]);
  registered.get("CommandOrControl+Shift+2")();
  assert.deepEqual(pressed, [2]);
  assert.deepEqual(keys.sync(8), [1, 2, 6, 8]);
  assert.equal(logs.length, 1);
  assert.deepEqual(keys.sync(2), [1, 2]);
  assert.equal(registered.size, 2);
  assert.deepEqual(keys.sync(5, false), []);
  keys.sync(2);
  keys.dispose();
  assert.equal(registered.size, 0);
});

test("the menu speaks the page's language, defaults to English, and drops unknown or long labels", () => {
  const labels = normalizeTrayLabels({ bots: "Bots", open: "Ouvrir Sagax", quit: "Quitter Sagax", botsUnread: "Bots ({count} non lus)", evil: "x", working: "x".repeat(200) });
  assert.equal(labels.working, "working");
  assert.equal("evil" in labels, false);
  const items = buildTrayMenuTemplate({ roster: [bot(1, { unread: 2 })], platform: "darwin", labels, onOpenBot() {}, onShow() {}, onQuit() {} });
  assert.equal(items[0].label, "Bots (2 non lus)");
  assert.equal(items.at(-3).label, "Ouvrir Sagax");
  assert.equal(items.at(-1).label, "Quitter Sagax");
  assert.equal(rosterLabel(bot(1, { unread: 3 }), normalizeTrayLabels({ unreadMany: "{count} non lus" })), "Bot 1 (3 non lus)");
});

test("the bots' shortcuts follow the setting: off shows no accelerator, a chord remaps them", () => {
  assert.deepEqual(normalizeBotHotkeyConfig(null), { enabled: true, modifier: "cmd-shift" });
  assert.deepEqual(normalizeBotHotkeyConfig({ enabled: false, modifier: "nope" }), { enabled: false, modifier: "cmd-shift" });
  assert.equal(slotAccelerator(1, "darwin", "cmd-alt"), "CommandOrControl+Alt+1");
  assert.equal(slotAccelerator(4, "darwin", "ctrl-alt"), "Control+Alt+4");
  assert.equal(slotAccelerator(4, "darwin", "cmd-shift"), null);
  const base = { roster: [bot(1)], platform: "darwin", onOpenBot() {}, onShow() {}, onQuit() {} };
  assert.equal(buildTrayMenuTemplate({ ...base, hotkeys: { enabled: false, modifier: "cmd-shift" } })[1].accelerator, undefined);
  assert.equal(buildTrayMenuTemplate({ ...base, hotkeys: { enabled: true, modifier: "cmd-alt" } })[1].accelerator, "CommandOrControl+Alt+1");
});

test("the macOS menu bar icon is a template image when the mark is there", () => {
  let template = null;
  const image = { isEmpty: () => false, setTemplateImage: (on) => { template = on; } };
  const native = { createFromPath: (path) => (path === "mark.png" ? image : { resize: () => "colored" }) };
  assert.equal(macTrayImage(native, "app.png", "mark.png"), image);
  assert.equal(template, true);
  const added = [];
  const retina = { isEmpty: () => false, getSize: () => ({ width: 44, height: 40 }), toPNG: () => Buffer.from("png") };
  const withRetina = {
    isEmpty: () => false,
    setTemplateImage() {},
    addRepresentation: (rep) => added.push(rep),
  };
  macTrayImage({ createFromPath: (file) => (String(file).endsWith("@2x.png") ? retina : withRetina) }, "app.png", "mark.png");
  assert.equal(added.length, 1);
  assert.equal(added[0].scaleFactor, 2);
  assert.equal(added[0].width, 22);
  assert.equal(added[0].height, 20);
  assert.equal(macTrayImage(native, "app.png", null), "colored");
  assert.equal(macTrayImage({ createFromPath: (path) => (path === "mark.png" ? { isEmpty: () => true } : { resize: () => "colored" }) }, "app.png", "mark.png"), "colored");
});
