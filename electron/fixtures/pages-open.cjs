"use strict";
// Headless end-to-end check of every way a published page, an artifact or a
// widget opens and shows in the desktop app, against a real server
// (scripts/testing/pages-open-ui.e2e.test.ts spawns this inside the real
// Electron). Nothing is ever shown on screen: every window is created
// hidden and rendered offscreen, the dock icon is hidden, and a request for
// full screen is recorded instead of granted.
//
// Two modes, the same checks:
//   direct   the main window loads the server's own page (a local server);
//   bundled  the main window loads the same origin, but every page request
//            is answered from this app's bundle through the bundled UI
//            handler (an organization server), and /api/* and /pages/* are
//            passed through net.fetch, which is where the page frames went
//            blank (0.8.12, 0.8.14).
//
// Checks, per mode (each prints one JSON line: { check, mode, ok, detail }):
//   app              the app draws and the bot is selected
//   chat-card        the page's card in the chat shows the page (its frame
//                    carries the page's own words), never the app
//   chat-panel       a click on the card opens the page over the
//                    conversation: the frame shows the page
//   present          Present asks the page's frame for full screen
//   close-x          the round × closes the panel
//   close-escape     Escape closes it
//   library          the bot panel's Library opens the page the same way
//   own-window       « Open in a window » opens a system window that shows
//                    the page; × closes the window; opened again, Escape
//                    closes it
//   reading-link     « Open in browser » sends the reading link out of the
//                    app (the window open handler), never into a window
//   artifact-window  the Library opens an artifact in its own window; the
//                    widget shows; Full screen draws the layer and asks the
//                    window for full screen; Escape leaves it; × closes
//   plain-window     a window nobody has written yet (no preload, no hook of
//                    its own) loading the page's own-window address shows
//                    the page: the frame watch covers it too
//   ui-source        bundled: the UI came from the bundle, the page from
//                    the server; direct: nothing was intercepted
//
// Arguments: --server=<origin> --dist=<dir> --out=<dir> --bot=<id>
// --page=<id> --page-marker=<text> --artifact=<id> --artifact-title=<text>
// --artifact-marker=<text>
// [--modes=direct,bundled] [--electron-dir=<dir>] [--locales=<dir>]
// `--electron-dir` is where the app's modules are taken from (the
// repository's electron/ by default), so an older checkout can be measured
// with the same fixture; without electron/page-frames.mjs there, the hooks
// are wired the way main.mjs wired them then (main window and artifact
// window only).
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, ipcMain, net, screen, session } = require("electron");

const args = Object.fromEntries(process.argv.slice(1).filter((arg) => arg.startsWith("--")).map((arg) => {
  const eq = arg.indexOf("=");
  return eq < 0 ? [arg.slice(2), "1"] : [arg.slice(2, eq), arg.slice(eq + 1)];
}));
const SERVER = args.server;
const DIST = args.dist;
const OUT = args.out;
const BOT = args.bot;
const PAGE = args.page;
const PAGE_MARKER = args["page-marker"] ?? "";
const ARTIFACT = args.artifact;
const ARTIFACT_MARKER = args["artifact-marker"] ?? "";
const ARTIFACT_TITLE = args["artifact-title"] ?? "";
const MODES = (args.modes ?? "direct,bundled").split(",").filter(Boolean);
const ELECTRON_DIR = path.resolve(args["electron-dir"] ?? path.join(__dirname, ".."));
const LOCALES = path.resolve(args.locales ?? path.join(__dirname, "..", "..", "src", "locales"));
const STEP_MS = Number(args["step-ms"] ?? 15_000);

