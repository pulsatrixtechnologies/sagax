// Electron side of scripts/verify/dev/verify-account-switch.ts. It wires the app's real
// pieces the way electron/main.mjs does: the bundled-UI handler for the
// organization server's origin, the preload with its bridge, the sign-in
// return, and either switch:
//
//   reload    the old switch: the window's one page loads the other account
//   contexts  electron/page-contexts.mjs: one page per account, shown again
//
// Each switch is timed from the click to the account's app painted (its
// sidebar's account row in the DOM, the page visible, two frames drawn).
// The window is never on screen: it sits outside every display, never takes
// focus, and its pages are not throttled while hidden (a hidden window would
// otherwise report every page hidden), so a real switch may take a frame or
// two more than measured here.
import { app, BrowserWindow, WebContentsView, ipcMain, net, session } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPageContexts } from "../../../electron/page-contexts.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const signIn = require("../../../electron/oidc-system-sign-in.cjs");
const environments = require("../../../electron/environments.cjs");
const bundledUi = require("../../../electron/bundled-ui.cjs");
const localOrigin = require("../../../electron/local-origin.cjs");

const mode = process.env.VERIFY_MODE === "reload" ? "reload" : "contexts";
const personal = process.env.VERIFY_PERSONAL;
const origin = process.env.VERIFY_ORIGIN;
const bundle = process.env.VERIFY_BUNDLE;
const shotDir = process.env.VERIFY_SHOT_DIR || "";
const ROUNDS = 6;
const log = (line) => console.log(`[switch:${mode}] ${line}`);
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push(ok);
  log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(what, predicate, ms = 20_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await predicate().catch(() => null);
    if (value) return value;
    await wait(100);
  }
  throw new Error(`timed out waiting for ${what}`);
}
const now = () => performance.timeOrigin + performance.now();
// Resolves with the page's clock once the app is painted: the account row of
// the sidebar is there with the account's own bot, the page is visible, and
// two frames went by.
const painted = (botName) => `new Promise((resolve) => {
  const ready = () => document.visibilityState === "visible" && document.querySelector("[data-sidebar-account], [data-sidebar-account-pill]") &&
    (document.querySelector("aside")?.textContent ?? "").includes(${JSON.stringify(botName)});
  const began = performance.timeOrigin + performance.now();
  const done = () => { const seen = performance.timeOrigin + performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => { window.__paintTrace = { began, seen, at: performance.timeOrigin + performance.now() }; resolve(performance.timeOrigin + performance.now()); })); };
  if (ready()) { done(); return; }
  const observer = new MutationObserver(() => { if (ready()) { observer.disconnect(); done(); } });
  observer.observe(document, { subtree: true, childList: true, attributes: true });
  document.addEventListener("visibilitychange", () => { if (ready()) { observer.disconnect(); done(); } }, { once: true });
})`;

// Off every display, a window gets no vsync: frames are made without one
// (a real display adds at most a frame, 16 ms at 60 Hz, per frame waited).
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-gpu-vsync");
app.commandLine.appendSwitch("disable-frame-rate-limit");
const state = (() => {
  let next = environments.withEnvironment({ environments: [], activeId: "local" }, { origin, name: "Example", org: true }, () => "org");
  return next;
})();
const handoff = signIn.createSignInHandoff();

