#!/usr/bin/env node
// Desktop reference capture: the React renderer (src/) exactly as the
// Electron window draws it, at the iPad viewports, against the parity
// fixture server (ios/parity/fixture-server.mjs).
//
//   node ios/parity/desktop/capture-desktop.mjs                 every viewport, every surface, every skin
//   node ios/parity/desktop/capture-desktop.mjs --viewport 1366x1024 --only 'chat|panel'   (surfaces whose name contains a word)
//   node ios/parity/desktop/capture-desktop.mjs --no-skins --no-dom
//   node ios/parity/desktop/capture-desktop.mjs --list          print the surface ids and exit
//   node ios/parity/desktop/capture-desktop.mjs --viewport 1376x1032,1032x1376   any WxH (M-series iPad Pro sizes)
//   node ios/parity/desktop/capture-desktop.mjs --org           the organization pass (or PARITY_ORG=1)
//
// Output (gitignored): ios/parity/desktop/refs/desktop-<W>x<H>-<NN>-<surface>.png
// plus desktop-<W>x<H>-<NN>-<surface>.json (DOM measurements: computed styles
// of every visible box, and the skin's custom properties), and
// refs/index.json (what was captured, what was skipped and why).
//
// How it runs, the way the Electron app would:
// - the fixture server (the real server on a throwaway data dir) is started
//   with PARITY_OUT=ios/parity/desktop/out;
// - the renderer is served by Vite's dev server (`vite`, as `pnpm dev`),
//   whose /api proxy points at the fixture: the renderer reaches its server
//   at its own origin's /api, as in the packaged app (a loopback origin is
//   the owner; no token is involved);
// - headless Chrome (CDP, no dependency) loads it at the viewport size in CSS
//   px = iPad points, deviceScaleFactor 2, with bridge-stub.js standing in
//   for electron/preload.cjs (see that file: only what selects the UI);
// - first-run state is set through the server's own PUT /api/config.
//
// Each capture starts from a fresh page load with its localStorage preset
// (skin, sidebar density), opens its surface through the renderer's store
// (the same actions its buttons dispatch) or real pointer/keyboard events,
// waits for fonts and images, settles animations (finite ones finished,
// infinite ones paused at their first frame) and hides the text caret.
//
// The organization pass (--org or PARITY_ORG=1) starts the fixture with
// PARITY_ORG=1 (an organization server signed in through a stub Perspicax,
// ios/parity/org-fixture.mjs), puts the admin's session cookie in the
// browser, draws the page as the desktop app draws an organization server's
// (the bridge's remote subset: no remoteClient) and captures only the
// surfaces marked `org` in surfaces.mjs. It merges into refs/index.json; a
// full solo run keeps the organization entries, and the other way round.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchChrome, openPage } from "./cdp.mjs";
import { SURFACES, SKIN_IDS, PHASES, NOT_CAPTURED } from "./surfaces.mjs";
import { nameFilter } from "../../../scripts/testing/name-filter.mjs";
import { jsLiteral } from "../../../scripts/testing/js-literal.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const OUT = join(HERE, "out");
const REFS = join(HERE, "refs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const VIEWPORTS = [
  { id: "1366x1024", width: 1366, height: 1024, device: "iPad Pro 13-inch, landscape" },
  { id: "1024x1366", width: 1024, height: 1366, device: "iPad Pro 13-inch, portrait" },
  { id: "1194x834", width: 1194, height: 834, device: "iPad Pro 11-inch, landscape" },
  { id: "834x1194", width: 834, height: 1194, device: "iPad Pro 11-inch, portrait" },
];
const SCALE = 2;

// ── arguments ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const flag = (name) => args.includes(name);
if (flag("-h") || flag("--help")) {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 15).join("\n"));
  process.exit(0);
}
if (flag("--list")) {
  for (const s of SURFACES) console.log(`${s.nn}-${s.id}${s.note ? `   (${s.note})` : ""}`);
  console.log(`skins (main screen): ${SKIN_IDS.join(", ")}`);
  process.exit(0);
}
const viewportFilter = opt("--viewport")?.split(",");
// Words, not a regular expression: names containing any `|`-separated word.
const only = nameFilter(opt("--only"));
const withSkins = !flag("--no-skins");
const withDom = !flag("--no-dom");
const keep = flag("--keep");
const orgMode = flag("--org") || process.env.PARITY_ORG === "1";
// --language fr: every surface in that language (a surface's own wins);
// --skin midnight: every surface in that skin instead of the default one.
const languageArg = opt("--language");
const skinArg = opt("--skin");
// --text: also write the top dialog's text (or the page's) as <file>.txt.
const withText = flag("--text");
// --advanced: the interface in Advanced mode (src/lib/interface-mode.ts).
const advancedMode = flag("--advanced");

