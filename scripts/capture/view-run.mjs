#!/usr/bin/env node
/**
 * Headless screenshots of View run (src/gallery/view-run.html): a routine's
 * report in the chat, then what a click on View run opens, light and dark.
 * Headless Chromium only: no window opens; the gallery answers /api itself.
 * Usage: node scripts/capture/view-run.mjs [--out DIR] [--port N] [--prefix before|after]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "view-run"));
const port = Number(arg("--port") ?? 5299);
const prefix = arg("--prefix") ?? "after";
const skins = [{ id: "pulsatrix-light", label: "light" }, { id: "pulsatrix", label: "dark" }];

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
  const base = `http://127.0.0.1:${port}/src/gallery/view-run.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  for (const skin of skins) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: 2 });
    await page.goto(`${base}?skin=${skin.id}&width=1200&height=760`, { waitUntil: "networkidle" });
    const button = page.locator('button[aria-label="View run for Project health watch"]');
    await button.waitFor({ timeout: 30_000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(outDir, `${prefix}-chat-${skin.label}.png`) });
    await button.click();
    await page.waitForTimeout(1_500);
    await page.screenshot({ path: join(outDir, `${prefix}-click-${skin.label}.png`) });
    console.log(`${prefix} ${skin.label}: ${await page.locator("[data-gallery-sample]").getAttribute("data-gallery-sample")}`);
    // 2026-10-29: Continue in the conversation opens the bot's one
    // conversation in the main pane, never the run's task in a column.
    const resultsButton = await page.locator("[data-run-open-results]").count();
    const proceed = page.locator("[data-run-continue]");
    if (await proceed.count()) {
      await proceed.first().click();
      await page.waitForTimeout(1_500);
      await page.screenshot({ path: join(outDir, `${prefix}-continue-${skin.label}.png`) });
      const side = await page.locator("[data-side-thread-header]").count();
      console.log(`${prefix} ${skin.label} continue: ${await page.locator("[data-gallery-sample]").getAttribute("data-gallery-sample")}, side column ${side ? "open" : "none"}, Open results thread ${resultsButton ? "shown" : "gone"}`);
    }
    await page.close();
  }
  // 2026-10-29: the action bars of a routine (bot panel, routine page) and
  // of a run's detail, at a desktop width and a narrow one.
  const routinesBase = `http://127.0.0.1:${port}/src/gallery/routines-ux.html`;
  const bars = [
    { name: "panel", query: "view=panel", width: 420, height: 760, selector: "[data-routine-detail-actions]" },
    { name: "panel-tight", query: "view=panel", width: 300, height: 760, selector: "[data-routine-detail-actions]" },
    { name: "routine-desktop", query: "view=routine", width: 1200, height: 760, selector: "[data-routine-actions]" },
    { name: "routine-narrow", query: "view=routine", width: 430, height: 820, selector: "[data-routine-actions]" },
    { name: "run-desktop", query: "view=run&case=completed", width: 1200, height: 760, selector: "[data-run-actions]" },
    { name: "run-narrow", query: "view=run&case=completed", width: 430, height: 820, selector: "[data-run-actions]" },
  ];
  for (const skin of skins) {
    for (const bar of bars) {
      const page = await browser.newPage({ viewport: { width: bar.width, height: bar.height }, deviceScaleFactor: 2 });
      await page.goto(`${routinesBase}?${bar.query}&skin=${skin.id}&width=${bar.width}&height=${bar.height}`, { waitUntil: "networkidle" });
      await page.locator(bar.selector).first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(outDir, `${prefix}-bar-${bar.name}-${skin.label}.png`) });
      await page.close();
    }
  }
} catch (error) {
  console.error(error);
  console.error(log.slice(-4000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* gone */ }
}
