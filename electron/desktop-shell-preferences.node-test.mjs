import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DEFAULT_SHELL_PREFERENCES, normalizeShellPreferences, readShellPreferences, writeShellPreferences } from "./desktop-shell-preferences.mjs";

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "shell-prefs-"));
}

test("both choices are on until the person turns one off", () => {
  const dir = tmp();
  try {
    assert.deepEqual(readShellPreferences(dir), DEFAULT_SHELL_PREFERENCES);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a change is merged, kept and read back", () => {
  const dir = tmp();
  try {
    assert.deepEqual(writeShellPreferences(dir, { hardwareAcceleration: false }), { hardwareAcceleration: false, spellcheck: true, botHotkeys: true, botHotkeyModifier: "cmd-shift" });
    assert.deepEqual(writeShellPreferences(dir, { spellcheck: false }), { hardwareAcceleration: false, spellcheck: false, botHotkeys: true, botHotkeyModifier: "cmd-shift" });
    assert.deepEqual(readShellPreferences(dir), { hardwareAcceleration: false, spellcheck: false, botHotkeys: true, botHotkeyModifier: "cmd-shift" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("anything but a boolean for a known name is refused", () => {
  assert.deepEqual(normalizeShellPreferences({ hardwareAcceleration: "no", spellcheck: 1, other: true }), {});
  assert.equal(writeShellPreferences("/nonexistent-never-written", { spellcheck: "x" }), null);
  assert.deepEqual(normalizeShellPreferences(null), {});
});

test("a damaged file reads as the defaults", () => {
  const dir = tmp();
  try {
    fs.writeFileSync(path.join(dir, "desktop-shell-preferences.json"), "{not json");
    assert.deepEqual(readShellPreferences(dir), DEFAULT_SHELL_PREFERENCES);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the bots' shortcut choices are kept: on or off, and a known chord only", () => {
  assert.deepEqual(normalizeShellPreferences({ botHotkeys: false, botHotkeyModifier: "ctrl-alt" }), { botHotkeys: false, botHotkeyModifier: "ctrl-alt" });
  assert.deepEqual(normalizeShellPreferences({ botHotkeys: "no", botHotkeyModifier: "Meta+X" }), {});
});
