import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const exposed = new Map();
const invoked = [];
const listeners = new Map();
const fakeElectron = {
  ipcRenderer: {
    on: (channel, handler) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel).add(handler);
    },
    removeListener: (channel, handler) => { listeners.get(channel)?.delete(handler); },
    invoke: async (...args) => { invoked.push(args); return args[0] === "window:fullscreen-state" ? { fullscreen: false } : true; },
    send: () => undefined,
  },
  contextBridge: {
    exposeInMainWorld: (name, api) => { exposed.set(name, api); },
  },
};
const entry = require.resolve("electron");
require.cache[entry] = { id: entry, filename: entry, loaded: true, exports: fakeElectron };
require("./artifact-window-preload.cjs");

test("artifact window preload exposes always-on-top, fit-to-content and OS fullscreen", async () => {
  assert.deepEqual([...exposed.keys()].sort(), ["artifactWindowSelf", "ogb"]);
  const self = exposed.get("artifactWindowSelf");
  assert.deepEqual(Object.keys(self).sort(), ["fitContent", "isAlwaysOnTop", "setAlwaysOnTop"]);
  assert.equal(await self.isAlwaysOnTop(), true);
  assert.equal(await self.setAlwaysOnTop(true), true);
  assert.equal(await self.fitContent({ width: 640, height: 360 }), true);
  assert.deepEqual(invoked.splice(0), [
    ["artifact-window:get-top"],
    ["artifact-window:set-top", { on: true }],
    ["artifact-window:fit-content", { width: 640, height: 360 }],
  ]);

  const controls = exposed.get("ogb").windowFullscreen;
  assert.deepEqual(Object.keys(controls).sort(), ["onChanged", "set", "state"]);
  await controls.set(true);
  await controls.state();
  assert.deepEqual(invoked, [
    ["window:set-fullscreen", true],
    ["window:fullscreen-state"],
  ]);
  const seen = [];
  const stop = controls.onChanged((fullscreen) => { seen.push(fullscreen); });
  for (const handler of listeners.get("window:fullscreen-changed") ?? []) handler({}, true);
  stop();
  assert.deepEqual(seen, [true]);
});