const log = (...m) => console.error("[desktop-refs]", ...m);
const PACKAGE = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const RELEASE_VERSION = PACKAGE.forkVersion ?? PACKAGE.version;

// ── processes ───────────────────────────────────────────────────────────
const children = [];
let chrome = null;
async function cleanup() {
  for (const child of children) {
    try { child.kill("SIGTERM"); } catch { /* gone */ }
  }
  chrome?.kill();
  await sleep(300);
}
process.on("SIGINT", async () => { await cleanup(); process.exit(130); });

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function startFixture() {
  mkdirSync(OUT, { recursive: true });
  rmSync(join(OUT, "session.json"), { force: true });
  const proc = spawn(process.execPath, [join(HERE, "..", "fixture-server.mjs")], {
    cwd: ROOT,
    env: { ...process.env, PARITY_OUT: OUT, ...(orgMode ? { PARITY_ORG: "1" } : { PARITY_ORG: "" }) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(proc);
  let err = "";
  proc.stderr.on("data", (c) => { err += c; });
  proc.stdout.on("data", () => {});
  for (let i = 0; i < 360; i++) {
    if (existsSync(join(OUT, "session.json"))) {
      return JSON.parse(readFileSync(join(OUT, "session.json"), "utf8"));
    }
    if (proc.exitCode !== null) throw new Error(`fixture server exited:\n${err.slice(-3000)}`);
    await sleep(500);
  }
  throw new Error(`fixture server never became ready:\n${err.slice(-3000)}`);
}

async function startVite(apiPort) {
  const port = await freePort();
  const proc = spawn(join(ROOT, "node_modules", ".bin", "vite"), ["--strictPort", "--clearScreen", "false"], {
    cwd: ROOT,
    env: { ...process.env, SAGAX_PORT: String(apiPort), SAGAX_UI_PORT: String(port), OMB_PORT: String(apiPort), OMB_UI_PORT: String(port), BROWSER: "none" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(proc);
  let out = "";
  proc.stdout.on("data", (c) => { out += c; });
  proc.stderr.on("data", (c) => { out += c; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(base)).ok) return base; } catch { /* starting */ }
    if (proc.exitCode !== null) throw new Error(`vite exited:\n${out.slice(-3000)}`);
    await sleep(250);
  }
  throw new Error(`vite never answered:\n${out.slice(-3000)}`);
}

/** The organization server takes changes from a signed-in person only. */
function serverHeaders(fixture, server) {
  return fixture.org ? { cookie: `${fixture.org.cookieName}=${fixture.org.cookieValue}`, origin: server } : {};
}

async function putConfig(fixture, patch) {
  const server = fixture.server;
  const res = await fetch(`${server}/api/config`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...serverHeaders(fixture, server) },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`PUT /api/config -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

async function acceptTerms(fixture) {
  const server = fixture.server;
  await fetch(`${server}/api/me/terms`, {
    method: "POST",
    headers: { "content-type": "application/json", ...serverHeaders(fixture, server) },
    body: "{}",
  }).catch(() => undefined);
}

/** On an organization server a person's preferences live on the server and
 * win over the page's (src/lib/user-preferences-sync.ts): make the server's
 * record the capture's preset, so the skin and density are the preset's. */
async function putPreferences(fixture, localStorage) {
  const server = fixture.server;
  const preferences = Object.fromEntries(Object.entries(localStorage).filter(([, value]) => typeof value === "string"));
  let res = await fetch(`${server}/api/me/preferences`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...serverHeaders(fixture, server) },
    body: JSON.stringify({ preferences }),
  });
  // Unknown keys are refused: keep the known ones and say so.
  if (res.status === 400) {
    const known = ["omb-skin", "openmausbot.sidebarDensity", "omb-language", "omb-show-threads"];
    res = await fetch(`${server}/api/me/preferences`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...serverHeaders(fixture, server) },
      body: JSON.stringify({ preferences: Object.fromEntries(Object.entries(preferences).filter(([key]) => known.includes(key))) }),
    });
  }
  if (!res.ok) throw new Error(`PUT /api/me/preferences -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

// ── the page ────────────────────────────────────────────────────────────
const STUB = readFileSync(join(HERE, "bridge-stub.js"), "utf8");
const MEASURE = readFileSync(join(HERE, "measure.js"), "utf8");

/** Helpers a surface's `open(ctx)` uses. Coordinates are CSS px (= points). */
function context(page, viewport, fixture) {
  // The renderer fills some rows after the fleet arrives (the account
  // name, a row's activity line): look again for up to five seconds.
  const center = async (selector) => {
    for (let i = 0; i < 20; i++) {
      const r = await locate(selector);
      if (r && (r.w || r.h)) return r;
      await sleep(250);
    }
    throw new Error(`not found or not visible: ${JSON.stringify(selector)}`);
  };
  const locate = async (selector) => {
    const r = await page.eval(`(() => {
      const el = ${selectorExpr(selector)};
      if (!el) return null;
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
      const b = el.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
    })()`);
    return r;
  };
  const mouse = async (type, x, y, extra = {}) => page.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, pointerType: "mouse", ...extra });
  const ctx = {
    page,
    viewport,
    fixture,
    sleep,
    eval: (expr) => page.eval(expr),
    waitFor: (expr, opts) => page.waitFor(expr, opts),
    dispatch: (action) => page.eval(`__parity.dispatch(${jsLiteral(action)})`),
    /** Evaluate a function body with `s` (state) and `d` (dispatch) in scope. */
    store: (body) => page.eval(`(() => { const s = __parity.state(); const d = __parity.dispatch; ${body} })()`),
    bot: (name) => page.eval(`(__parity.state().bots.find((b) => b.name === ${jsLiteral(name)}) || null)`),
    async selectBot(name) {
      await page.waitFor(`__parity.state()?.bots?.some((b) => b.name === ${jsLiteral(name)})`);
      await page.eval(`(() => { const b = __parity.state().bots.find((x) => x.name === ${jsLiteral(name)}); __parity.dispatch({ type: "select", id: b.id }); })()`);
      await sleep(300);
    },
    async selectGroup(name) {
      await page.waitFor(`__parity.state()?.groups?.some((g) => g.name === ${jsLiteral(name)})`);
      await page.eval(`(() => { const g = __parity.state().groups.find((x) => x.name === ${jsLiteral(name)}); __parity.dispatch({ type: "select", id: g.id }); })()`);
      await sleep(300);
    },
    async click(selector, { button = "left" } = {}) {
      const c = await center(selector);
      await mouse("mouseMoved", c.x, c.y, { button: "none" });
      await mouse("mousePressed", c.x, c.y, { button });
      await mouse("mouseReleased", c.x, c.y, { button });
      await sleep(250);
    },
    async rightClick(selector) {
      const c = await center(selector);
      await mouse("mouseMoved", c.x, c.y, { button: "none" });
      await mouse("mousePressed", c.x, c.y, { button: "right" });
      await mouse("mouseReleased", c.x, c.y, { button: "right" });
      await sleep(300);
    },
    async hover(selector) {
      const c = await center(selector);
      await mouse("mouseMoved", c.x, c.y, { button: "none" });
      ctx.lastPointer = c;
      await sleep(250);
    },
    /** keepPointer: one more move to the resting point, so an element
     * re-rendered under it since (the sidebar after the engines arrive)
     * takes :hover again; headless Chrome does not refresh it on its own. */
    async restPointer() {
      const c = ctx.lastPointer;
      if (!c) return;
      await mouse("mouseMoved", c.x + 1, c.y, { button: "none" });
      await mouse("mouseMoved", c.x, c.y, { button: "none" });
      await sleep(200);
    },
    async moveAway() {
      await mouse("mouseMoved", viewport.width - 2, viewport.height - 2, { button: "none" });
    },
    /** key("k", ["Meta"]) */
    async key(key, modifiers = []) {
      const bits = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };
      const mod = modifiers.reduce((m, k) => m | bits[k], 0);
      const code = key.length === 1 ? (/[a-z]/i.test(key) ? `Key${key.toUpperCase()}` : /\d/.test(key) ? `Digit${key}` : undefined) : key;
      const vk = key.length === 1 ? key.toUpperCase().charCodeAt(0) : { Escape: 27, Enter: 13, Tab: 9, ArrowDown: 40, ArrowUp: 38 }[key];
      const base = { key, code, modifiers: mod, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
      await page.send("Input.dispatchKeyEvent", { type: "keyDown", ...base, ...(key.length === 1 && !mod ? { text: key } : {}) });
      await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
      await sleep(250);
    },
    async type(text) {
      await page.send("Input.insertText", { text });
      await sleep(200);
    },
    async scrollTo(selector, block = "center") {
      await page.eval(`(() => { const el = ${selectorExpr(selector)}; if (!el) throw new Error("not found"); el.scrollIntoView({ block: ${jsLiteral(block)} }); })()`);
      await sleep(300);
    },
    exists: (selector) => page.eval(`Boolean(${selectorExpr(selector)})`),
  };
  return ctx;
}

/** A selector is a CSS string, or { text, tag?, within?, nth? } for the
 * innermost visible element whose whitespace-collapsed text equals `text`
 * (a string) or matches it (a RegExp). */
function selectorExpr(selector) {
  if (typeof selector === "string") return `document.querySelector(${jsLiteral(selector)})`;
  const { text, tag = "button,a,[role=button],[role=tab],[role=menuitem],[role=menuitemradio],[role=option],li,label,span,div,h2,h3", within = "body", nth = 0 } = selector;
  const want = text instanceof RegExp ? text.toString() : JSON.stringify(text);
  return `(() => {
    const want = ${want};
    const root = document.querySelector(${jsLiteral(within)}) || document.body;
    const all = [...root.querySelectorAll(${jsLiteral(tag)})].filter((el) => {
      const t = (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim();
      const b = el.getBoundingClientRect();
      return (want instanceof RegExp ? want.test(t) : t === want) && b.width > 0 && b.height > 0;
    });
    const leaves = all.filter((el) => !all.some((other) => other !== el && el.contains(other)));
    return leaves[${nth}] || null;
  })()`;
}

async function loadApp(page, base, viewport, preset, fixture) {
  if (fixture?.org) {
    // The session "Sign in with Pulsatrix" minted for the admin (the
    // fixture ran the flow): the browser holds it as the page's cookie.
    await page.send("Network.setCookie", { name: fixture.org.cookieName, value: fixture.org.cookieValue, url: `${base}/`, httpOnly: true, sameSite: "Lax" });
    await putPreferences(fixture, preset.localStorage);
  }
  await page.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width, height: viewport.height, deviceScaleFactor: SCALE, mobile: false,
    screenWidth: viewport.width, screenHeight: viewport.height,
  });
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  if (page.stubId) await page.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: page.stubId });
  const { identifier } = await page.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.__PARITY_PRESET__ = ${jsLiteral(preset)};\n${STUB}`,
  });
  page.stubId = identifier;
  page.console.length = 0;
  const loaded = page.once("Page.loadEventFired", 60_000);
  await page.send("Page.navigate", { url: `${base}/` });
  await loaded;
  await page.waitFor(`Boolean(document.querySelector("[data-app-shell]") && window.__parity.store())`, { timeoutMs: 30_000, label: "app shell" }).catch(async (error) => {
    const seen = await page.eval(`(document.body?.innerText ?? "").slice(0, 300)`).catch(() => "?");
    log(`no app shell; page text: ${JSON.stringify(seen)}; console: ${JSON.stringify(page.console.slice(-5))}`);
    throw error;
  });
}

/** Fonts, images and network quiet, then animations settled and caret hidden. */
async function settle(page, extraMs = 0) {
  await page.eval(`document.fonts.ready.then(() => true)`);
  await page.waitFor(`[...document.images].every((img) => img.complete)`, { timeoutMs: 10_000 }).catch(() => {});
  await sleep(900 + extraMs);
  await page.eval(`(() => {
    for (const a of document.getAnimations()) {
      const timing = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : {};
      try {
        if (timing.iterations === Infinity || timing.endTime === Infinity) { a.pause(); a.currentTime = 0; }
        else a.finish();
      } catch { /* detached */ }
    }
    let style = document.getElementById("__parity_caret");
    if (!style) {
      style = document.createElement("style");
      style.id = "__parity_caret";
      // the caret, and the achievement unlock toasts (timed, they land at random)
      style.textContent = "*, *::before, *::after { caret-color: transparent !important; } [data-achievement-toast] { display: none !important; }";
      document.head.appendChild(style);
    }
    return true;
  })()`);
  await page.eval(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`);
}

