#!/usr/bin/env node
/**
 * Headless before and after captures for an update of the open-bot-avatar
 * engine: every shape of the picker (ours, the engine's examples and its
 * gallery) and a shape a person pasted, each in its own image, in the
 * engine's three moods, as a still (72 px) and live (112 px, the page's
 * frame clock stepped by hand so two runs draw the same frame), light and
 * dark. Run it once on the pinned version (--prefix before), once after the
 * bump (--prefix after), then --compare writes which cells changed.
 * Headless Chrome only: no window opens.
 *
 * Usage: node scripts/capture/shape-engine-update.mjs --out DIR [--port N] [--prefix before|after]
 *        node scripts/capture/shape-engine-update.mjs --out DIR --compare
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = resolve(arg("--out", join(root, "artifacts", "shape-engine-update")));
const port = Number(arg("--port", "5333"));
const prefix = arg("--prefix", "after");
const SKINS = [{ id: "pulsatrix-light", label: "light" }, { id: "pulsatrix", label: "dark" }];
const MOODS = ["idle", "thinking", "happy"];
const MODES = [{ label: "still", query: { still: "1", size: "72" } }, { label: "live", query: { size: "112" } }];
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

if (process.argv.includes("--compare")) {
  // a pixel counts as changed past a small difference of colour, an image past 0.3 % of its pixels: antialiasing noise between two runs stays under both
  const files = (await readdir(outDir)).filter((file) => file.endsWith(".png"));
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  const data = async (file) => `data:image/png;base64,${(await readFile(join(outDir, file))).toString("base64")}`;
  const changed = [];
  const added = [];
  let same = 0;
  for (const file of files.filter((name) => name.startsWith("after-") && !name.startsWith("after-sheet-")).sort()) {
    const before = file.replace(/^after-/, "before-");
    if (!files.includes(before)) { added.push(file); continue; }
    const share = await page.evaluate(async ([a, b]) => {
      const pixels = async (src) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        const canvas = new OffscreenCanvas(image.width, image.height);
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height);
      };
      const [x, y] = [await pixels(a), await pixels(b)];
      if (x.width !== y.width || x.height !== y.height) return 1;
      let n = 0;
      for (let i = 0; i < x.data.length; i += 4) {
        if (Math.abs(x.data[i] - y.data[i]) > 24 || Math.abs(x.data[i + 1] - y.data[i + 1]) > 24 || Math.abs(x.data[i + 2] - y.data[i + 2]) > 24) n += 1;
      }
      return n / (x.data.length / 4);
    }, [await data(before), await data(file)]);
    if (share > 0.003) changed.push([file.replace(/^after-|\.png$/g, ""), Number((share * 100).toFixed(2))]);
    else same += 1;
  }
  await browser.close();
  await writeFile(join(outDir, "compare.json"), `${JSON.stringify({ same, changed, added }, null, 1)}\n`);
  console.log(JSON.stringify({ same, changed: changed.length, added: added.length }));
  process.exit(0);
}

const cacheDir = await mkdtemp(join(tmpdir(), "shape-engine-update-vite-"));
const serve = `const { createServer } = await import(${JSON.stringify(join(root, "node_modules", "vite", "dist", "node", "index.js"))});
const server = await createServer({ configFile: "vite.gallery.config.ts", cacheDir: ${JSON.stringify(cacheDir)}, server: { host: "127.0.0.1", port: ${port}, strictPort: true } });
await server.listen(); console.log("ready");`;
const vite = spawn(process.execPath, ["--input-type=module", "-e", serve], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" } });
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });
const url = (query) => `http://127.0.0.1:${port}/src/gallery/shape-set.html?${new URLSearchParams(query)}`;

let browser;
try {
  const start = Date.now();
  for (;;) {
    try { if ((await fetch(url({}))).status < 500) break; } catch { /* retry */ }
    if (Date.now() - start > 120_000) throw new Error("the gallery did not start");
    await sleep(500);
  }
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const warm = await browser.newPage();
  warm.setDefaultTimeout(300_000);
  await warm.goto(url({ pasted: "1" }), { waitUntil: "load" });
  await warm.waitForSelector(".shape-mascot", { timeout: 120_000 }).catch(() => {});
  await sleep(2000);
  await warm.close();
  for (const skin of SKINS) {
    for (const mood of MOODS) {
      for (const mode of MODES) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 1400 }, deviceScaleFactor: 2, colorScheme: skin.label });
        context.setDefaultTimeout(120_000);
        const page = await context.newPage();
        page.on("pageerror", (error) => console.error(`${skin.label} ${mood} ${mode.label}: page error:`, error.message));
        // the page's frame clock is held and stepped by hand (performance.now and requestAnimationFrame): two runs draw the same instant of the breath, the blink and the mood
        await page.addInitScript(() => {
          let now = 1000;
          let queue = new Map();
          let last = 0;
          performance.now = () => now;
          window.requestAnimationFrame = (callback) => {
            queue.set((last += 1), callback);
            return last;
          };
          window.cancelAnimationFrame = (id) => { queue.delete(id); };
          window.__advance = (ms) => {
            for (let elapsed = 0; elapsed < ms; elapsed += 16) {
              now += 16;
              const run = queue;
              queue = new Map();
              for (const callback of run.values()) callback(now);
            }
          };
        });
        await page.goto(url({ skin: skin.id, lang: "en", mood, pasted: "1", ...mode.query }), { waitUntil: "load" });
        await page.mouse.move(0, 0);
        // the page draws every still with the clock held (the engine's clock starts at that instant), then the live loop runs three held seconds
        await page.waitForSelector("[data-shape-cell='pasted'] [data-shape-drawn]", { timeout: 120_000 });
        await page.waitForFunction(() => [...document.querySelectorAll(".shape-mascot")].every((el) => el.querySelector("img, svg")), null, { timeout: 60_000, polling: 200 });
        await page.waitForFunction(() => [...document.querySelectorAll(".shape-mascot")].every((el) => el.hasAttribute("data-shape-drawn")), null, { timeout: 60_000, polling: 200 });
        await sleep(400);
        await page.evaluate(() => Promise.all([...document.querySelectorAll(".shape-mascot img")].map((image) => (image.complete ? null : image.decode().catch(() => null)))));
        await page.evaluate(() => window.__advance(3000));
        await sleep(150);
        const cells = await page.locator("[data-shape-cell]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-shape-cell")));
        for (const cell of cells) {
          await page.locator(`[data-shape-cell="${cell}"] .shape-mascot`).screenshot({ path: join(outDir, `${prefix}-${cell}-${mood}-${mode.label}-${skin.label}.png`), animations: "disabled" });
        }
        await page.screenshot({ path: join(outDir, `${prefix}-sheet-${mood}-${mode.label}-${skin.label}.png`), animations: "disabled", fullPage: true });
        console.log("shot", skin.label, mood, mode.label, cells.length);
        await context.close();
      }
    }
  }
} catch (error) {
  console.error(error);
  console.error(log.slice(-4000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
  await rm(cacheDir, { recursive: true, force: true });
}
