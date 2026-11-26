import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

// preload.cjs is renderer-side CommonJS that destructures require("electron")
// at load time. Node tests run without Electron, so satisfy that require from
// the require cache before the bridge module is first loaded — the real
// preload source still executes end to end, only the electron surface is fake.
const require = createRequire(import.meta.url);

const listeners = new Map(); // channel -> Set<handler>
const exposed = { name: null, api: null };
const invocations = [];
const syncCalls = [];
const fakeIpcRenderer = {
  on: (channel, handler) => {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel).add(handler);
  },
  removeListener: (channel, handler) => {
    listeners.get(channel)?.delete(handler);
  },
  invoke: async (...args) => { invocations.push(args); },
  send: () => undefined,
  sendSync: (channel) => {
    syncCalls.push(channel);
    return channel === "desktop-language:get" ? "fr" : undefined;
  },
};
const fakeElectron = {
  ipcRenderer: fakeIpcRenderer,
  contextBridge: {
    exposeInMainWorld: (name, api) => {
      exposed.name = name;
      exposed.api = api;
    },
  },
  webUtils: { getPathForFile: () => "" },
};

const electronEntry = require.resolve("electron");
require.cache[electronEntry] = {
  id: electronEntry,
  filename: electronEntry,
  loaded: true,
  exports: fakeElectron,
};
require("./preload.cjs");

/** Simulate the main process emitting a channel to its subscribers. */
const emit = (channel, ...args) => {
  for (const handler of listeners.get(channel) ?? []) handler({}, ...args);
};
const subscriberCount = (channel) => listeners.get(channel)?.size ?? 0;

test("exposes the full local-shell bridge on window.ogb", () => {
  assert.equal(exposed.name, "ogb");
  assert.equal(typeof exposed.api, "object");
  // The settings channel is local-shell only, so it exists on the bridge
  // exactly when the page is local (no --omb-local-origin in argv here).
  assert.equal(typeof exposed.api.onOpenAppSettings, "function");
});

test("copyText forwards only the text over the explicit clipboard:write-text channel", async () => {
  const before = invocations.length;
  await exposed.api.copyText("hello");
  assert.deepEqual(invocations.slice(before), [["clipboard:write-text", "hello"]]);
  assert.equal("ipcRenderer" in exposed.api, false);
});

test("browser control forwards a separate per-device capability, not the cloud grant", async () => {
  const before = invocations.length;
  await exposed.api.companion.browserControl("phone-1", true);
  await exposed.api.companion.browserControl("phone-1", false);
  assert.deepEqual(invocations.slice(before), [
    ["companion:browser-control", "phone-1", true],
    ["companion:browser-control", "phone-1", false],
  ]);
});

test("onOpenAppSettings subscribes to the exact app:open-settings channel, forwards every emit, and unsubscribes cleanly", () => {
  // Channel contract: electron/main.mjs answers the Preferences… item with
  // webContents.send("app:open-settings"). Listening on any other name would
  // leave the shortcut inert while every menu-construction test still passes,
  // so pin the literal on the receiving side too.
  const cbCalls = [];
  const unsubscribe = exposed.api.onOpenAppSettings(() => cbCalls.push(1));
  assert.equal(subscriberCount("app:open-settings"), 1);

  emit("app:open-settings");
  emit("app:open-settings");
  assert.equal(cbCalls.length, 2);

  unsubscribe();
  assert.equal(subscriberCount("app:open-settings"), 1, "the preload retains its cold-start listener");
  emit("app:open-settings");
  assert.equal(cbCalls.length, 2);
});

