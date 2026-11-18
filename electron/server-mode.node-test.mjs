// Server mode in main (electron/main.mjs): the app opens on the organization
// server, Personal (this computer's own space) is a switch away and never a
// sign-out, no other server while it is on, one way out that signs out and
// comes back to this computer, no local server started until Personal is
// opened. The functions run from main's own source in a vm with fakes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const env = require("./environments.cjs");
function sourceText(text) {
  return String(text).replace(/\r\n/g, "\n");
}

const source = sourceText(readFileSync(new URL("./main.mjs", import.meta.url), "utf8"));
const ORG = "https://org.example.test";
const LOCAL = "http://127.0.0.1:48997";

function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `main.mjs section moved: ${start}`);
  return source.slice(from, to);
}

function fixture({ response = 0, packaged = false, serverReady = true, logout = true } = {}) {
  let state = env.withEnvironment({ environments: [], activeId: "local" }, { origin: "https://hosted.example.test" }, () => "h1");
  state = env.withServerMode(env.withEnvironment(state, { origin: ORG, name: "Example", org: true }, () => "o1"), "o1");
  const calls = { navigated: [], persisted: [], fetched: [], cleared: [], closed: 0, relaunched: 0, dialogs: [], forgotten: [], memoryForgotten: [], dropped: [], started: 0 };
  const context = vm.createContext({
    environmentsState: state,
    LOCAL_ID: env.LOCAL_ID,
    serverModeEnvironment: env.serverModeEnvironment,
    withActive: env.withActive,
    withoutServerMode: env.withoutServerMode,
    activeOrigin: () => env.activeEnvironment(context.environmentsState)?.origin ?? LOCAL,
    rendererOrigin: () => LOCAL,
    persistEnvironments: (next) => { calls.persisted.push(next); context.environmentsState = next; },
    navigateMainWindow: (url, options) => calls.navigated.push(options?.account ? `page of ${options.account}` : url),
    mainWindow: { isDestroyed: () => false },
    pageContexts: { drop: (origin) => calls.dropped.push(origin) },
    loadingPage: () => "data:text/html,loading",
    buildErrorPage: () => "data:text/html,error",
    recoveryLanguage: () => "en",
    recoveryIconDataUrl: () => "",
    serverStartConflictOnly: false,
    startServerPackaged: async () => { calls.started++; context.serverReady = true; return true; },
    setLocalOrigin: () => {},
    dialog: { showMessageBox: async (_win, options) => { calls.dialogs.push(options); return { response }; } },
    session: { defaultSession: {
      fetch: async (url, init) => { calls.fetched.push([url, init.method, init.credentials, init.bypassCustomProtocolHandlers]); return { ok: logout, status: logout ? 200 : 500 }; },
      clearStorageData: async (options) => { calls.cleared.push(options.origin); },
    } },
    sharingController: () => ({ forget: (entry) => calls.forgotten.push(entry.id) }),
    orgMemoryCache: () => ({ forgetSource: async (origin) => { calls.memoryForgotten.push(origin); } }),
    floatingBotWindows: { closeAll: () => { calls.closed++; } },
    retroAssistantWindow: { close: () => {} },
    app: { isPackaged: packaged },
    serverReady,
    desktopRemoteAccess: null,
    relaunchAfterDesktopRemoteChange: () => { calls.relaunched++; },
    slog: () => {},
    AbortSignal,
    URL,
  });
  vm.runInContext(`${section("function requireNotServerMode()", "const organizationEntry = createOrganizationEntry(")}
    this.requireNotServerMode = requireNotServerMode; this.switchEnvironment = switchEnvironment; this.leaveServerMode = leaveServerMode;`, context);
  return { context, calls };
}

test("while server mode is on, no other server is switched to or added", async () => {
  const { context, calls } = fixture();
  await context.switchEnvironment("h1");
  assert.deepEqual(calls.persisted, []);
  assert.deepEqual(calls.navigated, []);
  assert.throws(() => context.requireNotServerMode(), /connected to Example/);
});

test("Personal is a switch away from the server: never a sign-out, never a new sign-in, and back again", async () => {
  const { context, calls } = fixture();
  await context.switchEnvironment("local");
  assert.equal(context.environmentsState.activeId, "local");
  assert.equal(context.environmentsState.serverModeId, "o1", "still in server mode");
  assert.equal(context.environmentsState.personal, true, "the app starts this computer's server from now on");
  assert.deepEqual(calls.navigated, [LOCAL]);
  // nothing signed out, nothing cleared, nothing forgotten, no dialog
  assert.deepEqual([calls.fetched, calls.cleared, calls.forgotten, calls.dialogs, calls.dropped], [[], [], [], [], []]);
  await context.switchEnvironment("o1");
  assert.equal(context.environmentsState.activeId, "o1");
  assert.deepEqual(calls.navigated, [LOCAL, ORG]);
  assert.deepEqual([calls.fetched, calls.cleared, calls.dropped], [[], [], []]);
});

test("Personal opened the first time in server mode starts this computer's server, the server's page staying signed in", async () => {
  const { context, calls } = fixture({ packaged: true, serverReady: false });
  await context.switchEnvironment("local");
  assert.equal(calls.started, 1);
  assert.deepEqual(calls.navigated, [`page of ${LOCAL}`, LOCAL], "Personal's page waits on this app's loading page, then shows");
  assert.equal(calls.relaunched, 0, "no restart of the app");
  assert.deepEqual([calls.fetched, calls.cleared, calls.dropped], [[], [], []]);
});

