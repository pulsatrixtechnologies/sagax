// Electron side of scripts/verify/dev/verify-nudge.ts. Bob's main window is this app's
// bundled UI on the organization server's origin (electron/bundled-ui.cjs),
// with the preload and its bundled-page bridge, as electron/main.mjs wires
// server mode, and the shell's real window nudger and attention helpers on
// the desktop:nudge and desktop:notify channels. Alice and Carol are other
// clients played with fetch. Notifications are recorded, not shown.
import { app, BrowserWindow, ipcMain, net, session } from "electron";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const bundledUi = require("../../../electron/bundled-ui.cjs");
const { createWindowNudger } = await import("../../../electron/window-nudge.mjs");
const { createDesktopAttention } = await import("../../../electron/desktop-attention.mjs");
const localOrigin = require("../../../electron/local-origin.cjs");

const origin = process.env.VERIFY_ORIGIN;
const bundle = process.env.VERIFY_BUNDLE;
const aliceCookie = process.env.VERIFY_ALICE_COOKIE;
const bobCookie = process.env.VERIFY_BOB_COOKIE;
const bobId = process.env.VERIFY_BOB_ID;
const FAKE_LOCAL = "http://127.0.0.1:1";
const log = (line) => console.log(`[nudge] ${line}`);
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
const as = (cookie) => (pathname, body) => fetch(`${origin}${pathname}`, {
  method: body === undefined ? "GET" : "POST",
  headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json", origin }) },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const asAlice = as(aliceCookie);
const asCarol = as(process.env.VERIFY_CAROL_COOKIE);

// A reverse proxy in front of an organization server closes a long event
// stream now and then (idle or maximum duration). dropStreams() plays that.
const liveStreams = new Set();
async function liveFetch(input, init) {
  const response = await net.fetch(input, init);
  const url = typeof input === "string" ? input : input.url;
  if (!new URL(url).pathname.startsWith("/api/events") || !response.body) return response;
  const reader = response.body.getReader();
  let controller;
  const body = new ReadableStream({
    start(c) { controller = c; liveStreams.add(c); },
    async pull(c) {
      try {
        const { value, done } = await reader.read();
        if (done) { liveStreams.delete(c); c.close(); } else c.enqueue(value);
      } catch (error) { liveStreams.delete(c); try { c.error(error); } catch { /* closed */ } }
    },
    cancel() { liveStreams.delete(controller); void reader.cancel(); },
  });
  return new Response(body, { status: response.status, headers: response.headers });
}
function dropStreams() {
  const count = liveStreams.size;
  for (const c of liveStreams) { try { c.error(new Error("proxy closed the stream")); } catch { /* closed */ } }
  liveStreams.clear();
  return count;
}

app.whenReady().then(async () => {
  localOrigin.setLocalOrigin(FAKE_LOCAL);
  localOrigin.setBundledOrigin(origin);
  session.defaultSession.protocol.handle("http", bundledUi.createBundledUiHandler({
    origin: () => origin, staticDir: () => bundle, devOrigin: () => null,
    fetch: (i, init) => liveFetch(i, init), readFile: (f) => readFile(f),
  }));
  const [name, value] = [bobCookie.slice(0, bobCookie.indexOf("=")), bobCookie.slice(bobCookie.indexOf("=") + 1)];
  await session.defaultSession.cookies.set({ url: origin, name, value, httpOnly: true, sameSite: "lax", path: "/" });

  const win = new BrowserWindow({
    show: true, width: 1100, height: 760,
    webPreferences: {
      preload: path.join(ROOT, "electron", "preload.cjs"),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      additionalArguments: [`--omb-local-origin=${FAKE_LOCAL}`],
    },
  });
  win.webContents.on("console-message", (details) => {
    if (details.level === "error") log(`page error: ${String(details.message).slice(0, 200)}`);
  });
  ipcMain.on("workspace:bundled-ui", (event) => {
    event.returnValue = event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame;
  });
  ipcMain.handle("server-mode:state", () => ({ active: true, name: "Acme", origin }));
  ipcMain.handle("workspaces:state", () => ({ local: false, name: "Acme", origin, serverMode: true }));
  ipcMain.handle("pulsatrix-sign-in:state", () => ({ status: "idle", origin }));
  ipcMain.handle("desktop:capabilities", () => ({
    host: { platform: "other", label: "Fixture", session: "unknown", packaged: false }, windowChrome: "native",
    screenPreview: { available: false, interaction: "none" }, dictation: { available: false, engine: "none", onDevice: false },
    localComputer: { available: false, support: "unsupported", enabled: false, status: "unavailable" },
  }));
  ipcMain.handle("desktop:skin", () => true);
  ipcMain.handle("window:state", () => ({ maximized: false }));
  ipcMain.handle("update:get-state", () => ({ status: "idle" }));
  ipcMain.handle("org-join:staged", () => null);
  ipcMain.handle("org-join:take-preferences", () => null);
  ipcMain.handle("auth-return:take", () => false);
  ipcMain.handle("desktop:system-idle", () => ({ state: "active", idleSeconds: 0 }));
  const unread = [];
  ipcMain.on("desktop:unread-count", (_event, count) => unread.push(count));

  // The shell's real pieces, wired as electron/main.mjs wires them.
  const shown = [];
  class RecordedNotification {
    constructor(options) { this.options = options; this.handlers = {}; shown.push(this); }
    static isSupported() { return true; }
    on(event, fn) { this.handlers[event] = fn; }
    show() {}
  }
  const attention = createDesktopAttention({
    platform: process.platform, app, Notification: RecordedNotification, getWindow: () => win,
    onClick: (id) => win.webContents.send("desktop:notification-click", id),
  });
  const moves = [];
  const realSetBounds = win.setBounds.bind(win);
  win.setBounds = (bounds) => { moves.push(bounds.x); realSetBounds(bounds); };
  const nudger = createWindowNudger(undefined, () => app.focus({ steal: true }), process.platform);
  const nudges = [];
  ipcMain.on("desktop:nudge", (event, options) => {
    if (event.sender !== win.webContents) return;
    nudges.push(options);
    if (options?.role !== "sent") attention.requestAttention({ bounce: "critical", flash: true });
    nudger.nudge(win, { shake: options?.shake !== false });
  });
  ipcMain.on("desktop:notify", (event, request) => {
    if (event.sender !== win.webContents) return;
    attention.notify(request);
  });

  await win.loadURL(`${origin}/`);
  const me = await until("bob's session in the page", async () => {
    const answer = await win.webContents.executeJavaScript("fetch('/api/auth/session').then(r => r.json()).catch(() => null)");
    return answer?.identity === "perspicax" ? answer : null;
  });
  check("bob's window is signed in to the organization server", true, `role ${me.role}`);
  await until("the app", async () => win.webContents.executeJavaScript(`(document.getElementById("root")?.childElementCount ?? 0) > 0`));
  await wait(3000);
  // Watch every sound the page starts, and whether the browser let it play.
  // No click, no key: the page has had no user gesture.
  await win.webContents.executeJavaScript(`(() => {
    window.__plays = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      const entry = { src: this.currentSrc || this.src, result: "pending" };
      window.__plays.push(entry);
      const started = play.call(this);
      Promise.resolve(started).then(() => { entry.result = "playing"; }, (error) => { entry.result = String(error?.name || error); });
      return started;
    };
    true;
  })()`);
  const plays = () => win.webContents.executeJavaScript("window.__plays");
  const nudgeNotes = () => shown.filter((note) => /nudge/i.test(note.options.title));

  // 1. Alice nudges bob while his window is behind another app.
  win.blur();
  const sent = await asAlice("/api/nudges", { principalId: bobId });
  check("alice's nudge is accepted", sent.status === 200, `HTTP ${sent.status}`);
  await until("bob's shell to be asked to shake", async () => nudges.length > 0, 8000).catch(() => null);
  check("bob's window asked the shell to shake", nudges.length === 1 && nudges[0]?.shake === true, JSON.stringify(nudges));
  await wait(1800);
  check("bob's window really moved (the wizz) and came back to where it was", moves.length > 5 && moves.at(-1) === moves[0] - 6, `${moves.length} moves`);
  const played = await until("the nudge sound", async () => (await plays()).find((entry) => entry.result !== "pending") ?? null, 8000).catch(() => null);
  check("bob's window played the nudge sound with no click in the page first", played?.result === "playing" && played.src.endsWith("/nudge.mp3"), JSON.stringify(played));
  check("bob's window came to the front and is a normal window again after the shake", win.isVisible() && !win.isMinimized() && !win.isAlwaysOnTop(), `visible ${win.isVisible()}, top ${win.isAlwaysOnTop()}`);

  // 2. Bob nudges carol (here a raw POST, so it is the server's echo that
  // reaches his window, as on his other computers): his own window shakes
  // and rings too, without a Dock bounce.
  const before = { nudges: nudges.length, plays: (await plays()).length };
  const own = await win.webContents.executeJavaScript(`fetch("/api/nudges", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ principalId: ${JSON.stringify(process.env.VERIFY_CAROL_ID)} }) }).then(r => r.status)`);
  await until("the sender's own shake", async () => nudges.length > before.nudges, 8000).catch(() => null);
  await wait(1500);
  const ownShake = nudges.slice(before.nudges);
  check("the sender's own window shakes and rings too", own === 200 && ownShake.length === 1 && ownShake[0]?.role === "sent" && ownShake[0]?.shake === true && (await plays()).length === before.plays + 1, `HTTP ${own}, ${JSON.stringify(ownShake)}`);

  // 3. Bob minimizes the window; a proxy closes the event stream meanwhile.
  win.minimize();
  await wait(1500);
  const visibility = await win.webContents.executeJavaScript("document.visibilityState");
  const dropped = dropStreams();
  await wait(4000);
  const nudgesBefore = nudges.length;
  const notesBefore = nudgeNotes().length;
  const again = await asCarol("/api/nudges", { principalId: bobId });
  const heardAgain = await until("the next nudge", async () => nudges.length > nudgesBefore, 15000).catch(() => false);
  check("a minimized window whose stream a proxy closed still hears the next nudge (the reported bug)", again.status === 200 && Boolean(heardAgain), `visibility ${visibility}, dropped ${dropped}, streams now ${liveStreams.size}`);
  await wait(300);
  check("the nudge brings the minimized window back", !win.isMinimized() && win.isVisible());
  // the next steps start from a minimized window again
  await wait(1500);
  win.minimize();
  await wait(500);
  const nudgeNote = await until("the nudge notification", async () => nudgeNotes().length > notesBefore ? nudgeNotes().at(-1) : null, 8000).catch(() => null);
  check("the nudge leaves a notification that stays until dismissed", Boolean(nudgeNote) && nudgeNote.options.timeoutType === "never" && /Carol/.test(nudgeNote.options.title), JSON.stringify(nudgeNote?.options ?? null));

  // 4. Alice writes to bob while his window is minimized.
  const opened = await (await asAlice("/api/people-dms", { principalId: bobId })).json();
  const dm = opened.group;
  const notesBeforeDm = shown.length;
  const posted = await asAlice(`/api/groups/${dm.id}/messages`, { text: "are you there?" });
  const dmNote = await until("the message notification", async () => shown.slice(notesBeforeDm).find((note) => note.options.title === "Alice") ?? null, 10000).catch(() => null);
  check("a direct message raises a notification with sound that stays", posted.status === 202 && Boolean(dmNote) && dmNote.options.timeoutType === "never" && dmNote.options.silent === false && dmNote.options.body === "are you there?", JSON.stringify(dmNote?.options ?? null));
  const badge = await until("the unread badge", async () => (unread.at(-1) ?? 0) > 0 ? unread.at(-1) : null, 8000).catch(() => null);
  check("the Dock / taskbar badge counts it", Boolean(badge), `badge ${badge}`);

  // 5. Bob clicks the notification: the window comes back on that conversation, and it is read.
  dmNote?.handlers.click?.();
  const selected = await until("the conversation opened", async () => {
    const current = await win.webContents.executeJavaScript(`document.querySelector('[aria-current="page"]')?.textContent ?? ""`);
    return current.includes("Alice") ? current : null;
  }, 10000).catch(() => null);
  check("a click on the notification opens the conversation", Boolean(selected) && !win.isMinimized(), String(selected));
  // carol's nudge left her own conversation unread: one less, not zero
  const cleared = await until("the badge down by one", async () => unread.at(-1) === badge - 1, 10000).catch(() => false);
  check("reading it takes it off the badge", Boolean(cleared), `${badge} then ${unread.at(-1)}`);
  const aliceView = await (await asAlice("/api/groups")).json();
  check("the conversation stays read on alice's side: the unread was bob's only", aliceView.groups.find((group) => group.id === dm.id)?.unread === false);

  const ok = checks.every(Boolean);
  console.log(`[verify] ${ok ? "PASS" : "FAIL"} (${checks.filter(Boolean).length}/${checks.length})`);
  app.exit(ok ? 0 : 1);
}).catch((error) => {
  console.log(`[verify] FAIL ${error?.stack ?? error}`);
  app.exit(1);
});
