import assert from "node:assert/strict";
import test from "node:test";
import { normalizeBotHotkeyConfig, normalizeRoster, slotAccelerator } from "./bot-roster.mjs";
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

test("macOS keeps Cmd+Shift+3, 4 and 5 for screenshots", () => {
  assert.equal(slotAccelerator(1, "darwin"), "CommandOrControl+Shift+1");
  for (const slot of [3, 4, 5]) assert.equal(slotAccelerator(slot, "darwin"), null);
  assert.equal(slotAccelerator(4, "win32"), "CommandOrControl+Shift+4");
  assert.equal(slotAccelerator(10, "win32"), null);
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

test("the bots' shortcuts follow the setting: a chord remaps them", () => {
  assert.deepEqual(normalizeBotHotkeyConfig(null), { enabled: true, modifier: "cmd-shift" });
  assert.deepEqual(normalizeBotHotkeyConfig({ enabled: false, modifier: "nope" }), { enabled: false, modifier: "cmd-shift" });
  assert.equal(slotAccelerator(1, "darwin", "cmd-alt"), "CommandOrControl+Alt+1");
  assert.equal(slotAccelerator(4, "darwin", "ctrl-alt"), "Control+Alt+4");
  assert.equal(slotAccelerator(4, "darwin", "cmd-shift"), null);
});

