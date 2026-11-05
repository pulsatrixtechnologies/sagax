import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgentCursorOverlay, readCursorPoint } from "./agent-cursor-overlay.mjs";

const PRIMARY = { id: 1, bounds: { x: 0, y: 0, width: 1728, height: 1117 }, scaleFactor: 2 };
const RIGHT = { id: 2, bounds: { x: 1728, y: 0, width: 3008, height: 1692 }, scaleFactor: 1 };
const LEFT = { id: 4, bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 };

function fakeScreen(displays, primaryId = displays[0]?.id) {
  return {
    getAllDisplays: () =>
      displays.map((display) => ({
        ...display,
        bounds: { ...display.bounds },
        scaleFactor: display.scaleFactor ?? 1,
      })),
    getPrimaryDisplay: () => displays.find((display) => display.id === primaryId) ?? displays[0],
  };
}

function fakeBrowserWindow() {
  const created = [];
  class BrowserWindow {
    constructor(options) {
      this.options = options;
      this.bounds = {
        x: options.x,
        y: options.y,
        width: options.width,
        height: options.height,
      };
      this.visible = false;
      this.destroyed = false;
      this.loads = [];
      created.push(this);
    }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    setIgnoreMouseEvents() {}
    setMenuBarVisibility() {}
    loadURL(url) {
      this.loads.push(url);
    }
    setBounds(bounds) {
      this.bounds = { ...bounds };
    }
    isVisible() {
      return this.visible;
    }
    showInactive() {
      this.visible = true;
    }
    hide() {
      this.visible = false;
    }
    destroy() {
      this.destroyed = true;
      this.visible = false;
    }
    isDestroyed() {
      return this.destroyed;
    }
  }
  return { BrowserWindow, created };
}

test("readCursorPoint accepts nested and flat cua responses", () => {
  assert.deepEqual(readCursorPoint({ ok: true, result: { position: { x: 10, y: 20 } } }), { x: 10, y: 20 });
  assert.deepEqual(readCursorPoint({ ok: true, result: { x: 3, y: 4 } }), { x: 3, y: 4 });
  assert.equal(readCursorPoint({ ok: false }), null);
  assert.equal(readCursorPoint({ ok: true, result: { position: { x: "nope", y: 1 } } }), null);
});

test("overlay shows on a secondary display and hides on the primary", async () => {
  const { BrowserWindow, created } = fakeBrowserWindow();
  let point = { x: 3541, y: 508 };
  const overlay = createAgentCursorOverlay({
    BrowserWindow,
    screen: fakeScreen([PRIMARY, RIGHT], PRIMARY.id),
    platform: "darwin",
    pollMs: 60_000,
    request: async () => ({ ok: true, result: { x: point.x, y: point.y } }),
  });

  overlay.sync({ mode: "embedded", socketPath: "/tmp/fixture-cua.sock" });
  await overlay._tick();
  assert.equal(created.length, 1);
  assert.equal(created[0].visible, true);
  assert.equal(created[0].bounds.x, 3541 - 6);
  assert.equal(created[0].bounds.y, 508 - 4);
  assert.match(created[0].loads[0], /^data:text\/html/);

  point = { x: 860, y: 560 };
  await overlay._tick();
  assert.equal(created[0].visible, false);

  overlay.stop();
  assert.equal(created[0].destroyed, true);
});

test("overlay stays off on a single display or non-macOS host", async () => {
  const { BrowserWindow, created } = fakeBrowserWindow();
  const single = createAgentCursorOverlay({
    BrowserWindow,
    screen: fakeScreen([PRIMARY], PRIMARY.id),
    platform: "darwin",
    pollMs: 60_000,
    request: async () => ({ ok: true, result: { x: 10, y: 10 } }),
  });
  single.sync({ mode: "embedded", socketPath: "/tmp/fixture-cua.sock" });
  await single._tick();
  assert.equal(created.length, 0);
  single.stop();

  const win32 = createAgentCursorOverlay({
    BrowserWindow,
    screen: fakeScreen([PRIMARY, RIGHT], PRIMARY.id),
    platform: "win32",
    pollMs: 60_000,
    request: async () => ({ ok: true, result: { x: 3541, y: 508 } }),
  });
  win32.sync({ mode: "embedded", socketPath: "/tmp/fixture-cua.sock" });
  await win32._tick();
  assert.equal(created.length, 0);
  win32.stop();
});

test("overlay tears down when the cua connection drops", async () => {
  const { BrowserWindow, created } = fakeBrowserWindow();
  const overlay = createAgentCursorOverlay({
    BrowserWindow,
    screen: fakeScreen([PRIMARY, RIGHT], PRIMARY.id),
    platform: "darwin",
    pollMs: 60_000,
    request: async () => ({ ok: true, result: { x: 3541, y: 508 } }),
  });
  overlay.sync({ mode: "embedded", socketPath: "/tmp/fixture-cua.sock" });
  await overlay._tick();
  assert.equal(created[0].visible, true);
  overlay.sync({ mode: "unavailable", reason: "stopped" });
  assert.equal(created[0].destroyed, true);
});

test("overlay places in DIP on a negative-origin secondary with mixed scale factors", async () => {
  const { BrowserWindow, created } = fakeBrowserWindow();
  const point = { x: -100, y: 40 };
  const overlay = createAgentCursorOverlay({
    BrowserWindow,
    screen: fakeScreen([PRIMARY, LEFT], PRIMARY.id),
    platform: "darwin",
    pollMs: 60_000,
    request: async () => ({ ok: true, result: point }),
  });
  overlay.sync({ mode: "embedded", socketPath: "/tmp/fixture-cua.sock" });
  await overlay._tick();
  assert.equal(created.length, 1);
  assert.equal(created[0].visible, true);
  assert.equal(created[0].bounds.x, point.x - 6);
  assert.equal(created[0].bounds.y, point.y - 4);
  overlay.stop();
});