if (!SERVER || !DIST || !OUT || !BOT || !PAGE || !ARTIFACT) {
  process.stderr.write("pages-open fixture: --server, --dist, --out, --bot, --page and --artifact are required\n");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

// The app's own data never: a throwaway profile for cookies and storage.
app.setPath("userData", mkdtempSync(path.join(tmpdir(), "sagax-pages-open-")));
if (process.platform === "linux") app.commandLine.appendSwitch("no-sandbox");
app.dock?.hide?.();
// between two modes every window is closed: the app must not quit on its own
app.on("window-all-closed", () => {});

const out = (record) => process.stdout.write(`${JSON.stringify(record)}\n`);
const fail = (message) => { throw new Error(message); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Labels in any language the app ships, so a click by text works whatever
 * the language the server or this computer picked. */
function labels(key) {
  const values = new Set();
  for (const file of ["en.json", "fr.json"]) {
    try {
      const value = JSON.parse(readFileSync(path.join(LOCALES, file), "utf8"))[key];
      if (typeof value === "string") values.add(value);
    } catch {
      // a missing locale: the other one still counts
    }
  }
  return [...values];
}
const PRESENT = labels("pages.present");
const OPEN_WINDOW = labels("pages.openWindow");
const SKIP_TOUR = [...labels("onboarding.tour.skip"), ...labels("onboarding.skipTour")];
const ACCEPT_TERMS = labels("moderation.terms.accept");
const OPEN_ARTIFACT = labels("artifacts.openAria").map((label) => label.replace("{title}", ARTIFACT_TITLE));

// ── modules of the app under test ──
const bundledUiModule = require(path.join(ELECTRON_DIR, "bundled-ui.cjs"));
const localOrigin = require(path.join(ELECTRON_DIR, "local-origin.cjs"));
const importModule = (name) => import(pathToFileURL(path.join(ELECTRON_DIR, name)).href);

/** Every window hidden and offscreen; show and focus never do anything. */
class HiddenWindow extends BrowserWindow {
  static created = [];
  constructor(options = {}) {
    super({ ...options, show: false, webPreferences: { ...options.webPreferences, offscreen: true } });
    HiddenWindow.created.push(this);
  }
  show() {}
  showInactive() {}
  focus() {}
}

/** Poll an expression in a frame until it is truthy. */
async function waitFor(frame, expression, what, timeout = STEP_MS) {
  const deadline = Date.now() + timeout;
  let last;
  for (;;) {
    try {
      last = await frame.executeJavaScript(expression, true);
      if (last) return last;
    } catch (error) {
      last = `error: ${error?.message ?? error}`;
    }
    if (Date.now() > deadline) fail(`${what}: not within ${timeout} ms (last: ${JSON.stringify(last)})`);
    await sleep(100);
  }
}

async function waitGone(frame, expression, what, timeout = STEP_MS) {
  const deadline = Date.now() + timeout;
  for (;;) {
    let value = null;
    try {
      value = await frame.executeJavaScript(expression, true);
    } catch {
      value = null;
    }
    if (!value) return;
    if (Date.now() > deadline) fail(`${what}: still there after ${timeout} ms`);
    await sleep(100);
  }
}

const q = (selector) => JSON.stringify(selector);
const clickJs = (selector) => `(() => { const el = document.querySelector(${q(selector)}); if (!el || el.disabled) return false; el.click(); return true; })()`;
const clickByTextJs = (texts, within = "body") => `(() => {
  const wanted = ${JSON.stringify(texts)};
  const root = document.querySelector(${q(within)}) ?? document.body;
  const el = [...root.querySelectorAll("button, [role=menuitem], a")].find((node) => {
    const text = (node.textContent || "").replace(/\\s+/g, " ").trim();
    const label = (node.getAttribute("aria-label") || "").trim();
    return wanted.includes(text) || wanted.includes(label);
  });
  if (!el) return false;
  el.click();
  return true;
})()`;

/** Record a request for full screen instead of granting it: no window may
 * ever appear on this computer. */
const FULLSCREEN_STUB = `(() => {
  if (window.__fullscreen) return true;
  window.__fullscreen = [];
  const name = (el) => el.hasAttribute("data-page-viewer-frame") ? "page-frame" : el === document.documentElement ? "document" : el.tagName.toLowerCase();
  Element.prototype.requestFullscreen = function () { window.__fullscreen.push(name(this)); return Promise.resolve(); };
  Document.prototype.exitFullscreen = function () { return Promise.resolve(); };
  return true;
})()`;

/** The subframes of a window's page that are a published page's frame for
 * this page id, with what they show. The wrapper (/pages/preview/...) and the
 * page itself (/pages/preview-frame/...) are both counted. */
async function pageFrames(contents, pageId) {
  const found = { wrappers: [], frames: [] };
  for (const frame of contents.mainFrame.framesInSubtree) {
    if (frame === contents.mainFrame) continue;
    const url = frame.url;
    if (url.includes(`/pages/preview/${pageId}/`)) found.wrappers.push(url);
    if (url.includes(`/pages/preview-frame/${pageId}/`)) {
      let text = "";
      try {
        text = String(await frame.executeJavaScript("document.body ? document.body.innerText : ''", true));
      } catch (error) {
        text = `error: ${error?.message ?? error}`;
      }
      found.frames.push({ url, text });
    }
  }
  return found;
}

/** The page shows in this window: `count` wrapper frames, each with its
 * page frame that carries the page's words; and no frame draws the app. */
async function expectPageShown(contents, pageId, count, what) {
  const deadline = Date.now() + STEP_MS;
  let last = null;
  for (;;) {
    last = await pageFrames(contents, pageId);
    const shown = last.frames.filter((frame) => frame.text.includes(PAGE_MARKER));
    if (last.wrappers.length >= count && shown.length >= count) break;
    if (Date.now() > deadline) fail(`${what}: expected ${count} page frame(s) showing ${JSON.stringify(PAGE_MARKER)}; got ${JSON.stringify(last)}`);
    await sleep(150);
  }
  for (const frame of contents.mainFrame.framesInSubtree) {
    if (frame === contents.mainFrame) continue;
    let app = false;
    try {
      app = await frame.executeJavaScript("Boolean(document.getElementById('root') || document.querySelector('[data-sidebar-bot-row]'))", true);
    } catch {
      app = false;
    }
    if (app) fail(`${what}: a frame (${frame.url}) drew the app instead of the page`);
  }
  return last;
}

async function capture(win, name) {
  try {
    const image = await win.webContents.capturePage();
    writeFileSync(path.join(OUT, `${name}.png`), image.toPNG());
  } catch (error) {
    out({ capture: name, error: String(error?.message ?? error) });
  }
}

function windowOf(artifactWindows, id) {
  return HiddenWindow.created.find((win) => !win.isDestroyed() && artifactWindows.entries().some((entry) => entry.artifactId === id) && win.webContents.getURL().includes(`artifact=${encodeURIComponent(id)}`))
    ?? HiddenWindow.created.find((win) => !win.isDestroyed() && win.webContents.getURL().includes(`artifact=${encodeURIComponent(id)}`));
}

async function waitWindow(artifactWindows, id, what) {
  const deadline = Date.now() + STEP_MS;
  for (;;) {
    const win = windowOf(artifactWindows, id);
    if (win) return win;
    if (Date.now() > deadline) fail(`${what}: no window for ${id} within ${STEP_MS} ms (open: ${JSON.stringify(artifactWindows.entries())})`);
    await sleep(100);
  }
}

function closed(win) {
  return new Promise((resolve) => {
    if (win.isDestroyed()) return resolve();
    win.once("closed", () => resolve());
  });
}

async function pressEscape(contents) {
  contents.focus();
  contents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  contents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
}

/** Escape through the real input path; if the hidden window does not take
 * keys, the same key as an event on the window (what the handler reads). */
async function escapeUntilGone(contents, goneExpression, what) {
  await pressEscape(contents);
  try {
    await waitGone(contents, goneExpression, what, 2_500);
    return "input";
  } catch {
    await contents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); true`, true);
    await waitGone(contents, goneExpression, what);
    return "event";
  }
}

async function runMode(mode, modules) {
  const results = [];
  const check = async (name, work) => {
    try {
      const detail = await work();
      results.push({ check: name, mode, ok: true, ...(detail ? { detail } : {}) });
    } catch (error) {
      results.push({ check: name, mode, ok: false, detail: String(error?.message ?? error) });
    }
    out(results.at(-1));
  };

  const bundled = mode === "bundled";
  const served = { bundle: 0, passed: 0 };
  // ── the bundled UI handler (an organization server) ──
  const pageFrames = bundledUiModule.createPageFrameLoads();
  if (bundled) {
    const handler = bundledUiModule.createBundledUiHandler({
      origin: () => [SERVER],
      staticDir: () => DIST,
      fetch: (input, init) => { served.passed += 1; return net.fetch(input, init); },
      readFile: async (file) => { served.bundle += 1; return readFileSync(file); },
      pageFrames,
      log: (line) => out({ log: line }),
    });
    session.defaultSession.protocol.handle(new URL(SERVER).protocol.slice(0, -1), handler);
    localOrigin.setBundledOrigin(SERVER);
    localOrigin.setLocalOrigin("http://127.0.0.1:1");
  } else {
    localOrigin.setBundledOrigin(null);
    localOrigin.setLocalOrigin(SERVER);
  }
  // the preload asks main these synchronously at load: a harness must answer
  const sync = { "workspace:bundled-ui": bundled, "desktop-language:get": null, "desktop-shell-preferences:get": null, "screen:preview-intent": false };
  const syncListeners = Object.entries(sync).map(([channel, value]) => {
    const listener = (event) => { event.returnValue = value; };
    ipcMain.on(channel, listener);
    return () => ipcMain.removeListener(channel, listener);
  });
  // the window controls ask their window's state on load; every other
  // desktop call is left unanswered, as the page copes with a desktop that
  // has none of those (a null answer where an object is expected would not)
  const invoked = { "window:state": { maximized: false } };
  for (const [channel, value] of Object.entries(invoked)) ipcMain.handle(channel, () => value);
  syncListeners.push(() => { for (const channel of Object.keys(invoked)) ipcMain.removeHandler(channel); });

  const opened = [];
  let mainWindow = null;
  const artifactWindows = modules.createArtifactWindows({
    BrowserWindow: HiddenWindow,
    ipcMain,
    getMainWindow: () => mainWindow,
    isTrustedMain: (event) => localOrigin.isDesktopUiSender(event),
    openExternal: (url) => opened.push(url),
    screen,
    boundsStore: { read: () => null, write: () => {} },
    log: (line) => out({ log: line }),
    // an older checkout: the artifact window hooked its own page frames
    ...(modules.legacy ? {
      blockFrame: modules.blockPageFrameNavigation,
      expectFrame: (url) => pageFrames.expect(url),
    } : {}),
  });
  let stopWatch = () => {};
  if (!modules.legacy) {
    stopWatch = modules.installPageFrameWatch(app, { block: modules.blockPageFrameNavigation, expect: (url) => pageFrames.expect(url), log: (line) => out({ log: line }) });
  }

  mainWindow = new HiddenWindow({
    width: 1280, height: 860,
    webPreferences: {
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      preload: path.join(ELECTRON_DIR, "preload.cjs"),
      additionalArguments: [`--omb-local-origin=${bundled ? "http://127.0.0.1:1" : SERVER}`],
    },
  });
  const main = mainWindow.webContents;
  if (modules.legacy) {
    // the main window hooked its own page frames (main.mjs before page-frames.mjs)
    main.on("will-frame-navigate", (details) => {
      if (details.isMainFrame) return;
      if (modules.blockPageFrameNavigation(details)) { details.preventDefault(); return; }
      if (bundledUiModule.isPageFrameUrl(details.url)) pageFrames.expect(details.url);
    });
  }
  main.setWindowOpenHandler(({ url }) => { opened.push(url); return { action: "deny" }; });
  main.on("console-message", (details) => {
    const level = details.level ?? "info";
    if (level === "error") out({ console: details.message, mode });
  });
  main.on("will-navigate", (event, url) => { if (!url.startsWith(SERVER)) event.preventDefault(); });

  try {
    await check("app", async () => {
      await mainWindow.loadURL(`${SERVER}/`);
      await mainWindow.webContents.executeJavaScript(FULLSCREEN_STUB, true);
      await waitFor(main, `Boolean(document.querySelector(${q(`[data-sidebar-bot-row="${BOT}"]`)}))`, "the bot in the sidebar", 30_000);
      await main.executeJavaScript(clickJs(`[data-sidebar-bot-row="${BOT}"]`), true);
      await waitFor(main, `Boolean(document.querySelector("main [data-bot-header-pill]"))`, "the bot's conversation");
      // a first start offers the tour and the terms over the conversation: not today
      await sleep(500);
      await main.executeJavaScript(clickByTextJs(SKIP_TOUR), true);
      await sleep(300);
      await main.executeJavaScript(clickByTextJs(ACCEPT_TERMS), true);
      return bundled ? `bundle files served: ${served.bundle}` : "the server's own page";
    });

    await check("chat-card", async () => {
      await waitFor(main, `Boolean(document.querySelector(${q(`[data-page-card="${PAGE}"]`)}))`, "the page's card");
      await expectPageShown(main, PAGE, 1, "the card's thumbnail");
      await capture(mainWindow, `${mode}-chat-card`);
    });

    const openPanel = async () => {
      await waitFor(main, `(() => { const b = document.querySelector(${q(`[data-page-card="${PAGE}"] [data-page-open]`)}); return Boolean(b && !b.disabled); })()`, "the card's Open");
      await main.executeJavaScript(clickJs(`[data-page-card="${PAGE}"] [data-page-open]`), true);
      await waitFor(main, `Boolean(document.querySelector(${q(`[data-page-panel="${PAGE}"] [data-page-viewer-frame]`)}))`, "the page panel");
      await expectPageShown(main, PAGE, 2, "the page over the conversation");
    };
    await check("chat-panel", async () => {
      await openPanel();
      await capture(mainWindow, `${mode}-chat-panel`);
    });

    await check("present", async () => {
      await main.executeJavaScript(FULLSCREEN_STUB, true);
      await main.executeJavaScript(clickJs(`[data-page-panel="${PAGE}"] button[data-page-more]`), true);
      await waitFor(main, `Boolean(document.querySelector("[role=menu] [role=menuitem]"))`, "the page's menu");
      if (!await main.executeJavaScript(clickByTextJs(PRESENT, "[role=menu]"), true)) fail(`no ${PRESENT.join(" / ")} in the menu`);
      const asked = await waitFor(main, `window.__fullscreen.includes("page-frame") ? window.__fullscreen.join(",") : ""`, "the page frame asked for full screen", 5_000);
      return asked;
    });

    await check("close-x", async () => {
      await main.executeJavaScript(clickJs(`[data-page-panel="${PAGE}"] [data-page-close]`), true);
      await waitGone(main, `Boolean(document.querySelector(${q(`[data-page-panel="${PAGE}"]`)}))`, "the panel after ×");
    });

    await check("close-escape", async () => {
      await openPanel();
      const how = await escapeUntilGone(main, `Boolean(document.querySelector(${q(`[data-page-panel="${PAGE}"]`)}))`, "the panel after Escape");
      return `escape via ${how}`;
    });

    const openLibrary = async () => {
      const expanded = await main.executeJavaScript(`document.querySelector("main [data-bot-header-pill]")?.getAttribute("aria-expanded")`, true);
      if (expanded !== "true") await main.executeJavaScript(clickJs("main [data-bot-header-pill]"), true);
      await waitFor(main, `Boolean(document.querySelector('[data-panel-tab="library"]'))`, "the bot panel");
      await main.executeJavaScript(clickJs('[data-panel-tab="library"]'), true);
    };
    await check("library", async () => {
      await openLibrary();
      await waitFor(main, `Boolean(document.querySelector(${q(`[data-library-page="${PAGE}"] [data-page-open]`)}))`, "the page in the Library");
      await main.executeJavaScript(clickJs(`[data-library-page="${PAGE}"] [data-page-open]`), true);
      await waitFor(main, `Boolean(document.querySelector(${q(`[data-page-panel="${PAGE}"] [data-page-viewer-frame]`)}))`, "the page panel from the Library");
      await expectPageShown(main, PAGE, 2, "the page opened from the Library");
      await capture(mainWindow, `${mode}-library`);
      await main.executeJavaScript(clickJs(`[data-page-panel="${PAGE}"] [data-page-close]`), true);
      await waitGone(main, `Boolean(document.querySelector(${q(`[data-page-panel="${PAGE}"]`)}))`, "the panel after ×");
    });

    const pageWindowId = `page:${PAGE}`;
    const openOwnWindow = async () => {
      await openPanel();
      await main.executeJavaScript(clickJs(`[data-page-panel="${PAGE}"] button[data-page-more]`), true);
      await waitFor(main, `Boolean(document.querySelector("[role=menu] [role=menuitem]"))`, "the page's menu");
      if (!await main.executeJavaScript(clickByTextJs(OPEN_WINDOW, "[role=menu]"), true)) fail(`no ${OPEN_WINDOW.join(" / ")} in the menu`);
      const win = await waitWindow(artifactWindows, pageWindowId, "the page's own window");
      const contents = win.webContents;
      await waitFor(contents, `Boolean(document.querySelector(${q(`[data-page-standalone="${PAGE}"] [data-page-viewer-frame]`)}))`, "the page in its window", 30_000);
      await expectPageShown(contents, PAGE, 1, "the page in its own window");
      const app = await contents.executeJavaScript(`Boolean(document.querySelector("[data-sidebar-bot-row]"))`, true);
      if (app) fail("the page's window drew the app");
      return win;
    };
    await check("own-window", async () => {
      const win = await openOwnWindow();
      await sleep(800);
      await capture(win, `${mode}-own-window`);
      await win.webContents.executeJavaScript(clickJs("[data-page-close]"), true);
      await Promise.race([closed(win), sleep(STEP_MS).then(() => fail("× did not close the page's window"))]);
      // the main page is told, and the panel it was opened from stays usable
      await main.executeJavaScript(clickJs(`[data-page-panel="${PAGE}"] [data-page-close]`), true);
      await waitGone(main, `Boolean(document.querySelector(${q(`[data-page-panel="${PAGE}"]`)}))`, "the panel after ×");
      const again = await openOwnWindow();
      const how = await (async () => {
        await pressEscape(again.webContents);
        try {
          await Promise.race([closed(again), sleep(2_500).then(() => fail("x"))]);
          return "input";
        } catch {
          await again.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); true`, true);
          await Promise.race([closed(again), sleep(STEP_MS).then(() => fail("Escape did not close the page's window"))]);
          return "event";
        }
      })();
      await main.executeJavaScript(clickJs(`[data-page-panel="${PAGE}"] [data-page-close]`), true);
      await waitGone(main, `Boolean(document.querySelector(${q(`[data-page-panel="${PAGE}"]`)}))`, "the panel after ×");
      return `escape via ${how}`;
    });

    await check("reading-link", async () => {
      opened.length = 0;
      const before = HiddenWindow.created.length;
      await openPanel();
      await main.executeJavaScript(clickJs(`[data-page-panel="${PAGE}"] [data-page-share]`), true);
      await waitFor(main, `Boolean(document.querySelector("[data-page-open-browser]"))`, "the Share popover");
      await main.executeJavaScript(clickJs("[data-page-open-browser]"), true);
      const link = await (async () => {
        const deadline = Date.now() + 5_000;
        while (Date.now() < deadline) {
          const hit = opened.find((url) => url.includes("/pages/view/"));
          if (hit) return hit;
          await sleep(100);
        }
        fail(`the reading link never left the app (opened: ${JSON.stringify(opened)})`);
      })();
      if (HiddenWindow.created.length !== before) fail("a window opened for the reading link");
      await main.executeJavaScript(clickJs(`[data-page-panel="${PAGE}"] [data-page-close]`), true);
      await waitGone(main, `Boolean(document.querySelector(${q(`[data-page-panel="${PAGE}"]`)}))`, "the panel after ×");
      return link.replace(SERVER, "");
    });

    await check("artifact-window", async () => {
      await openLibrary();
      const row = `[data-artifact-row="${ARTIFACT}"]`;
      await waitFor(main, `Boolean(document.querySelector(${q(row)}))`, "the artifact in the Library");
      if (!await main.executeJavaScript(clickByTextJs(OPEN_ARTIFACT, row), true)) fail(`no ${OPEN_ARTIFACT.join(" / ")} on the artifact's row`);
      const win = await waitWindow(artifactWindows, ARTIFACT, "the artifact's own window");
      const contents = win.webContents;
      await waitFor(contents, `Boolean(document.querySelector(${q(`[data-artifact-window="${ARTIFACT}"] iframe`)}))`, "the artifact's frame", 30_000);
      await contents.executeJavaScript(FULLSCREEN_STUB, true);
      // the widget's own document (a srcdoc frame) carries the bot's words
      const deadline = Date.now() + STEP_MS;
      let texts = [];
      for (;;) {
        texts = [];
        for (const frame of contents.mainFrame.framesInSubtree) {
          if (frame === contents.mainFrame) continue;
          try { texts.push(String(await frame.executeJavaScript("document.body ? document.body.innerText : ''", true))); } catch { texts.push(""); }
        }
        if (texts.some((text) => text.includes(ARTIFACT_MARKER))) break;
        if (Date.now() > deadline) fail(`the widget never showed ${JSON.stringify(ARTIFACT_MARKER)}: ${JSON.stringify(texts)}`);
        await sleep(150);
      }
      await sleep(800);
      await capture(win, `${mode}-artifact-window`);
      await contents.executeJavaScript(clickJs("[data-artifact-fullscreen]"), true);
      await waitFor(contents, `Boolean(document.querySelector("[data-artifact-fullscreen-layer]"))`, "the full-screen layer");
      const asked = await waitFor(contents, `window.__fullscreen.includes("document") ? "document" : ""`, "the window asked for full screen", 5_000);
      const how = await escapeUntilGone(contents, `Boolean(document.querySelector("[data-artifact-fullscreen-layer]"))`, "the layer after Escape");
      await contents.executeJavaScript(clickJs("[data-artifact-close-window]"), true);
      await Promise.race([closed(win), sleep(STEP_MS).then(() => fail("× did not close the artifact's window"))]);
      return `full screen asked by ${asked}; escape via ${how}`;
    });

    await check("plain-window", async () => {
      const win = new HiddenWindow({ width: 900, height: 700, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
      try {
        await win.loadURL(`${SERVER}/artifact-window#bot=${encodeURIComponent(BOT)}&artifact=${encodeURIComponent(pageWindowId)}`);
        await waitFor(win.webContents, `Boolean(document.querySelector(${q(`[data-page-standalone="${PAGE}"] [data-page-viewer-frame]`)}))`, "the page in a plain window", 30_000);
        // pictured before it is judged, so a blank page is pictured too
        await sleep(1_200);
        await capture(win, `${mode}-plain-window`);
        await expectPageShown(win.webContents, PAGE, 1, "the page in a window with no hook of its own");
      } finally {
        if (!win.isDestroyed()) win.destroy();
      }
    });

    await check("ui-source", async () => {
      if (bundled) {
        if (served.bundle === 0) fail("the bundle served nothing");
        if (served.passed === 0) fail("nothing was passed through to the server");
        return `bundle ${served.bundle}, server ${served.passed}`;
      }
      if (served.bundle || served.passed) fail("the bundled handler ran in direct mode");
      return "no handler";
    });
  } finally {
    stopWatch();
    artifactWindows.closeAll();
    artifactWindows.dispose();
    for (const stop of syncListeners) stop();
    for (const win of HiddenWindow.created) if (!win.isDestroyed()) win.destroy();
    HiddenWindow.created.length = 0;
    if (bundled) {
      try { session.defaultSession.protocol.unhandle(new URL(SERVER).protocol.slice(0, -1)); } catch {}
    }
    await session.defaultSession.clearStorageData().catch(() => {});
  }
  return results;
}

app.whenReady().then(async () => {
  const modules = { createArtifactWindows: (await importModule("artifact-window.mjs")).createArtifactWindows };
  modules.blockPageFrameNavigation = (await importModule("page-frame-guard.mjs")).blockPageFrameNavigation;
  try {
    modules.installPageFrameWatch = (await importModule("page-frames.mjs")).installPageFrameWatch;
    modules.legacy = false;
  } catch {
    modules.legacy = true;
  }
  out({ fixture: "pages-open", electronDir: ELECTRON_DIR, legacy: modules.legacy, modes: MODES });
  let failed = 0;
  for (const mode of MODES) {
    const results = await runMode(mode, modules);
    failed += results.filter((result) => !result.ok).length;
  }
  out({ done: true, failed });
  app.exit(failed ? 1 : 0);
}).catch((error) => {
  out({ done: true, failed: 1, error: String(error?.stack ?? error) });
  app.exit(1);
});
