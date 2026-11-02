#!/usr/bin/env node
/**
 * Headless screenshots of one turn whose tool calls were approved with no
 * card (2026-10-28): src/gallery/auto-approved-turn.html, light and dark,
 * closed and with one call opened on its details. Headless Chromium only:
 * no window opens.
 * Usage: node scripts/capture/auto-approved-turn.mjs [--out DIR] [--port N] [--prefix NAME]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "auto-approved-turn"));
const port = Number(arg("--port") ?? 5294);
const prefix = arg("--prefix") ?? "turn";
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
  const base = `http://127.0.0.1:${port}/src/gallery/auto-approved-turn.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  const page = await browser.newPage({ viewport: { width: 900, height: 520 }, deviceScaleFactor: 2 });
  for (const { id, label } of skins) {
    for (const open of [false, true]) {
      await page.goto(`${base}?skin=${id}&lang=en`, { waitUntil: "load" });
      await page.waitForSelector('[data-shot="turn"]');
      // the second call's row, opened on its details
      if (open) await page.locator('[data-shot="turn"] [data-step-row] button').nth(1).click();
      await page.waitForTimeout(300);
      await page.locator('[data-shot="turn"]').screenshot({ path: join(outDir, `${prefix}${open ? "-open" : ""}-${label}.png`) });
    }
  }
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (log) console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* already gone */ }
}
