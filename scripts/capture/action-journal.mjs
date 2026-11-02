#!/usr/bin/env node
/**
 * Headless screenshots of the Approvals screen's Journal tab (2026-10-26):
 * src/gallery/action-journal.html, light and dark: the Journal, a row opened,
 * "Tester une règle" with its result, and the History tab beside it for
 * comparison. The gallery answers /api itself. Headless Chromium only: no
 * window opens.
 * Usage: node scripts/capture/action-journal.mjs [--out DIR] [--port N]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "action-journal"));
const port = Number(arg("--port") ?? 5293);
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
  const base = `http://127.0.0.1:${port}/src/gallery/action-journal.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
  for (const { id, label } of skins) {
    await page.goto(`${base}?skin=${id}&lang=fr&tab=journal`, { waitUntil: "load" });
    await page.waitForSelector("[data-journal-outcome]");
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(outDir, `journal-${label}.png`) });
    await page.click('[data-journal-outcome="asked"][data-journal-decider="level"] >> nth=1 >> button');
    await page.waitForSelector("[data-journal-detail]");
    await page.screenshot({ path: join(outDir, `journal-detail-${label}.png`) });
    await page.click("[data-journal-test-toggle]");
    await page.fill("[data-rule-test-panel] textarea", "modifier des fichiers dans ~/Projets");
    await page.click("[data-rule-test-panel] [data-rule-test-run]");
    await page.waitForSelector("[data-rule-test-result]");
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(outDir, `journal-test-${label}.png`) });
    await page.goto(`${base}?skin=${id}&lang=fr&tab=history`, { waitUntil: "load" });
    await page.waitForSelector("[data-history-decision]");
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(outDir, `journal-neighbour-history-${label}.png`) });
  }
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(error);
  console.error(log.slice(-4000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* gone */ }
}
