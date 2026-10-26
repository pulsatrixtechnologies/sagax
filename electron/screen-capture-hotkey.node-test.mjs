import assert from "node:assert/strict";
import test from "node:test";
import {
  captureAccelerator,
  capturePermission,
  createCaptureHotkey,
  pickCaptureSource,
  captureThumbnailSize,
  CAPTURE_MAX_EDGE,
} from "./screen-capture-hotkey.mjs";

const shortcuts = () => {
  const held = new Map();
  return {
    held,
    register(accelerator, cb) {
      if (accelerator === "taken") return false;
      held.set(accelerator, cb);
      return true;
    },
    unregister(accelerator) {
      held.delete(accelerator);
    },
  };
};

test("the capture key is the bots' chord with 0 on macOS, one that no common app uses on Windows", () => {
  assert.equal(captureAccelerator("darwin", "cmd-shift"), "CommandOrControl+Shift+0");
  assert.equal(captureAccelerator("darwin", "ctrl-alt"), "Control+Alt+0");
  // Ctrl+Shift+0 unhides columns in Excel: never on Windows
  for (const chord of ["cmd-shift", "cmd-alt", "ctrl-alt", "nope"]) {
    const key = captureAccelerator("win32", chord);
    assert.equal(key, "Control+Alt+Shift+S");
    assert.notEqual(key, "CommandOrControl+Shift+0");
  }
  // Linux has no screen capture without a portal prompt: no key there
  assert.equal(captureAccelerator("linux", "cmd-shift"), null);
});

test("one key, held only while on, given back when off or disposed", () => {
  const globalShortcut = shortcuts();
  let presses = 0;
  const hotkey = createCaptureHotkey({ globalShortcut, onPress: () => { presses += 1; } });
  assert.equal(hotkey.sync("CommandOrControl+Shift+0", true), true);
  assert.equal(hotkey.sync("CommandOrControl+Shift+0", true), true);
  assert.equal(globalShortcut.held.size, 1);
  globalShortcut.held.get("CommandOrControl+Shift+0")();
  assert.equal(presses, 1);
  // a new chord moves the key
  hotkey.sync("Control+Alt+0", true);
  assert.deepEqual([...globalShortcut.held.keys()], ["Control+Alt+0"]);
  hotkey.sync("Control+Alt+0", false);
  assert.equal(globalShortcut.held.size, 0);
  hotkey.sync("Control+Alt+0", true);
  hotkey.dispose();
  assert.equal(globalShortcut.held.size, 0);
  assert.equal(hotkey.accelerator, null);
});

test("a key another app holds is not ours, and is logged once", () => {
  const globalShortcut = shortcuts();
  const lines = [];
  const hotkey = createCaptureHotkey({ globalShortcut, onPress: () => {}, log: (line) => lines.push(line) });
  assert.equal(hotkey.sync("taken", true), false);
  assert.equal(hotkey.accelerator, null);
  assert.equal(lines.length, 1);
  assert.equal(hotkey.sync(null, true), false);
});

test("presses close together make one capture", async () => {
  const globalShortcut = shortcuts();
  let presses = 0;
  let release;
  const hotkey = createCaptureHotkey({ globalShortcut, onPress: () => { presses += 1; return new Promise((resolve) => { release = resolve; }); } });
  hotkey.sync("CommandOrControl+Shift+0", true);
  const press = globalShortcut.held.get("CommandOrControl+Shift+0");
  press();
  press();
  assert.equal(presses, 1);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  press();
  assert.equal(presses, 2);
});

test("the screen under the pointer is the one captured", () => {
  const sources = [{ id: "screen:1", display_id: "1" }, { id: "screen:2", display_id: "2" }];
  assert.equal(pickCaptureSource(sources, 2)?.id, "screen:2");
  assert.equal(pickCaptureSource(sources, 9)?.id, "screen:1");
  assert.equal(pickCaptureSource([], 1), null);
});

test("the picture keeps the display's pixels, bounded", () => {
  assert.deepEqual(captureThumbnailSize({ size: { width: 1512, height: 982 }, scaleFactor: 2 }), { width: 3024, height: 1964 });
  const big = captureThumbnailSize({ size: { width: 6016, height: 3384 }, scaleFactor: 2 });
  assert.ok(Math.max(big.width, big.height) <= CAPTURE_MAX_EDGE);
  assert.deepEqual(captureThumbnailSize(null), { width: 1920, height: 1080 });
});

test("macOS: a refused Screen Recording is said before any capture; the first time asks", () => {
  assert.equal(capturePermission("darwin", () => "granted"), "capture");
  // the first real capture is what makes macOS ask
  assert.equal(capturePermission("darwin", () => "not-determined"), "capture");
  assert.equal(capturePermission("darwin", () => "denied"), "denied");
  assert.equal(capturePermission("darwin", () => "restricted"), "denied");
  assert.equal(capturePermission("darwin", () => { throw new Error("x"); }), "capture");
  assert.equal(capturePermission("win32", () => "denied"), "capture");
});
