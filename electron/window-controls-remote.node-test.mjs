import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

// Port of OpenMausBot #3151. A Windows desktop connected to a remote server
// draws its own minimize / maximize / close buttons (titleBarStyle "hidden"),
// so a page from that server needs `windowControls` even when it is not this
// app's bundled UI. The control only reaches the window:* channels, which act
// on the sender's own window.
const require = createRequire(import.meta.url);
const exposed = { api: null };
const invoked = [];
process.argv.push("--omb-local-origin=http://127.0.0.1:1");
globalThis.location = { origin: "https://team.example.test" };
const fakeElectron = {
  ipcRenderer: {
    on: () => undefined, removeListener: () => undefined, send: () => undefined,
    invoke: async (channel) => { invoked.push(channel); },
    sendSync: () => false, // not this app's bundled UI
  },
  contextBridge: { exposeInMainWorld: (_name, api) => { exposed.api = api; } },
  webUtils: { getPathForFile: () => "" },
};
const entry = require.resolve("electron");
require.cache[entry] = { id: entry, filename: entry, loaded: true, exports: fakeElectron };
require("./preload.cjs");

test("a remote server page gets the five window controls and nothing local", async () => {
  const controls = exposed.api.windowControls;
  assert.deepEqual(Object.keys(controls).sort(), ["close", "minimize", "onMaximizedChanged", "state", "toggleMaximize"]);
  await controls.minimize(); await controls.toggleMaximize(); await controls.close(); await controls.state();
  assert.deepEqual(invoked, ["window:minimize", "window:toggle-maximize", "window:close", "window:state"]);
  assert.equal(exposed.api.copyText, undefined);
});
