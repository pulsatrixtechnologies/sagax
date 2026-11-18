#!/usr/bin/env node
/**
 * #4208: headless screenshots of Teach a task (src/gallery/teach-task.html):
 * the + menu's chooser, the bot's browser recording in the screen window,
 * Stop leading to the steps, and a /learn question in the pinned zone;
 * light and dark, English and French. Synthetic data only. Headless Chrome:
 * no window opens. Its own Vite port (never 5173).
 * Usage: node scripts/capture/teach-task.mjs [--out DIR] [--port N] [--prefix after]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "teach-task"));
const port = Number(arg("--port") ?? 5331);
const prefix = arg("--prefix") ?? "after";
const CASES = (arg("--cases") ?? "chooser,recording,steps,computer-menu,learn-before,learn-after").split(",");
const SKINS = [["daylight", "light"], ["midnight", "dark"]];

async function waitForServer(url, ms = 180_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const viteBin = join(root, "node_modules", "vite", "bin", "vite.js");
const vite = spawn(process.execPath, [viteBin, "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

let browser;
let failed = false;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/teach-task.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  for (const which of CASES) {
    for (const [skin, theme] of SKINS) {
      for (const lang of ["en", "fr"]) {
        const page = await browser.newPage({ viewport: { width: 1100, height: 780 }, deviceScaleFactor: 2 });
        const errors = [];
        page.on("pageerror", (error) => errors.push(String(error?.stack ?? error).slice(0, 800)));
        await page.goto(`${base}?${new URLSearchParams({ skin, lang, case: which })}`, { waitUntil: "load" });
        // the recording sample is a modal window drawn in a portal: its
        // gallery box stays empty, so wait for the box to exist, not to show
        await page.waitForSelector(`[data-gallery-sample="${which}"]`, { state: "attached" });
        await page.waitForTimeout(700);
        const file = join(outDir, `${prefix}-${which}-${theme}-${lang}.png`);
        await page.screenshot({ path: file });
        console.log(`${file}${errors.length ? ` ERRORS: ${errors.join(" | ")}` : ""}`);
        if (errors.length) failed = true;
        await page.close();
      }
    }
  }
} catch (error) {
  failed = true;
  console.error(error, log.slice(-2000));
} finally {
  await browser?.close().catch(() => {});
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* already gone */ }
}
process.exit(failed ? 1 : 0);
