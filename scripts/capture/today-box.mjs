#!/usr/bin/env node
/**
 * Headless screenshots of the Today box (src/gallery/today-box.html), light and
 * dark, fr and en. Exits 1 on any pageerror or console error. Synthetic data
 * only. Headless Chrome: no window opens.
 * Reference set: docs/screenshots/today-box (cited here so the #1386
 * docs-media guard keeps the PNGs on the product branch).
 * Usage: node scripts/capture/today-box.mjs [--out DIR] [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs/screenshots/today-box"));
const port = Number(arg("--port") ?? 5190);
const skins = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const vite = spawn("pnpm", ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/today-box.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 900, height: 760 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const where = message.location()?.url;
    errors.push(`console error: ${message.text()}${where ? ` (${where})` : ""}`);
  });
  for (const { id, label } of skins) {
    for (const lang of ["fr", "en"]) {
      await page.goto(`${base}?${new URLSearchParams({ skin: id, lang })}`, { waitUntil: "load" });
      await page.waitForSelector("h1");
      await page.waitForSelector("text=/Factures|Pixel/");
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(outDir, `today-box-${label}-${lang}.png`) });
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(`screenshots in ${outDir}, no pageerror or console error`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (log) console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* already gone */ }
}
