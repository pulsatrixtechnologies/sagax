// Electron side of scripts/verify/dev/verify-server-mode.ts. It wires the app's real
// pieces the way electron/main.mjs does in server mode: the bundled-UI
// handler for the organization server's origin, the preload with its
// bundled-page bridge (asked over workspace:bundled-ui), the desktop-UI IPC
// gate, the floating bot windows (drawn from the bundle in their own
// cookie-less session, as when no local server runs) and the loopback
// sign-in return. The "system browser" is played with fetch.
import { app, BrowserWindow, ipcMain, net, screen, session } from "electron";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createFloatingBotWindows, FLOATING_QUERY } from "../../../electron/floating-bot-window.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const signIn = require("../../../electron/oidc-system-sign-in.cjs");
const environments = require("../../../electron/environments.cjs");
const bundledUi = require("../../../electron/bundled-ui.cjs");
const localOrigin = require("../../../electron/local-origin.cjs");

const origin = process.env.VERIFY_ORIGIN;
const bundle = process.env.VERIFY_BUNDLE;
// Development: the UI comes from Vite, as in the dev app (main.mjs DEV_URL).
const devOrigin = process.env.VERIFY_DEV_ORIGIN || null;
const FAKE_LOCAL = "http://127.0.0.1:1";
const log = (line) => console.log(`[server-mode] ${line}`);
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push(ok);
  log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, predicate, ms = 15_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await predicate();
    if (value) return value;
    await wait(150);
  }
  throw new Error(`timed out waiting for ${what}`);
}

// A server saved before organization servers were marked (the owner's
// profile): no org flag, no server mode. main.mjs upgrades it at launch
// (upgradeSavedOrganizationServers); this harness runs the same rule.
let state = environments.withEnvironment({ environments: [], activeId: "local" }, { origin, name: "Example" }, () => "org");
state = environments.withActive(state, "org");
const handoff = signIn.createSignInHandoff();