// ── main ────────────────────────────────────────────────────────────────
async function main() {
  mkdirSync(REFS, { recursive: true });
  log("starting the fixture server");
  const fixture = await startFixture();
  const apiPort = Number(new URL(fixture.endpoint).port);
  log(`fixture ${fixture.endpoint} (server ${fixture.server})${fixture.org ? `, organization server signed in as ${fixture.org.viewer?.name}` : ""}`);
  if (orgMode && !fixture.org) throw new Error("--org: the fixture did not start an organization server");
  const base = await startVite(apiPort);
  log(`renderer ${base}`);
  chrome = await launchChrome();
  const page = await openPage(chrome.port);

  // Any WxH is accepted too, e.g. the M-series iPad Pro sizes
  // (1376x1032, 1032x1376, 1210x834, 834x1210) for capture-ipad.sh --device m5.
  const viewports = viewportFilter
    ? viewportFilter.map((id) => VIEWPORTS.find((v) => v.id === id) ?? (() => {
      const m = /^(\d+)x(\d+)$/.exec(id);
      if (!m) throw new Error(`--viewport ${id}: expected WxH`);
      return { id, width: Number(m[1]), height: Number(m[2]), device: "custom" };
    })())
    : VIEWPORTS;
  const index = { capturedAt: new Date().toISOString(), scale: SCALE, viewports, surfaces: [], skipped: [] };
  const plan = [];
  for (const phase of PHASES) {
    // The organization pass draws only the surfaces that need that server;
    // the solo pass all the others.
    for (const surface of SURFACES.filter((s) => s.phase === phase.id && Boolean(s.org) === orgMode)) {
      const base = skinArg ?? "pulsatrix";
      const variants = surface.skins === "all" && !skinArg ? (withSkins ? SKIN_IDS : [base]) : [base];
      for (const skin of variants) {
        const name = skin === base ? `${surface.nn}-${surface.id}` : `${surface.nn}-${surface.id}-skin-${skin}`;
        if (only && !only(name)) continue;
        plan.push({ phase, surface, skin, name });
      }
    }
  }
  log(`${plan.length} surfaces x ${viewports.length} viewports`);

  // Entries say which fixture drew them when it was not the solo one.
  const fixtureTag = orgMode ? { fixture: "org" } : {};
  let currentPhase = null;
  for (const item of plan) {
    if (item.phase !== currentPhase) {
      currentPhase = item.phase;
      log(`phase: ${currentPhase.id}`);
      if (currentPhase.config) await putConfig(fixture, currentPhase.config);
      // The terms of use (asked once per account, 2026-10-26) are accepted
      // past the first run, as by a person who already uses the app.
      if (currentPhase.id !== "welcome") await acceptTerms(fixture);
    }
    for (const viewport of viewports) {
      const file = `desktop-${viewport.id}-${item.name}`;
      const preset = {
        localStorage: {
          "omb-skin": item.skin,
          "openmausbot.sidebarDensity": item.surface.density ?? "comfortable",
          "omb-language": item.surface.language ?? languageArg ?? "en",
          ...(advancedMode ? { "sagax.interfaceMode.v1": "advanced" } : {}),
          // "What's new" for the running version counts as seen: it would cover the surface.
          "sagax.releaseNotes.seen.v1": JSON.stringify({ version: RELEASE_VERSION }),
          ...item.surface.localStorage,
        },
        // A page the server serves (the bridge's remote subset, without
        // remoteClient): what the desktop app draws for an organization
        // server, and what a browser on any server gets.
        served: orgMode || item.surface.served === true,
      };
      const started = Date.now();
      // One retry: a capture can land on a remount (the store briefly gone).
      for (let attempt = 1; attempt <= 2; attempt++) try {
        await loadApp(page, base, viewport, preset, fixture);
        await page.waitFor(`__parity.state().connected && __parity.state().bots.length >= 14`, { timeoutMs: 20_000, label: "fleet" });
        // The engines (GET /api/instances) arrive after the fleet: until then
        // the composer shows the raw model id and no approval-mode control,
        // and their arrival re-pins the transcript to its end.
        await page.waitFor(`(__parity.state().instances || []).length > 0`, { timeoutMs: 15_000, label: "engines" }).catch(() => {});
        await sleep(300);
        const ctx = context(page, viewport, fixture);
        await ctx.selectBot("Ara");
        const result = await item.surface.open(ctx);
        if (result && result.skip) {
          index.skipped.push({ file, surface: item.name, viewport: viewport.id, ...fixtureTag, reason: result.skip });
          log(`skip ${file}: ${result.skip}`);
          break;
        }
        if (!item.surface.keepPointer) await ctx.moveAway();
        // before settle: the hover's own transitions then finish with the rest
        if (item.surface.keepPointer) await ctx.restPointer();
        await settle(page, item.surface.settleMs ?? 0);
        // a remount between the surface and the shot draws a blank page: retry
        if (!item.surface.noShell && !(await page.eval(`Boolean(document.querySelector("[data-app-shell]") && document.body.innerText.trim().length > 0)`))) {
          throw new Error("blank page at capture time");
        }
        writeFileSync(join(REFS, `${file}.png`), await page.screenshot());
        // --text also shows the end of a scrolled dialog: one more shot
        // (<file>-end.png) when its content runs past the window.
        if (withText) {
          const scrolled = await page.eval(`(() => { let moved = false; const d = [...document.querySelectorAll("[role=dialog]")].pop(); if (!d) return false; for (const el of d.querySelectorAll("*")) { if (el.scrollHeight > el.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(el).overflowY)) { el.scrollTop = el.scrollHeight; moved = true; } } return moved; })()`);
          if (scrolled) { await sleep(400); writeFileSync(join(REFS, `${file}-end.png`), await page.screenshot()); }
        }
        if (withText) {
          const text = await page.eval(`(() => { const d = [...document.querySelectorAll("[role=dialog]")].pop(); return (d ?? document.body).innerText; })()`);
          writeFileSync(join(REFS, `${file}.txt`), `${text}\n`);
        }
        if (withDom) {
          const dom = await page.eval(MEASURE);
          dom.surface = item.name;
          dom.viewport = viewport;
          dom.skin = item.skin;
          writeFileSync(join(REFS, `${file}.json`), `${JSON.stringify(dom)}\n`);
        }
        const errors = page.console.filter((line) => !/Download the React DevTools|\[vite\]/.test(line));
        index.surfaces.push({ file, surface: item.name, viewport: viewport.id, skin: item.skin, note: item.surface.note, ...fixtureTag, ms: Date.now() - started, ...(errors.length ? { console: errors.slice(0, 5) } : {}) });
        log(`${file} (${Date.now() - started} ms)`);
        break;
      } catch (error) {
        if (attempt < 2) { log(`retry ${file}: ${String(error.message ?? error).split("\n")[0]}`); continue; }
        index.skipped.push({ file, surface: item.name, viewport: viewport.id, ...fixtureTag, reason: `error: ${String(error.message ?? error).split("\n")[0]}` });
        log(`FAILED ${file}: ${String(error.message ?? error).split("\n")[0]}`);
      }
    }
  }
  // A filtered run (--only, --viewport, --no-skins) and the organization
  // pass update their own entries in the existing index instead of replacing
  // the whole list. A full solo run replaces the solo entries and keeps the
  // organization pass's (and drops the old solo skips of surfaces that now
  // belong to the organization pass).
  const indexPath = join(REFS, "index.json");
  if (existsSync(indexPath)) {
    const previous = JSON.parse(readFileSync(indexPath, "utf8"));
    const partial = only || viewportFilter || !withSkins || orgMode;
    const redone = new Set([...index.surfaces, ...index.skipped].map((entry) => entry.file));
    const orgSurface = new Set(SURFACES.filter((s) => s.org).map((s) => `${s.nn}-${s.id}`));
    const kept = (entry) => !redone.has(entry.file) && (partial || entry.fixture === "org") &&
      // an older solo skip of an organization surface: the organization pass draws it now
      !(entry.fixture !== "org" && orgSurface.has(entry.surface));
    index.surfaces = [...previous.surfaces.filter(kept), ...index.surfaces].sort((a, b) => a.file.localeCompare(b.file));
    index.skipped = [...previous.skipped.filter(kept), ...index.skipped].sort((a, b) => a.file.localeCompare(b.file));
    if (partial) index.viewports = previous.viewports;
    if (orgMode || previous.orgCapturedAt) index.orgCapturedAt = orgMode ? new Date().toISOString() : previous.orgCapturedAt;
  }
  index.notCaptured = NOT_CAPTURED;
  writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  log(`done: ${index.surfaces.length} captures, ${index.skipped.length} skipped -> ${REFS}`);
  if (keep) {
    log(`--keep: renderer ${base}, Chrome DevTools port ${chrome.port}; Ctrl-C to stop`);
    await new Promise(() => {});
  }
  await page.close();
  await cleanup();
  return index.skipped.some((s) => s.reason.startsWith("error")) ? 1 : 0;
}

main().then((code) => process.exit(code), async (error) => {
  log(error.stack ?? error);
  await cleanup();
  process.exit(1);
});