test("an organisation action arriving before React subscriptions is delivered exactly once after mount", async () => {
  emit("app:open-settings", "organization");
  const calls = [];
  const unsubscribe = exposed.api.onOpenAppSettings(section => calls.push(["app", section]));
  const unsubscribePanel = exposed.api.onOpenAppSettings(section => calls.push(["panel", section]));
  assert.deepEqual(calls, []);
  await Promise.resolve();
  assert.deepEqual(calls, [["app", "organization"], ["panel", "organization"]]);
  unsubscribe(); unsubscribePanel();
  const late = exposed.api.onOpenAppSettings(section => calls.push(["late", section]));
  await Promise.resolve();
  assert.equal(calls.length, 2, "later subscriptions must not reopen Settings");
  late();
});

test("a transient subscription cannot consume a cold-start action before the actual mount", async () => {
  emit("app:open-settings", "organization");
  const calls = [];
  exposed.api.onOpenAppSettings(section => calls.push(section))();
  await Promise.resolve();
  assert.deepEqual(calls, []);
  const unsubscribe = exposed.api.onOpenAppSettings(section => calls.push(section));
  await Promise.resolve();
  assert.deepEqual(calls, ["organization"]);
  unsubscribe();
});

test("native Settings requests accept only the fixed organisation section", () => {
  const calls = [];
  const unsubscribe = exposed.api.onOpenAppSettings(section => calls.push(section));
  emit("app:open-settings", "organization");
  emit("app:open-settings", "cloud");
  emit("app:open-settings", "cloud-settings");
  emit("app:open-settings", "https://other.example");
  emit("app:open-settings", "cloudAccount");
  emit("app:open-settings", "sagax://cloud");
  emit("app:open-settings", { section: "organization", url: "https://other.example" });
  emit("app:open-settings", ["cloud"]);
  assert.deepEqual(calls, ["organization", undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  unsubscribe();
});

test("an organisation settings request arriving before React subscriptions is delivered exactly once after mount", async () => {
  emit("app:open-settings", "https://other.example");
  emit("app:open-settings", "organization");
  const calls = [];
  const unsubscribe = exposed.api.onOpenAppSettings(section => calls.push(section));
  await Promise.resolve();
  assert.deepEqual(calls, ["organization"]);
  unsubscribe();
  const late = exposed.api.onOpenAppSettings(section => calls.push(section));
  await Promise.resolve();
  assert.deepEqual(calls, ["organization"], "later subscriptions must not reopen Settings");
  late();
});

test("desktopLanguage reads main's choice once, synchronously, and caches what the page sets", async () => {
  const api = exposed.api.desktopLanguage;
  assert.equal(api.get(), "fr");
  assert.equal(api.get(), "fr");
  assert.equal(syncCalls.filter((channel) => channel === "desktop-language:get").length, 1);
  const before = invocations.length;
  await api.set("");
  assert.deepEqual(invocations.slice(before), [["desktop-language:set", ""]]);
  assert.equal(api.get(), "");
  assert.equal(await api.set(3), null);
  assert.equal(invocations.length, before + 1);
});

test("the usage icon's click opens Settings on Usage; a section main never names is dropped", () => {
  const sections = [];
  const unsubscribe = exposed.api.onOpenAppSettings(section => sections.push(section));
  emit("app:open-settings", "usage");
  emit("app:open-settings", "anything-else");
  assert.deepEqual(sections, ["usage", undefined]);
  unsubscribe();
});

test("usageTray hands the page's figures to main and hears main's request for fresh ones", () => {
  const sent = [];
  const send = fakeIpcRenderer.send;
  fakeIpcRenderer.send = (...args) => { sent.push(args); };
  try {
    exposed.api.usageTray.update({ week: 44, session: 20, text: "44 %" });
    assert.deepEqual(sent, [["usage-tray:update", { week: 44, session: 20, text: "44 %" }]]);
  } finally {
    fakeIpcRenderer.send = send;
  }
  let asked = 0;
  const stop = exposed.api.usageTray.onRefresh(() => { asked += 1; });
  emit("usage-tray:refresh");
  assert.equal(asked, 1);
  stop();
  emit("usage-tray:refresh");
  assert.equal(asked, 1);
});
