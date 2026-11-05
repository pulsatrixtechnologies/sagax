#!/usr/bin/env node
/**
 * Headless screenshots of #2013 (src/gallery/connection-notices.html), light
 * and dark, French and English: the connection notice pills and the composer
 * line for a pre-send refusal. Headless Chromium only: no window opens.
 * Usage: node scripts/capture/connection-notices.mjs [--out DIR] [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "connection-notices"));
const port = Number(arg("--port") ?? 5311);
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
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" },
  detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/connection-notices.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  const page = await browser.newPage({ viewport: { width: 900, height: 760 }, deviceScaleFactor: 2 });
  page.on("pageerror", (error) => console.error(`page error: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") console.error(`console: ${message.text().slice(0, 300)}`); });
  for (const lang of ["fr", "en"]) {
    for (const { id, label } of skins) {
      await page.goto(`${base}?skin=${id}&lang=${lang}`, { waitUntil: "load" });
      await page.waitForSelector("[data-connection-notice=reconnected]", { timeout: 120_000 });
      await page.waitForTimeout(500);
      await page.locator("[data-gallery-notices]").screenshot({ path: join(outDir, `notices-${lang}-${label}.png`) });
      // open one Details disclosure so the engine's own words show
      await page.locator("[data-gallery-composer] details summary").first().click();
      await page.waitForTimeout(150);
      await page.locator("[data-gallery-composer]").screenshot({ path: join(outDir, `composer-${lang}-${label}.png`) });
    }
  }
  console.log(`saved to ${outDir}`);
} catch (error) {
  console.error(log.slice(-2_000));
  throw error;
} finally {
  await browser?.close();
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* gone */ }
}
