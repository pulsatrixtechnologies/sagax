#!/usr/bin/env node
/**
 * Headless screenshots of the HD mascots (src/gallery/hd-mascots.html): a
 * Shiba bot in HD idle, happy and sad (their loops), a mood drawn by a
 * still (thinking), the same under reduced motion, a sheet of states, and
 * the classic vector look ("HD mascots" off). Headless Chromium only.
 * Usage: node scripts/capture-hd-mascots.mjs [--out DIR] [--port N] [--chrome PATH]
 *   (--chrome or SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "hd-mascots"));
const port = Number(arg("--port") ?? 5291);

const SHOTS = [
  { name: "hd-idle", query: "state=idle", hd: true },
  { name: "hd-happy", query: "state=happy", hd: true },
  // the sad clip plays once (about 5 s) and rests lying down
  { name: "hd-sad", query: "state=sad", hd: true, settle: 5800 },
  { name: "hd-still-thinking", query: "state=thinking", hd: true },
  { name: "hd-reduced-motion-happy", query: "state=happy", hd: true, reduced: true },
  { name: "hd-sheet", query: "", hd: true },
  { name: "classic-idle", query: "state=idle&hd=off", hd: false },
  { name: "classic-sheet", query: "hd=off", hd: false },
];

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const vite = spawn("pnpm", ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" },
  detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

try {
  const base = `http://127.0.0.1:${port}/src/gallery/hd-mascots.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const chrome = arg("--chrome") ?? process.env.SAGAX_VERIFY_BROWSER_CHROME;
  const browser = await chromium.launch({ headless: true, ...(chrome ? { executablePath: chrome } : {}) });
  for (const shot of SHOTS) {
    const context = await browser.newContext({ viewport: { width: shot.query.includes("state=") ? 420 : 960, height: 420 }, deviceScaleFactor: 2, reducedMotion: shot.reduced ? "reduce" : "no-preference" });
    const page = await context.newPage();
    await page.goto(`${base}?skin=daylight&${shot.query}`, { waitUntil: "load" });
    await page.waitForSelector("[data-shot]");
    if (shot.hd) {
      // every HD mascot on the page has drawn its art (not the vector stand-in)
      await page.waitForFunction(() => {
        const boxes = [...document.querySelectorAll(".hd-mascot")];
        return boxes.length > 0 && boxes.every((box) => box.getAttribute("data-hd") === "ready");
      }, null, { timeout: 20_000 });
      // a few frames into the loop
      await page.waitForTimeout(shot.settle ?? 700);
    } else {
      if (await page.locator(".hd-mascot").count()) throw new Error(`${shot.name}: HD art drawn with HD mascots off`);
      await page.waitForTimeout(400);
    }
    await page.locator("[data-shot]").screenshot({ path: join(outDir, `${shot.name}.png`) });
    await context.close();
  }
  await browser.close();
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(error);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  try { process.kill(-vite.pid, "SIGTERM"); } catch { vite.kill("SIGTERM"); }
}