app.whenReady().then(async () => {
  localOrigin.setLocalOrigin(personal);
  localOrigin.setBundledOrigin(origin);
  // The organization server is on the internet: each of its answers takes a
  // round trip (VERIFY_LATENCY_MS, 40 ms by default). Personal is this computer.
  const latency = Number(process.env.VERIFY_LATENCY_MS ?? 40);
  // As main.mjs syncBundledUi: the handler is installed only while the
  // organization server is on screen (it takes the whole scheme).
  const relay = () => bundledUi.createBundledUiHandler({
    origin: () => origin, staticDir: () => bundle, devOrigin: () => null,
    fetch: async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (latency > 0 && url.startsWith(`${origin}/`)) await wait(latency);
      return net.fetch(input, init);
    },
    readFile: (file) => readFile(file),
  });
  const handler = relay();
  let relayOn = false;
  const setRelay = (on) => {
    if (on === relayOn) return;
    if (on) session.defaultSession.protocol.handle("http", handler);
    else session.defaultSession.protocol.unhandle("http");
    relayOn = on;
  };
  setRelay(true);
  const webPreferences = () => ({
    preload: path.join(ROOT, "electron", "preload.cjs"),
    contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false,
    additionalArguments: [`--omb-local-origin=${personal}`],
  });
  const win = new BrowserWindow({
    show: false, x: -30000, y: -30000, width: 1280, height: 820, frame: false, focusable: false, skipTaskbar: true,
    hasShadow: false, enableLargerThanScreen: true, backgroundColor: "#070707", webPreferences: webPreferences(),
  });
  win.showInactive();
  win.setPosition(-30000, -30000);
  const pages = createPageContexts({
    window: () => win,
    createView: () => {
      const view = new WebContentsView({ webPreferences: webPreferences() });
      view.setBackgroundColor("#070707");
      return view;
    },
    onCreated: (contents) => watch(contents),
    log,
  });
  win.on("resize", () => pages.layout());
  function watch(contents) {
    contents.on("console-message", (details) => {
      if (details.level === "error") log(`page error: ${String(details.message).slice(0, 160)}`);
    });
  }
  watch(win.webContents);

  // The IPC main.mjs answers for these pages.
  const pageOf = (event) => (mode === "contexts" ? pages.isPage(event.sender) : event.sender === win.webContents);
  ipcMain.on("workspace:bundled-ui", (event) => {
    let bundled = false;
    try { bundled = pageOf(event) && event.senderFrame === event.sender.mainFrame && new URL(event.senderFrame.url).origin === origin; } catch {}
    event.returnValue = bundled;
  });
  ipcMain.on("desktop-language:get", (event) => { event.returnValue = "en"; });
  ipcMain.on("desktop-shell-preferences:get", (event) => { event.returnValue = null; });
  ipcMain.on("screen:preview-intent", (event) => { event.returnValue = false; });
  ipcMain.handle("server-mode:state", () => ({ active: false }));
  ipcMain.handle("workspaces:state", (event) => {
    const page = new URL(event.senderFrame.url).origin;
    return page === origin ? { local: false, name: "Example", origin } : { local: true, name: "This computer" };
  });
  ipcMain.handle("environments:state", () => ({ localOrigin: personal, remote: false, packaged: true, activeId: "local", environments: state.environments }));
  ipcMain.handle("auth-return:take", (event, code) => {
    log(`auth-return:take asked (page ${pageOf(event)})`);
    if (!pageOf(event) || event.senderFrame !== event.sender.mainFrame) return false;
    const redeemed = handoff.redeem(new URL(event.senderFrame.url).origin, code);
    log(`sign-in return ${redeemed ? "handed to" : "refused for"} ${new URL(event.senderFrame.url).origin}`);
    return redeemed;
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
  ipcMain.handle("org-join:take-preferences", () => null);
  ipcMain.on("desktop:unread-count", () => {});
  ipcMain.handle("desktop:system-idle", () => null);
  ipcMain.handle("update:report-activity", () => null);

  // The two switches under test.
  const BOT = { [personal]: "Solo heron", [origin]: "Org owl" };
  const switchTo = async (target) => {
    const started = now();
    let contents;
    if (mode === "reload") {
      contents = win.webContents;
      await contents.loadURL(target).catch(() => {});
    } else {
      setRelay(target === origin);
      contents = pages.show(target).contents;
    }
    const paintedAt = await Promise.race([contents.executeJavaScript(painted(BOT[target])), wait(30_000).then(() => null)]);
    if (paintedAt === null) {
      const seen = await contents.executeJavaScript(`({ url: location.href, text: document.body.innerText.slice(0, 400), visible: document.visibilityState })`).catch(() => null);
      await shoot(contents, "stuck.png").catch(() => {});
      throw new Error(`the app never painted on ${target}: ${JSON.stringify(seen)}`);
    }
    const trace = await contents.executeJavaScript("window.__paintTrace").catch(() => null);
    if (trace && paintedAt - started > 300) log(`slow switch to ${target}: script began +${Math.round(trace.began - started)} ms, ready +${Math.round(trace.seen - started)} ms, painted +${Math.round(trace.at - started)} ms`);
    return { contents, ms: paintedAt - started };
  };
  const shoot = async (contents, name) => {
    if (!shotDir) return;
    mkdirSync(shotDir, { recursive: true });
    const file = path.join(shotDir, name);
    writeFileSync(file, (await contents.capturePage()).toPNG());
    log(`screenshot ${file}`);
  };

  // 1. Personal opens first: the solo app with its own bot.
  const first = await switchTo(personal);
  await until("Personal's bot", () => first.contents.executeJavaScript(`document.body.innerText.includes("Solo heron")`));
  // One-time prompts of a new account (the terms, the organization's "connect
  // your first model"): answered once, as the person would.
  const agree = (contents, label = "I agree") => contents.executeJavaScript(`new Promise((resolve) => {
    const end = Date.now() + 5000;
    const tick = () => {
      const button = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === ${JSON.stringify(label)});
      if (button) { button.click(); resolve(true); return; }
      if (Date.now() > end) { resolve(false); return; }
      setTimeout(tick, 100);
    };
    tick();
  })`);
  await agree(first.contents);
  check("Personal shows the solo app with its own bot", true, `${Math.round(first.ms)} ms to the first paint`);

  // 2. The organization server: Sign in with Pulsatrix once, through the loopback return.
  setRelay(true);
  const orgPage = mode === "reload" ? win.webContents : pages.show(origin, `${origin}/pair`).contents;
  if (mode === "reload") await orgPage.loadURL(`${origin}/pair`).catch(() => {});
  await until("the organization's sign-in page", () => orgPage.executeJavaScript(`location.pathname === "/pair" && document.readyState === "complete"`));
  const loopback = await signIn.startLoopbackReturn({ log: () => {} });
  const start = await fetch(signIn.desktopStartUrl(origin, loopback.returnTo), { redirect: "manual" });
  const binding = start.headers.getSetCookie().find((cookie) => cookie.includes("_oidc=")).split(";")[0];
  const authorize = await fetch(start.headers.get("location"), { redirect: "manual" });
  const callback = await fetch(authorize.headers.get("location"), { redirect: "manual", headers: { cookie: binding } });
  const landing = new URL(callback.headers.get("location"));
  await fetch(`${landing.origin}${landing.pathname}`);
  await fetch(`${landing.origin}${landing.pathname}`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: landing.origin },
    body: new URLSearchParams(landing.hash.slice(1)).toString(),
  });
  const outcome = await loopback.result;
  log(`loopback outcome: ${Object.keys(outcome ?? {}).join(",")} ${outcome?.error ?? ""}`);
  handoff.accept({ origin, code: outcome.code });
  await orgPage.loadURL(signIn.authReturnTarget({ origin, code: outcome.code })).catch(() => {});
  await until("the organization session", async () => {
    const answer = await orgPage.executeJavaScript("fetch('/api/auth/session').then(r => r.json()).catch(() => null)");
    return answer?.identity === "perspicax" ? answer : null;
  }).catch(async (error) => {
    const seen = await orgPage.executeJavaScript(`({ url: location.href, ogb: Object.keys(window.ogb ?? {}), text: document.body.innerText.slice(0, 120) })`).catch(() => null);
    await shoot(orgPage, "stuck-sign-in.png").catch(() => {});
    throw new Error(`${error.message}: ${JSON.stringify(seen)}`);
  });
  await until("the organization's home", () => orgPage.executeJavaScript(`location.pathname === "/"`));
  // one bot of its own on the organization (both runs share the two servers)
  const created = await orgPage.executeJavaScript(`fetch("/api/bots?messages=0").then(r => r.json()).then(async (list) => {
    const bots = Array.isArray(list) ? list : list.bots ?? [];
    if (bots.some((bot) => bot.name === "Org owl")) return 200;
    return (await fetch("/api/bots", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Org owl" }) })).status;
  })`);
  await orgPage.executeJavaScript(painted("Org owl"));
  await until("the organization's bot", () => orgPage.executeJavaScript(`document.body.innerText.includes("Org owl")`));
  await agree(orgPage);
  await agree(orgPage, "Later");
  check("signed in to the organization server once, and its bot is there", created < 300);

  // 3. Something to keep on each account: an unsent draft in the composer.
  const typeDraft = async (contents, text) => contents.executeJavaScript(`(() => {
    const box = document.querySelector("textarea");
    if (!box) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(box, ${JSON.stringify(text)});
    box.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  const draftOf = (contents) => contents.executeJavaScript(`document.querySelector("textarea")?.value ?? null`);
  await typeDraft(orgPage, "Draft on the organization");
  // A mark that only the same document still has: a reload drops it.
  await orgPage.executeJavaScript(`window.__sameDocument = "org"; true`);
  await shoot(orgPage, "org-before-switch.png");

  // 4. Switch back and forth, timing each switch to the painted app.
  const toPersonal = [];
  const toOrg = [];
  let signedOut = 0;
  let pairPages = 0;
  let personalDraft = null;
  let sameDocument = 0;
  for (let round = 0; round < ROUNDS; round++) {
    const back = await switchTo(personal);
    toPersonal.push(back.ms);
    if (round === 0) {
      await typeDraft(back.contents, "Draft on Personal");
      await back.contents.executeJavaScript(`window.__sameDocument = "personal"; true`);
      await shoot(back.contents, "personal-after-switch.png");
    } else {
      personalDraft = await draftOf(back.contents);
      if (await back.contents.executeJavaScript(`window.__sameDocument === "personal"`)) sameDocument++;
    }
    await wait(300);
    const there = await switchTo(origin);
    toOrg.push(there.ms);
    const where = await there.contents.executeJavaScript(`location.pathname`);
    if (await there.contents.executeJavaScript(`window.__sameDocument === "org"`)) sameDocument++;
    if (where === "/pair") pairPages++;
    const session = await there.contents.executeJavaScript("fetch('/api/auth/session').then(r => r.json()).catch(() => null)");
    if (session?.identity !== "perspicax") signedOut++;
    if (round === ROUNDS - 1) await shoot(there.contents, "org-after-switches.png");
    await wait(300);
  }
  const stats = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return { median: Math.round(median), max: Math.round(sorted.at(-1)), all: values.map((v) => Math.round(v)) };
  };
  const personalStats = stats(toPersonal);
  const orgStats = stats(toOrg);
  log(`switch to Personal: median ${personalStats.median} ms, max ${personalStats.max} ms (${personalStats.all.join(", ")})`);
  log(`switch to the organization: median ${orgStats.median} ms, max ${orgStats.max} ms (${orgStats.all.join(", ")})`);
  console.log(`[switch-result] ${JSON.stringify({ mode, latencyMs: latency, toPersonal: personalStats, toOrg: orgStats, sameDocument })}`);
  check("no switch signed the person out of the organization or showed its sign-in page", signedOut === 0 && pairPages === 0, `${signedOut} signed out, ${pairPages} sign-in pages`);
  const orgContents = mode === "reload" ? win.webContents : pages.contentsFor(origin);
  const orgDraft = await draftOf(orgContents);
  if (mode === "contexts") {
    check("each account keeps its own unsent draft across switches", orgDraft === "Draft on the organization" && personalDraft === "Draft on Personal", JSON.stringify({ orgDraft, personalDraft }));
    check("a switch to the organization paints in under 300 ms", orgStats.max < 300, `${orgStats.max} ms`);
    check("a switch to Personal paints in under 300 ms", personalStats.max < 300, `${personalStats.max} ms`);
    // Isolation: each page stays on its own origin and its own session.
    const personalContents = pages.contentsFor(personal);
    const personalCookies = await session.defaultSession.cookies.get({ url: personal });
    const orgCookies = await session.defaultSession.cookies.get({ url: origin });
    const crossRead = await personalContents.executeJavaScript(`fetch(${JSON.stringify(`${origin}/api/auth/session`)}, { credentials: "include" }).then(r => r.json()).then(j => j.identity ?? null).catch(() => "refused")`);
    check("Personal's page cannot read the organization's session", crossRead !== "perspicax", String(crossRead));
    check("the pages are two origins with their own storage", personalContents.getURL().startsWith(personal) && orgContents.getURL().startsWith(origin), `${personalCookies.length} cookies on Personal, ${orgCookies.length} on the organization`);
    // Signing out of the organization ends that session only.
    const logout = await orgContents.executeJavaScript(`fetch("/api/auth/logout", { method: "POST" }).then(r => r.status)`);
    pages.drop(origin);
    const personalAfter = await personalContents.executeJavaScript(`fetch("/api/bots?messages=0").then(r => r.status)`);
    check("signing out of the organization leaves Personal as it was", logout < 300 && personalAfter === 200 && pages.contentsFor(origin) === null, `logout ${logout}, Personal ${personalAfter}`);
    check("every switch showed the page as it was left (same document, nothing reloaded)", sameDocument === ROUNDS * 2 - 1, `${sameDocument}/${ROUNDS * 2 - 1}`);
  } else {
    check("the old switch reloads the page it shows (the page is a new document every time)", sameDocument === 0, `${sameDocument} kept`);
  }

  const ok = checks.every(Boolean);
  console.log(`[switch:${mode}] ${ok ? "PASS" : "FAIL"} (${checks.filter(Boolean).length}/${checks.length})`);
  pages.reset();
  app.exit(ok ? 0 : 1);
}).catch((error) => {
  console.log(`[switch:${mode}] FAIL ${error?.stack ?? error}`);
  app.exit(1);
});
