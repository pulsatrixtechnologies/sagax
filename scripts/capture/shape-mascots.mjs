#!/usr/bin/env node
/**
 * Headless captures and the cost measure of the shape mascots (#4145), on the
 * gallery pages (every name synthetic): the shell with a sidebar of forty
 * bots wearing shapes, a few in premium skins (the rows, the pinned tile,
 * the chat header pill), the icons rail, the bot page, Edit bot >
 * Appearance (the Mascot view, the whole Shape picker with the engine's
 * gallery, the Skin tab), every mood, the premium skins and a few moves on
 * the shape set. Light and dark, English and French, 1280 and 390 px wide.
 * Headless Chrome only: no window opens.
 *
 * The measure loads the forty-bot sidebar five times and reports the median
 * time until every row's mascot is drawn, the main thread's script and task
 * time, the JS heap, the DOM nodes and the animation frames requested over
 * two idle seconds.
 *
 * Usage: node scripts/capture/shape-mascots.mjs [--out DIR] [--port N]
 *          [--prefix before|after] [--only shots|measure]
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "shape-mascots")));
const port = Number(arg("--port", "5331"));
const prefix = arg("--prefix", "after");
const only = arg("--only", "");
const skins = [{ id: "pulsatrix-light", label: "light" }, { id: "pulsatrix", label: "dark" }];
const langs = ["en", "fr"];
const widths = [1280, 390];
const MOODS = ["idle", "thinking", "working", "streaming", "happy", "blocked", "sleeping"];
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await sleep(500);
  }
  throw new Error(`gallery did not start at ${url}`);
}

// the gallery's Vite, with a dependency cache of its own: the shared node_modules/.vite of
// other checkouts' servers would rewrite it under this one
const cacheDir = await mkdtemp(join(tmpdir(), "shape-mascots-vite-"));
const serve = `const { createServer } = await import(${JSON.stringify(join(root, "node_modules", "vite", "dist", "node", "index.js"))});
const server = await createServer({ configFile: "vite.gallery.config.ts", cacheDir: ${JSON.stringify(cacheDir)}, server: { host: "127.0.0.1", port: ${port}, strictPort: true } });
await server.listen(); console.log("ready");`;
const vite = spawn(process.execPath, ["--input-type=module", "-e", serve], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" } });
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

const gallery = (page, query) => `http://127.0.0.1:${port}/src/gallery/${page}.html?${new URLSearchParams(query)}`;

/** Every mascot of the page drawn (an image or an SVG in each): the stills decoded, the live ones painted. */
async function mascotsDrawn(page, selector = ".shape-mascot") {
  await page.waitForFunction((sel) => [...document.querySelectorAll(sel)].every((el) => el.querySelector("img, svg")), selector, { timeout: 60_000 }).catch(() => {});
  await page.evaluate(async () => {
    const images = [...document.querySelectorAll(".shape-mascot img")];
    await Promise.all(images.map((image) => (image.complete ? null : image.decode().catch(() => null))));
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
}

async function shots(browser) {
  // one shot, tried twice (Vite may reload a page while it optimizes a dependency); a shot that still fails is reported, the others go on
  const shoot = async (shot) => {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        return await shootOnce(shot);
      } catch (error) {
        console.error(`${shot.name}: attempt ${attempt} failed: ${error.message.split("\n")[0]}`);
      }
    }
  };
  const shootOnce = async ({ name, page: galleryPage, query, width, height, skin, lang, prepare, locator, wait = 700 }) => {
    const context = await browser.newContext({ viewport: { width, height: height ?? (width < 640 ? 844 : 860) }, deviceScaleFactor: 2, colorScheme: skin.label, locale: lang === "fr" ? "fr-CA" : "en-US" });
    context.setDefaultTimeout(120_000);
    try {
      const page = await context.newPage();
      page.on("pageerror", (error) => console.error(`${name}: page error:`, error.message));
      // the Appearance gallery holds its own bot: every server call answers that it is not here
      if (galleryPage === "appearance-editor") await page.route("**/api/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not in this gallery" }) }));
      await page.goto(gallery(galleryPage, { skin: skin.id, lang, ...query }), { waitUntil: "networkidle" });
      await page.waitForSelector(".shape-mascot", { timeout: 60_000 });
      if (prepare) await prepare(page);
      await page.mouse.move(0, 0);
      await sleep(wait);
      await mascotsDrawn(page);
      const file = join(outDir, `${prefix}-${name}-${skin.label}-${lang}-${width}.png`);
      await (locator ? page.locator(locator).first() : page).screenshot({ path: file, animations: "disabled" });
      console.log("shot", file);
    } finally {
      await context.close();
    }
  };
  for (const skin of skins) {
    for (const lang of langs) {
      for (const width of widths) {
        const common = { skin, lang, width };
        // the shell: forty bots in the sidebar (390: the drawer), the pinned tile, the header pill
        const shell = { page: "app-shell-sidebar", query: { shapes: "40", ...(width < 640 ? { drawer: "1" } : {}) } };
        await shoot({ name: "sidebar", ...shell, ...common });
        await shoot({ name: "pinned-tile", ...shell, ...common, locator: "button:has([data-sidebar-tile-labels])" });
        await shoot({ name: "chat-pill", page: "app-shell-sidebar", query: { shapes: "40" }, ...common, locator: "[data-chat-pill]" });
        // the bot page: its large mascot at the top
        await shoot({
          name: "bot-page", page: "bot-profile", query: { shape: "cup" }, ...common,
          prepare: async (page) => {
            await page.evaluate(() => { for (const el of document.querySelectorAll("*")) if (el.scrollTop) el.scrollTop = 0; window.scrollTo(0, 0); });
          },
        });
        // Edit bot > Appearance: the Mascot view, the whole Shape picker (a tall page: every row, the gallery's too), the Skin tab
        for (const tab of ["mascot", "shape", "skin"]) {
          await shoot({
            name: `appearance-${tab}`, page: "appearance-editor", query: { shapeSkin: "galaxy" }, ...common, ...(tab === "shape" ? { height: 2600 } : {}),
            prepare: async (page) => {
              await page.waitForSelector("[data-appearance-tab]", { timeout: 60_000 });
              await page.locator(`[data-appearance-tab="${tab}"]`).first().click();
              if (tab === "shape") await page.waitForSelector("[data-character-shape]", { timeout: 60_000 });
              await page.waitForSelector("[data-mascot-stage]", { timeout: 30_000 }).catch(() => {});
            },
          });
        }
      }
      // the icons rail (a desktop width)
      await shoot({ name: "rail", page: "app-shell-sidebar", query: { shapes: "40", density: "icons" }, skin, lang, width: 1280 });
    }
    // every mood, still and live sizes
    for (const mood of MOODS) {
      await shoot({ name: `mood-${mood}`, page: "shape-set", query: { mood, size: "72" }, skin, lang: "en", width: 1280 });
    }
    // the premium skins on every shape, as a still (72) and live (112)
    for (const shapeSkin of ["neon", "crystal", "circuit", "holo", "molten", "galaxy"]) {
      await shoot({ name: `skin-${shapeSkin}`, page: "shape-set", query: { shapeSkin, size: "72", still: "1" }, skin, lang: "en", width: 1280 });
      await shoot({ name: `skin-${shapeSkin}-live`, page: "shape-set", query: { shapeSkin, only: "hexagon", size: "160" }, skin, lang: "en", width: 1280, height: 400 });
    }
    // a few moves, part way through (the gallery plays the move every four seconds; the mascot marks the one playing)
    for (const [move, at] of [["orbit", 1500], ["comet", 1100], ["egg", 800], ["wink", 600], ["notify", 1000], ["thinking", 1100], ["burst", 900], ["sleep", 1100]]) {
      await shoot({
        name: `move-${move}`, page: "shape-set", query: { move, only: "circle", size: "220", color: "blue" }, skin, lang: "en", width: 1280, height: 420, wait: 0,
        prepare: async (page) => {
          await page.waitForSelector("[data-shape-move]", { timeout: 15_000 });
          await sleep(at);
        },
      });
    }
  }
}

