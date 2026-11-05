import assert from "node:assert/strict";
import test from "node:test";

import { attachFullscreenPush, setWindowFullScreen, windowFullScreenState } from "./window-fullscreen.mjs";

function fakeWindow() {
  const events = new Map();
  const sent = [];
  return {
    fullscreen: false,
    destroyed: false,
    webContents: { send: (...args) => { sent.push(args); } },
    isDestroyed() { return this.destroyed; },
    isFullScreen() { return this.fullscreen; },
    setFullScreen(on) { this.fullscreen = on === true; },
    on(name, fn) { events.set(name, [...(events.get(name) ?? []), fn]); },
    fire(name) { for (const fn of events.get(name) ?? []) fn(); },
    sent,
    events,
  };
}

test("setWindowFullScreen toggles BrowserWindow.setFullScreen", () => {
  const win = fakeWindow();
  assert.equal(setWindowFullScreen(win, true), true);
  assert.equal(win.fullscreen, true);
  assert.deepEqual(windowFullScreenState(win), { fullscreen: true });
  assert.equal(setWindowFullScreen(win, false), true);
  assert.deepEqual(windowFullScreenState(win), { fullscreen: false });
});

test("setWindowFullScreen refuses a destroyed window", () => {
  const win = fakeWindow();
  win.destroyed = true;
  assert.equal(setWindowFullScreen(win, true), false);
});

test("attachFullscreenPush sends enter/leave-full-screen to the page", () => {
  const win = fakeWindow();
  attachFullscreenPush(win);
  assert.ok(win.events.has("enter-full-screen"));
  assert.ok(win.events.has("leave-full-screen"));
  win.fullscreen = true;
  win.fire("enter-full-screen");
  win.fullscreen = false;
  win.fire("leave-full-screen");
  assert.deepEqual(win.sent, [
    ["window:fullscreen-changed", true],
    ["window:fullscreen-changed", false],
  ]);
});

test("attachFullscreenPush can fan out to every account page", () => {
  const win = fakeWindow();
  const extra = { destroyed: false, isDestroyed() { return this.destroyed; }, sent: [], send(...args) { this.sent.push(args); } };
  attachFullscreenPush(win, () => [win.webContents, extra]);
  win.fullscreen = true;
  win.fire("enter-full-screen");
  assert.deepEqual(win.sent, [["window:fullscreen-changed", true]]);
  assert.deepEqual(extra.sent, [["window:fullscreen-changed", true]]);
});
