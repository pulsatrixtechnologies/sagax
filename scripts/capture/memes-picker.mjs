#!/usr/bin/env node
/**
 * Headless screenshots of the Memes picker gallery (#2121):
 * src/gallery/memes-picker.html. Headless Chromium only: no window opens.
 * Its own Vite port (never 5173).
 * Usage: node scripts/capture/memes-picker.mjs [--out DIR] [--port N] [--bar PREFIX]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? "/Users/Workspace/artifacts/sagax-gif-2121");
const port = Number(arg("--port") ?? 5186);
// --bar PREFIX: English only, as PREFIX-composer-bar-<theme>.png (the + menu with its GIF row, and the picker)
const bar = arg("--bar");

async function waitForServer(url, ms = 120_000) {
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
  const base = `http://127.0.0.1:${port}/src/gallery/memes-picker.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const executablePath = process.env.SAGAX_VERIFY_BROWSER_CHROME;
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  for (const skin of ["pulsatrix", "daylight"]) {
    for (const lang of bar ? ["en"] : ["en", "fr"]) {
      const page = await browser.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 2 });
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error?.stack ?? error).slice(0, 800)));
      await page.goto(`${base}?${new URLSearchParams({ skin, lang, ...(bar ? { picker: "0" } : {}) })}`, { waitUntil: "load" });
      await page.waitForSelector(bar ? "[data-composer-plus-menu]" : "[data-meme-picker]");
      if (!bar) await page.waitForSelector("[data-meme-image]");
      await page.waitForTimeout(400);
      const theme = skin === "pulsatrix" ? "dark" : "light";
      const file = join(outDir, bar ? `${bar}-composer-bar-${theme}.png` : `memes-picker-${theme}-${lang}.png`);
      await page.locator(bar ? "[data-gallery-panel='composer-bar']" : "[data-gallery-sample='memes-picker']").screenshot({ path: file });
      console.log(`${file}${errors.length ? ` ERRORS: ${errors.join(" | ")}` : ""}`);
      if (errors.length) failed = true;
      await page.close();
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
