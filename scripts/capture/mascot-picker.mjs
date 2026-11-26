#!/usr/bin/env node
/**
 * Headless captures of the mascot picker (#5369): the panel open under the
 * bot page's mascot, its two tabs, the skins list with a padlock, the free
 * colour, the gear's settings and the "+" panel, light and dark, English and
 * French. Also measures what the grid costs: the time the panel takes to
 * open, and the frames a second with every thumbnail live and with only the
 * hovered one live.
 *
 * Starts its own Vite gallery server on a port of its own (never the app's
 * 5173) and stops it by its exact pid. Chrome runs headless: no window.
 *
 * Usage: node scripts/capture/mascot-picker.mjs [--out DIR] [--port N] [--measure-only] [--upstream DIR]
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "mascot-picker")));
const port = Number(arg("--port", "5369"));
const measureOnly = process.argv.includes("--measure-only");
/** A folder holding the upstream picker's captures (upstream-studio-dark*.png): with it, each view is also laid beside the upstream's. */
const upstreamDir = arg("--upstream", "") ? resolve(arg("--upstream", "")) : null;
const skins = [{ id: "pulsatrix-light", label: "light" }, { id: "pulsatrix", label: "dark" }];
const langs = ["en", "fr"];
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await sleep(500);
  }
  throw new Error(`gallery did not start at ${url}`);
}

const cacheDir = await mkdtemp(join(tmpdir(), "mascot-picker-vite-"));
const serve = `const { createServer } = await import(${JSON.stringify(join(root, "node_modules", "vite", "dist", "node", "index.js"))});
const server = await createServer({ configFile: "vite.gallery.config.ts", cacheDir: ${JSON.stringify(cacheDir)}, server: { host: "127.0.0.1", port: ${port}, strictPort: true } });
await server.listen(); console.log("ready");`;
const vite = spawn(process.execPath, ["--input-type=module", "-e", serve], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" } });
console.log("gallery server pid", vite.pid);
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

const gallery = (query) => `http://127.0.0.1:${port}/src/gallery/appearance-editor.html?${new URLSearchParams(query)}`;
const PANEL = "[data-mascot-picker-popover]";

async function mascotsDrawn(page) {
  await page.waitForFunction(() => [...document.querySelectorAll(".shape-mascot")].every((el) => el.querySelector("img, svg, canvas")), null, { timeout: 60_000 }).catch(() => {});
  await page.evaluate(async () => {
    const images = [...document.querySelectorAll(".shape-mascot img")];
    await Promise.all(images.map((image) => (image.complete ? null : image.decode().catch(() => null))));
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
}

async function open(browser, { skin, lang, query = {}, width = 1180, height = 900 }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: skin.label, locale: lang === "fr" ? "fr-CA" : "en-US" });
  context.setDefaultTimeout(60_000);
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error("page error:", error.message));
  await page.route("**/api/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not in this gallery" }) }));
  await page.goto(gallery({ skin: skin.id, lang, ...query }), { waitUntil: "networkidle" });
  await page.waitForSelector(`${PANEL} [data-mascot-picker]`);
  return { context, page };
}

const report = { webgl2: null, shots: [], cost: {} };

/** A capture of the page's top: the mascot, the panel under it and whatever small panel is open. */
async function shoot(browser, { name, skin, lang, query, prepare }) {
  const { context, page } = await open(browser, { skin, lang, query });
  const file = join(outDir, `${name}-${skin.label}-${lang}.png`);
  try {
    if (report.webgl2 === null) report.webgl2 = await page.evaluate(() => Boolean(document.createElement("canvas").getContext("webgl2")));
    if (prepare) await prepare(page);
    await page.mouse.move(2, 2);
    await sleep(900);
    await mascotsDrawn(page);
    await page.screenshot({ path: file, clip: { x: 130, y: 0, width: 760, height: 740 }, animations: "disabled" });
    report.shots.push(file);
    console.log("shot", file);
  } catch (error) {
    console.error(`${name}: failed: ${error.message.split("\n")[0]}`);
    process.exitCode = 1;
  } finally {
    await context.close();
  }
}

/** Frames a second over two seconds, and the longest frame. */
const fps = (page) => page.evaluate(() => new Promise((done) => {
  let frames = 0;
  let longest = 0;
  let last = performance.now();
  const start = last;
  const tick = (now) => {
    frames += 1;
    longest = Math.max(longest, now - last);
    last = now;
    if (now - start < 2000) requestAnimationFrame(tick);
    else done({ fps: Math.round((frames * 1000) / (now - start)), longestFrameMs: Math.round(longest) });
  };
  requestAnimationFrame(tick);
}));