test("leaving asks first; Cancel changes nothing", async () => {
  const { context, calls } = fixture({ response: 1 });
  assert.equal((await context.leaveServerMode()).left, false);
  assert.equal(calls.dialogs.length, 1);
  assert.match(calls.dialogs[0].detail, /nothing on this computer is changed/);
  // Settings > General > Server says Sign out; the confirmation says the same
  assert.equal(calls.dialogs[0].message, "Sign out of Example?");
  assert.deepEqual([...calls.dialogs[0].buttons], ["Sign out", "Cancel"]);
  assert.deepEqual(calls.fetched, []);
  assert.equal(context.environmentsState.serverModeId, "o1");
});

test("leaving signs out of the server, forgets it and its page data, and shows this computer again", async () => {
  const { context, calls } = fixture();
  assert.equal((await context.leaveServerMode()).left, true);
  assert.deepEqual(calls.fetched, [[`${ORG}/api/auth/logout`, "POST", "include", true]], "main signs out itself, past the bundled-UI handler");
  assert.deepEqual(calls.cleared, [ORG]);
  assert.deepEqual(calls.forgotten, ["o1"]);
  assert.deepEqual(calls.memoryForgotten, [ORG], "the memory copy from that server leaves with the person");
  assert.equal(calls.closed, 1, "the server's floating bots go with it");
  assert.equal(context.environmentsState.serverModeId, undefined);
  assert.equal(context.environmentsState.activeId, "local");
  assert.deepEqual(context.environmentsState.environments.map((entry) => entry.id), ["h1"], "only that server is forgotten");
  assert.deepEqual(calls.navigated, [`${LOCAL}/`]);
  assert.deepEqual(calls.dropped, [ORG], "the server's page closes; Personal's stays");
  assert.equal(calls.relaunched, 0);
});

test("a sign-out the server cannot confirm still leaves; a packaged app with no local server restarts to start it", async () => {
  const { context, calls } = fixture({ packaged: true, serverReady: false, logout: false });
  assert.equal((await context.leaveServerMode()).left, true);
  assert.equal(context.environmentsState.serverModeId, undefined);
  assert.equal(calls.relaunched, 1);
  assert.deepEqual(calls.navigated, []);
});

test("a CRLF checkout of main.mjs still matches the server-mode wiring", () => {
  const crlf = source.replace(/\n/g, "\r\n");
  assert.match(sourceText(crlf), /createWindow\(\);\n  void upgradeSavedOrganizationServers\(\)/);
  assert.match(sourceText(crlf), /\} else if \(app\.isPackaged && serverModeEnvironment\(readEnvironments\(\)\) && readEnvironments\(\)\.personal !== true\) \{\n[\s\S]{0,400}?slog\("server mode: the local server is not started"\);\n  \} else if \(app\.isPackaged\) \{\n    (?:const booted = )?await startServerPackaged\(\);/);
});

test("the packaged app starts no local server in server mode until Personal is opened, and the window never falls back to Local", () => {
  assert.match(source, /\} else if \(app\.isPackaged && serverModeEnvironment\(readEnvironments\(\)\) && readEnvironments\(\)\.personal !== true\) \{\n[\s\S]{0,400}?slog\("server mode: the local server is not started"\);\n  \} else if \(app\.isPackaged\) \{\n    (?:const booted = )?await startServerPackaged\(\);/);
  const failLoad = section('contents.on("did-fail-load"', 'contents.on("did-finish-load"');
  assert.ok(failLoad.indexOf("serverModeEnvironment(environmentsState)") < failLoad.indexOf("switchEnvironment(LOCAL_ID)"));
  // the launch screen's join is what turns it on, on a probed organization server
  assert.match(source, /next = options\?\.serverMode === true \? withServerMode\(next, entry\.id\) : withActive\(next, entry\.id\);/);
  assert.match(source, /withEnvironment\(environmentsState, \{ origin, name: new URL\(origin\)\.host, org: true \}/);
  // forgetting the server-mode server is leaving it
  assert.match(section("async function forgetEnvironment(", "function showContextMenu"), /serverModeEnvironment\(environmentsState\)\?\.id === id\) \{\n    await leaveServerMode\(\);/);
});

test("organization sign-in uses the desktop bridge alone for computer access", async () => {
  const state = env.withServerMode(env.withEnvironment({ environments: [], activeId: "local" }, { origin: ORG, org: true }, () => "org"), "org");
  const context = vm.createContext({ serverModeEnvironment: env.serverModeEnvironment, environmentsState: state });
  vm.runInContext(section("async function refreshSharedComputersAllowed()", "/** Refuse a workspace sharing control"), context);
  assert.equal(await context.refreshSharedComputersAllowed(), false);
  assert.match(source, /environments: \(\) => environmentsState\.environments\.filter\(\(env\) => !env\.org\)/);
});

test("main upgrades an old save at launch and reloads a window that already shows that server", () => {
  const upgrade = section("async function upgradeSavedOrganizationServers()", "async function isOrganizationServer(");
  assert.match(upgrade, /isOrganizationServer\(entry\.origin\)/);
  assert.match(upgrade, /\(await localLaunchMode\(\)\) === "server"/);
  assert.match(upgrade, /withOrganizationUpgrade\(environmentsState, \{ orgOrigins, serverModeChosen \}\)/);
  // each upgraded server's open page loads again, on screen or not
  assert.match(upgrade, /const page = pageContexts\?\.contentsFor\(origin\);/);
  assert.match(upgrade, /if \(current\?\.origin === origin\) void page\.loadURL\(current\.href\)/);
  assert.match(source, /createWindow\(\);\n  void upgradeSavedOrganizationServers\(\)/);
});