/** The forty-bot sidebar, loaded five times: the median of each figure. */
async function measure(browser) {
  const runs = [];
  for (let run = 0; run < 5; run += 1) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
    await context.addInitScript(() => {
      const w = window;
      w.__frames = 0;
      const raf = w.requestAnimationFrame.bind(w);
      w.requestAnimationFrame = (cb) => { w.__frames += 1; return raf(cb); };
    });
    context.setDefaultTimeout(120_000);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    const started = Date.now();
    await page.goto(gallery("app-shell-sidebar", { shapes: "40", skin: "pulsatrix-light" }), { waitUntil: "load" });
    // forty bots: the pinned tile above the list, thirty-nine rows
    await page.waitForFunction(() => document.querySelectorAll("[data-sidebar-bot-row] .shape-mascot").length >= 39, null, { timeout: 60_000 }).catch(() => {});
    await mascotsDrawn(page, "[data-sidebar-bot-row] .shape-mascot");
    const drawnMs = Date.now() - started;
    await sleep(1500);
    await cdp.send("HeapProfiler.collectGarbage").catch(() => {});
    const before = await page.evaluate(() => window.__frames);
    await sleep(2000);
    const frames = (await page.evaluate(() => window.__frames)) - before;
    const metrics = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
    const rows = await page.evaluate(() => document.querySelectorAll("[data-sidebar-bot-row] .shape-mascot").length);
    // the DOM nodes the mascots themselves hold (the rest is the shell's)
    const mascotNodes = await page.evaluate(() => [...document.querySelectorAll(".shape-mascot")].reduce((n, el) => n + el.querySelectorAll("*").length + 1, 0));
    runs.push({ drawnMs, scriptMs: Math.round(metrics.ScriptDuration * 1000), taskMs: Math.round(metrics.TaskDuration * 1000), heapMb: metrics.JSHeapUsedSize / 1048576, nodes: metrics.Nodes, mascotNodes, framesPerSecond: frames / 2, rows });
    await context.close();
  }
  const median = (key) => runs.map((r) => r[key]).sort((a, b) => a - b)[2];
  const result = { prefix, drawnMs: median("drawnMs"), scriptMs: median("scriptMs"), taskMs: median("taskMs"), heapMb: Number(median("heapMb").toFixed(1)), nodes: median("nodes"), mascotNodes: median("mascotNodes"), framesPerSecond: median("framesPerSecond"), rows: median("rows"), runs };
  await writeFile(join(outDir, `${prefix}-measure.json`), `${JSON.stringify(result, null, 1)}\n`);
  console.log(JSON.stringify({ ...result, runs: undefined }));
}

let browser;
try {
  await waitForServer(gallery("shape-set", {}));
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  // a throwaway load: Vite optimizes dependencies on the first visit
  const warm = await browser.newPage();
  warm.setDefaultTimeout(300_000);
  await warm.goto(gallery("app-shell-sidebar", { shapes: "40" }), { waitUntil: "load" });
  await warm.waitForSelector(".shape-mascot", { timeout: 120_000 }).catch(() => {});
  await sleep(2000);
  await warm.close();
  if (only !== "measure") await shots(browser);
  if (only !== "shots") await measure(browser);
} catch (error) {
  console.error(error);
  console.error(log.slice(-4000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
  await rm(cacheDir, { recursive: true, force: true });
}