/** What the grid of fifty shapes costs, for a material: the opening, then the frames with every thumbnail live and with stills. */
async function measure(browser, material) {
  const skin = skins[1];
  const { context, page } = await open(browser, { skin, lang: "en", query: { material, shape: "cup" } });
  try {
    const cells = await page.locator("[data-mascot-picker-grid] [data-mascot-cell]").count();
    // the opening: close, then from the click on the mascot to the grid drawn
    await page.keyboard.press("Escape");
    await page.waitForSelector(PANEL, { state: "detached" });
    const openMs = await page.evaluate(async () => {
      const start = performance.now();
      document.querySelector("[data-bot-profile-hero] [data-mascot-stage]").click();
      await new Promise((done) => {
        const check = () => {
          const drawn = [...document.querySelectorAll("[data-mascot-picker-grid] .shape-mascot")];
          if (drawn.length >= 50 && drawn.every((el) => el.querySelector("img, svg, canvas"))) done(null);
          else requestAnimationFrame(check);
        };
        check();
      });
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      return Math.round(performance.now() - start);
    });
    await sleep(1500);
    const stills = await fps(page);
    const canvases = await page.evaluate(() => document.querySelectorAll("[data-mascot-picker-grid] canvas").length);
    report.cost[material] = { cells, openMs, hoverOnly: stills, canvasesInGrid: canvases };
  } finally {
    await context.close();
  }
  // every thumbnail live: the gallery's ?live=all
  const all = await open(browser, { skin, lang: "en", query: { material, shape: "cup", live: "all" } });
  try {
    await sleep(2500);
    report.cost[material].allLive = await fps(all.page);
    report.cost[material].allLiveLostContexts = await all.page.evaluate(() => [...document.querySelectorAll("[data-mascot-picker-grid] canvas")].filter((canvas) => { try { const gl = canvas.getContext("webgl2"); return gl ? gl.isContextLost() : false; } catch { return false; } }).length);
  } finally {
    await all.context.close();
  }
}

let browser;
try {
  await mkdir(outDir, { recursive: true });
  await waitForServer(`http://127.0.0.1:${port}/src/gallery/appearance-editor.html`);
  browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  for (const material of ["flat", "fluffy", "glass"]) await measure(browser, material);
  console.log("cost", JSON.stringify(report.cost));
  if (!measureOnly) {
    for (const skin of skins) {
      for (const lang of langs) {
        const each = (name, query, prepare) => shoot(browser, { name, skin, lang, query, prepare });
        await each("shapes", { material: "glass", shape: "cup", color: "teal" });
        await each("shapes-flat", { shape: "cup", shapeSkin: "gold" });
        await each("shapes-fluffy", { material: "fluffy", shape: "cat", color: "orange" });
        await each("characters", { character: "frog", color: "green", locked: "1" }, async (page) => { await page.locator('[data-mascot-picker-tab="characters"]').click(); });
        await each("skins-locked", { shape: "cup", shapeSkin: "plain", locked: "1" }, async (page) => { await page.locator("[data-mascot-skins-open]").click(); await page.waitForSelector("[data-mascot-skins]"); });
        await each("free-color", { shape: "star", bodyColor: "#c2185b", color: "pink" }, async (page) => { await page.locator("[data-mascot-color-custom]").hover(); });
        await each("gear", { shape: "cup", material: "glass" }, async (page) => { await page.locator("[data-mascot-picker-gear]").click(); await page.waitForSelector('[data-mascot-picker-layer="gear"]'); });
        await each("add", { shape: "cup" }, async (page) => {
          await page.locator("[data-mascot-picker-grid]").evaluate((box) => { box.scrollTop = box.scrollHeight; });
          await page.locator("[data-mascot-add-open]").click();
          await page.waitForSelector("[data-mascot-add]");
        });
      }
    }
  }
  // each view beside the upstream picker's own capture (the study's, dark: the upstream site has no light theme)
  if (!measureOnly && upstreamDir) {
    const views = [["shapes", "upstream-studio-dark-working-happy-glass.png"], ["shapes-flat", "upstream-studio-dark.png"], ["characters", "upstream-studio-dark.png"], ["skins-locked", "upstream-studio-dark.png"], ["free-color", "upstream-studio-dark.png"], ["gear", "upstream-studio-dark-settings.png"], ["add", "upstream-studio-dark-generate.png"], ["add", "upstream-studio-dark-import.png"]];
    for (const skin of skins) {
      for (const lang of langs) {
        const context = await browser.newContext({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1 });
        try {
          const page = await context.newPage();
          const dark = skin.label === "dark";
          const rows = [];
          for (const [view, upstream] of views) {
            const ours = (await readFile(join(outDir, `${view}-${skin.label}-${lang}.png`))).toString("base64");
            const theirs = (await readFile(join(upstreamDir, upstream))).toString("base64");
            rows.push(`<figure><figcaption>upstream 0.5.1: ${upstream.replace("upstream-studio-", "").replace(".png", "")}</figcaption><img src="data:image/png;base64,${theirs}"></figure><figure><figcaption>Sagax: ${view} (${skin.label}, ${lang})</figcaption><img src="data:image/png;base64,${ours}"></figure>`);
          }
          await page.setContent(`<body style="margin:0;padding:16px;display:grid;grid-template-columns:repeat(4,max-content);width:max-content;gap:16px;background:${dark ? "#111" : "#eee"};font:600 15px system-ui;color:${dark ? "#eee" : "#111"}"><style>figure{margin:0;display:flex;flex-direction:column;gap:8px}img{display:block;height:520px;width:auto}</style>${rows.join("")}</body>`);
          const file = join(outDir, `side-by-side-${skin.label}-${lang}.png`);
          await page.locator("body").screenshot({ path: file });
          report.shots.push(file);
          console.log("sheet", file);
        } finally {
          await context.close();
        }
      }
    }
  }
  await writeFile(join(outDir, "report.json"), JSON.stringify(report, null, 2));
} catch (error) {
  console.error(error);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  // stop only what this script started, by its exact pid
  if (vite.pid) { try { process.kill(vite.pid, "SIGTERM"); } catch { /* already gone */ } }
  await rm(cacheDir, { recursive: true, force: true });
}