app.whenReady().then(async () => {
  localOrigin.setLocalOrigin(FAKE_LOCAL);
  let bundled = environments.bundledOrigin(state);
  localOrigin.setBundledOrigin(bundled);
  const scheme = new URL(origin).protocol.slice(0, -1);
  session.defaultSession.protocol.handle(scheme, bundledUi.createBundledUiHandler({
    origin: () => bundled, staticDir: () => (devOrigin ? null : bundle), devOrigin: () => devOrigin,
    fetch: (i, init) => net.fetch(i, init), readFile: (f) => readFile(f),
  }));
  const detached = session.fromPartition("sagax-detached-ui");
  detached.protocol.handle("https", bundledUi.createDetachedUiHandler({
    staticDir: () => bundle, fetch: (i, init) => net.fetch(i, init), readFile: (f) => readFile(f),
  }));

  const win = new BrowserWindow({
    show: false, width: 1200, height: 800,
    webPreferences: {
      preload: path.join(ROOT, "electron", "preload.cjs"),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      additionalArguments: [`--omb-local-origin=${FAKE_LOCAL}`],
    },
  });
  win.webContents.on("console-message", (details) => {
    if (details.level === "error") log(`page error: ${String(details.message).slice(0, 200)}`);
  });

  // The IPC main.mjs answers for this page.
  ipcMain.on("workspace:bundled-ui", (event) => {
    event.returnValue = Boolean(bundled) && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame &&
      new URL(event.senderFrame.url).origin === bundled;
  });
  ipcMain.handle("server-mode:state", localOrigin.desktopUiOnly("server-mode:state", () => ({ active: true, name: "Example", origin })));
  ipcMain.handle("workspaces:state", () => environments.workspaceSummary(state));
  ipcMain.handle("auth-return:take", (event, code) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return false;
    return handoff.redeem(new URL(event.senderFrame.url).origin, code);
  });
  ipcMain.handle("pulsatrix-sign-in:state", () => ({ status: "waiting", origin }));
  ipcMain.handle("desktop:capabilities", () => ({
    host: { platform: "other", label: "Fixture", session: "unknown", packaged: false }, windowChrome: "native",
    screenPreview: { available: false, interaction: "none" }, dictation: { available: false, engine: "none", onDevice: false },
    localComputer: { available: false, support: "unsupported", enabled: false, status: "unavailable" },
  }));
  ipcMain.handle("desktop:skin", () => true);
  ipcMain.handle("window:state", () => ({ maximized: false }));
  ipcMain.handle("update:get-state", () => ({ status: "idle" }));
  ipcMain.handle("org-join:staged", () => null);
  // The launch screen handed this computer's preferences over at join.
  let handedOver = { "omb-skin": "midnight", "omb-language": "fr" };
  ipcMain.handle("org-join:take-preferences", () => { const out = handedOver; handedOver = null; return out; });
  ipcMain.on("desktop:unread-count", () => {});

  // Floating bots: watch what the page sends and what the windows answer.
  const updates = [];
  let focused = 0;
  let floatReady = 0;
  const watchedIpc = {
    handle: (channel, handler) => ipcMain.handle(channel, handler),
    removeHandler: (channel) => ipcMain.removeHandler(channel),
    removeListener: (channel, handler) => ipcMain.removeListener(channel, handler),
    on: (channel, handler) => ipcMain.on(channel, (event, ...args) => {
      if (channel === "floating-bots:update") updates.push(args[0]);
      if (channel === "floating-bots:ready") floatReady++;
      return handler(event, ...args);
    }),
  };
  const floats = createFloatingBotWindows({
    whenReady: () => app.whenReady(), BrowserWindow, screen, ipcMain: watchedIpc,
    getMainWindow: () => win,
    isTrustedMain: (event) => localOrigin.isDesktopUiSender(event),
    pageUrl: () => `${devOrigin ?? bundledUi.DETACHED_UI_ORIGIN}/?${FLOATING_QUERY}`,
    preload: path.join(ROOT, "electron", "floating-bot-preload.cjs"),
    session: () => (devOrigin ? null : detached),
    focusMain: () => { focused++; },
    log: (line) => log(`floating: ${line}`),
  });

  // 0. The bug: an old save shows the server's own page, with no desktop bridge.
  await win.loadURL(`${origin}/pair`);
  await wait(1500);
  const legacy = await win.webContents.executeJavaScript(`({ decoy: document.body.innerText.includes("served by the server"), floating: Boolean(window.ogb?.floatingBots) })`);
  check("before the upgrade, an old save shows the server's own page without floating bots (the reported bug)", legacy.decoy && !legacy.floating);
  // main.mjs at launch: probe, mark, lock server mode (the launch screen said Server), reload.
  const descriptor = await (await fetch(`${origin}/.well-known/openmausbot/environment`)).json();
  state = environments.withOrganizationUpgrade(state, { orgOrigins: new Set(descriptor?.identity?.kind === "perspicax" ? [origin] : []), serverModeChosen: true });
  bundled = environments.bundledOrigin(state);
  localOrigin.setBundledOrigin(bundled);
  check("the upgrade marks the organization server and turns server mode on", bundled === origin && environments.serverModeEnvironment(state)?.origin === origin);

  // 1. Where org-join leaves the window: the server's sign-in page.
  await win.loadURL(`${origin}/pair`);
  await wait(devOrigin ? 4000 : 1500);
  const pairTitle = await win.webContents.executeJavaScript("document.title");
  const pairText = await win.webContents.executeJavaScript("document.body.innerText");
  check("the /pair page is this app's bundle, not the server's page", !/SERVER IMAGE UI/.test(pairTitle) && !/served by the server/.test(pairText), `title "${pairTitle}"`);

  // 2. Sign in with Pulsatrix through the loopback return.
  const loopback = await signIn.startLoopbackReturn({ log: () => {} });
  const start = await fetch(signIn.desktopStartUrl(origin, loopback.returnTo), { redirect: "manual" });
  const binding = start.headers.getSetCookie().find((c) => c.includes("_oidc=")).split(";")[0];
  const authorize = await fetch(start.headers.get("location"), { redirect: "manual" });
  const callback = await fetch(authorize.headers.get("location"), { redirect: "manual", headers: { cookie: binding } });
  const landing = new URL(callback.headers.get("location"));
  await fetch(`${landing.origin}${landing.pathname}`);
  await fetch(`${landing.origin}${landing.pathname}`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: landing.origin },
    body: new URLSearchParams(landing.hash.slice(1)).toString(),
  });
  const outcome = await loopback.result;
  const parsed = { origin, code: outcome.code };
  handoff.accept(parsed);
  await win.loadURL(signIn.authReturnTarget(parsed)).catch(() => {});
  const signed = await until("the session", async () => {
    const answer = await win.webContents.executeJavaScript("fetch('/api/auth/session').then(r => r.json()).catch(() => null)");
    return answer?.identity === "perspicax" ? answer : null;
  });
  check("signed in to the organization server through this app's page", true, `role ${signed.role}`);
  await until("the app home", async () => new URL(win.webContents.getURL()).pathname === "/");
  await wait(2500);

  // 2b. First sign-in: this computer's preferences became the person's, on the server.
  const prefs = await win.webContents.executeJavaScript(`fetch("/api/me/preferences").then(r => r.json()).then(record => ({ record, skin: localStorage.getItem("omb-skin"), language: localStorage.getItem("omb-language") }))`);
  check("this computer's preferences were saved for the person on the server, once, without asking", prefs.record.stored === true && prefs.record.preferences["omb-skin"] === "midnight" && prefs.skin === "midnight" && prefs.language === "fr", JSON.stringify(prefs.record.preferences));
  await win.webContents.executeJavaScript(`localStorage.setItem("omb-font", "serif")`);
  const saved = await until("a changed preference on the server", async () => {
    const record = await win.webContents.executeJavaScript(`fetch("/api/me/preferences").then(r => r.json())`);
    return record.preferences?.["omb-font"] === "serif" ? record : null;
  }).catch(() => null);
  check("a preference changed in the app is saved on the server", Boolean(saved));

  // 3. The UI is this app's own, with the desktop-UI bridge and nothing local.
  const page = await win.webContents.executeJavaScript(`({
    title: document.title,
    decoy: document.body.innerText.includes("served by the server"),
    rendered: (document.getElementById("root")?.childElementCount ?? 0) > 0,
    ogb: Object.keys(window.ogb ?? {}).sort(),
  })`);
  check("the app is this app's bundle on the server's origin", page.rendered && !page.decoy && !/SERVER IMAGE UI/.test(page.title), `title "${page.title}"`);
  for (const key of ["floatingBots", "windowControls", "onOpenAppSettings", "openExternal", "confirm", "updater", "serverMode"]) {
    check(`the page has ${key}`, page.ogb.includes(key));
  }
  for (const key of ["environments", "remoteClient", "setCredential", "pickFolder", "screenFrame", "companion", "exportDiagnostics"]) {
    check(`the page has no ${key}`, !page.ogb.includes(key));
  }
  const serverMode = await win.webContents.executeJavaScript("window.ogb.serverMode.state()");
  check("server mode answers this page", serverMode.active === true && serverMode.origin === origin);
  const subframe = await win.webContents.executeJavaScript(`new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.src = "/assets/../pair";
    frame.onload = () => resolve(Boolean(frame.contentWindow.ogb?.floatingBots));
    document.body.appendChild(frame);
    setTimeout(() => resolve("timeout"), 5000);
  })`);
  check("a subframe on the same origin gets no desktop-UI bridge", subframe === false, String(subframe));

  // 4. A write through the page (the server checks Origin on cookie writes).
  const created = await win.webContents.executeJavaScript(`fetch("/api/bots", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Remote owl", mascotLook: { character: "owl" } }) }).then(async r => ({ status: r.status, body: await r.json() }))`);
  const botId = created.body?.bot?.id ?? created.body?.id;
  check("a bot is created on the server from this app's page", created.status < 300 && typeof botId === "string", `HTTP ${created.status}`);

  // 5. Float it: the mascot's window opens and its state comes from the server.
  await win.webContents.executeJavaScript(`localStorage.setItem("omb.floatingBots.v1", JSON.stringify({ bots: [{ id: ${JSON.stringify(botId)}, top: true }] })); location.reload();`);
  await until("the floating window", async () => floats.list?.().length || updates.some((u) => u?.botId === botId));
  const first = await until("a snapshot for the remote bot", async () => updates.find((u) => u?.botId === botId && u.snapshot));
  check("the page drives a floating window for the server's bot", Boolean(first), `mascot ${JSON.stringify(first.snapshot?.mascot ?? null)}`);
  await until("the floating page", async () => floatReady > 0);
  check("the floating window's page loaded from this app's bundle, in a session with no cookie", floatReady > 0 && (await detached.cookies.get({})).length === 0);
  const before = updates.length;
  const patched = await win.webContents.executeJavaScript(`fetch("/api/bots/" + ${JSON.stringify(botId)}, { method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ mascotLook: { character: "trombi" } }) }).then(r => r.status)`);
  const changed = await until("the new look in a snapshot", async () => updates.slice(before).find((u) => u?.botId === botId && u.snapshot?.mascot?.character === "trombi"), 15_000).catch(() => null);
  check("a change made on the server reaches the mascot", patched < 300 && Boolean(changed), `PATCH ${patched}`);

  // 6. The balloon: words typed at the mascot go to the server as the signed-in person.
  const floatWin = BrowserWindow.getAllWindows().find((candidate) => candidate !== win);
  const threadId = created.body?.bot?.threadId ?? created.body?.threadId;
  await floatWin.webContents.executeJavaScript(`window.floatingBotWindow.send({ type: "send", text: "Hello from the desktop mascot" })`);
  const sent = await until("the balloon's message on the server", async () => {
    const page = await win.webContents.executeJavaScript(`fetch("/api/threads/${threadId}/messages").then(r => r.json()).catch(() => null)`);
    const list = Array.isArray(page) ? page : page?.messages ?? [];
    return list.find((message) => message.role === "user" && String(message.text ?? "").includes("Hello from the desktop mascot")) ?? null;
  }, 15_000).catch(() => null);
  check("a message typed in the mascot's balloon reaches the server as the signed-in person", Boolean(sent) && Boolean(sent.sender?.id), sent ? `sender ${sent.sender?.name ?? sent.sender?.id}` : "none");

  // 7. Double-click (Open in the app): the app comes forward on that bot's thread.
  await floatWin.webContents.executeJavaScript(`window.floatingBotWindow.send({ type: "open" })`);
  const opened = await until("the thread selected in the app", async () => {
    const current = await win.webContents.executeJavaScript(`document.querySelector('[aria-current="page"]')?.textContent ?? ""`);
    return focused > 0 && current.includes("Remote owl") ? current : null;
  }, 10_000).catch(() => null);
  check("opening from the mascot brings the app forward on its thread", Boolean(opened), `focus ${focused}`);

  // 8. The other characters draw too, from the server's look.
  for (const look of [{ character: "shape", shape: "blob" }, { character: "trombi" }, { character: "owl" }]) {
    const mark = updates.length;
    await win.webContents.executeJavaScript(`fetch("/api/bots/" + ${JSON.stringify(botId)}, { method: "PATCH", headers: { "content-type": "application/json" }, body: ${JSON.stringify(JSON.stringify({ mascotLook: look }))} }).then(r => r.status)`);
    const seen = await until(`the ${look.character} look`, async () => updates.slice(mark).find((u) => u?.botId === botId && u.snapshot?.mascot?.character === look.character), 15_000).catch(() => null);
    await wait(800);
    const drawn = await floatWin.webContents.executeJavaScript(`Boolean(document.querySelector("#root svg, #root canvas, #root img"))`);
    check(`the floating window draws the ${look.character}${look.shape ? ` (${look.shape})` : ""}`, Boolean(seen) && drawn);
  }

  // 9. The composer's + menu, Model, then Edit… opens the model picker, a
  // modal, on the server: the person's minimal engine card (what pays,
  // Connect or Disconnect, no payer chain), no local model from the server.
  await until("the composer + menu", async () => win.webContents.executeJavaScript(`Boolean(document.querySelector('[data-composer-plus]'))`), 15_000).catch(() => null);
  const openModelWindow = async () => {
    await win.webContents.executeJavaScript(`document.querySelector('[data-composer-plus]').click(); true`);
    await until("the + menu's Model row", async () => win.webContents.executeJavaScript(`Boolean(document.querySelector('[data-composer-plus-row="model"]'))`), 5_000).catch(() => null);
    await win.webContents.executeJavaScript(`document.querySelector('[data-composer-plus-row="model"]').click(); true`);
    await until("the model menu's Edit…", async () => win.webContents.executeJavaScript(`Boolean(document.querySelector('[data-model-edit]'))`), 5_000).catch(() => null);
    await win.webContents.executeJavaScript(`document.querySelector('[data-model-edit]').click(); true`);
  };
  const shoot = async (name) => {
    if (!process.env.VERIFY_SHOT_DIR) return;
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(process.env.VERIFY_SHOT_DIR, { recursive: true });
    const file = path.join(process.env.VERIFY_SHOT_DIR, name);
    writeFileSync(file, (await win.webContents.capturePage()).toPNG());
    log(`screenshot ${file}`);
  };
  const measure = () => win.webContents.executeJavaScript(`(() => {
    const panel = document.querySelector('[data-model-picker-content]');
    if (!panel) return { found: false };
    const rect = panel.getBoundingClientRect();
    return { found: true, width: Math.round(rect.width), height: Math.round(rect.height), top: Math.round(rect.top), bottom: Math.round(rect.bottom),
      left: Math.round(rect.left), right: Math.round(rect.right), innerWidth, innerHeight, modal: panel.getAttribute('aria-modal'),
      focusInside: panel.contains(document.activeElement), paysWith: panel.querySelector('[data-pays-with]')?.dataset.paysWith ?? null,
      payerRows: panel.querySelectorAll('[data-payer]').length, connect: Boolean(panel.querySelector('[data-engine-connect-button], [data-engine-connected]')),
      localEntry: Boolean(panel.querySelector('[data-model-local-entry]')), localGroup: Boolean(panel.querySelector('[data-model-local-group]')),
      providers: panel.querySelectorAll('[data-model-provider-column] [data-rail-provider]').length };
  })()`);
  win.show();
  await openModelWindow();
  const picker = await until("the model picker", async () => {
    const value = await measure();
    return value.found && value.paysWith ? value : null;
  }, 10_000).catch(measure);
  await wait(600);
  Object.assign(picker, await measure());
  check("the composer's + menu (Model, Edit…) opens a model picker modal inside the window", picker.found && picker.modal === "true" && picker.height > 300 && picker.top >= 0 && picker.bottom <= picker.innerHeight && picker.left >= 0 && picker.right <= picker.innerWidth, JSON.stringify(picker));
  check("the modal takes focus", picker.focusInside === true);
  check("the modal shows one line on what pays and Connect or Disconnect, no payer chain (no server sign-in, even for an admin)", Boolean(picker.paysWith) && picker.connect && picker.payerRows === 0, JSON.stringify({ paysWith: picker.paysWith, connect: picker.connect, payerRows: picker.payerRows }));
  check("no local model from the server's machine", !picker.localEntry && !picker.localGroup);
  await wait(300);
  await shoot("model-picker-server-1200.png");
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  const closed = await until("the picker to close", async () => {
    const state = await win.webContents.executeJavaScript(`({ open: Boolean(document.querySelector('[data-model-picker-content]')), chip: document.activeElement?.hasAttribute?.('data-composer-plus') === true })`);
    return state.open ? null : state;
  }, 5_000).catch(() => null);
  check("Escape closes the modal and gives focus back to the composer's +", Boolean(closed) && closed.chip, JSON.stringify(closed));
  // A narrow window: a bottom sheet.
  win.setSize(390, 760);
  await until("a narrow window", async () => win.webContents.executeJavaScript("innerWidth <= 400"));
  await openModelWindow();
  await wait(600); // the opening animation scales the panel
  const sheet = await until("the sheet", async () => {
    const value = await measure();
    return value.found && value.paysWith ? value : null;
  }, 10_000).catch(measure);
  check("on a narrow window the picker is a sheet along the bottom edge", sheet.found && sheet.left === 0 && sheet.right === sheet.innerWidth && Math.abs(sheet.bottom - sheet.innerHeight) <= 1 && sheet.top > 0, JSON.stringify(sheet));
  await wait(300);
  await shoot("model-picker-server-390.png");
  win.setSize(1200, 800);

  const ok = checks.every(Boolean);
  console.log(`[verify] ${ok ? "PASS" : "FAIL"} (${checks.filter(Boolean).length}/${checks.length})`);
  floats.closeAll();
  app.exit(ok ? 0 : 1);
}).catch((error) => {
  console.log(`[verify] FAIL ${error?.stack ?? error}`);
  app.exit(1);
});
