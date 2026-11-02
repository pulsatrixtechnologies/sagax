#!/usr/bin/env node
/**
 * Headless screenshots of a routine's row menu and its rename in place
 * (2026-10-29), in the bot panel (src/gallery/routines-ux.html?view=panel,
 * back to the list) and the Automations list, light and dark. Headless
 * Chromium only: no window opens; the gallery answers /api itself.
 * Usage: node scripts/capture/routine-menu.mjs [--out DIR] [--port N] [--prefix before|after]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "routine-menu"));
const port = Number(arg("--port") ?? 5301);
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
  const base = `http://127.0.0.1:${port}/src/gallery/routines-ux.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  for (const skin of skins) {
    // the bot panel: back from the routine's page to the list, then a row's menu
    let page = await browser.newPage({ viewport: { width: 420, height: 760 }, deviceScaleFactor: 2 });
    await page.goto(`${base}?view=panel&skin=${skin.id}&width=420&height=760`, { waitUntil: "networkidle" });
    // the gallery opens a routine's page first: back to the list
    await page.locator("[data-routine-detail-header]").waitFor({ timeout: 120_000 });
    await page.locator("[data-routine-detail-header] button").first().click();
    const row = page.locator("[data-routine-row]").first();
    await row.waitFor({ timeout: 60_000 });
    await row.click({ button: "right", position: { x: 40, y: 12 } });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(outDir, `${prefix}-panel-menu-${skin.label}.png`) });
    const rename = page.locator('[data-routine-action="rename"]');
    if (await rename.count()) {
      await rename.click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(outDir, `${prefix}-panel-rename-${skin.label}.png`) });
    }
    await page.close();
    // the Automations list
    page = await browser.newPage({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: 2 });
    await page.goto(`${base}?view=list&skin=${skin.id}&width=1200&height=760`, { waitUntil: "networkidle" });
    const listRow = page.locator("[data-routine-row]").first();
    await listRow.waitFor({ timeout: 120_000 });
    await listRow.click({ button: "right", position: { x: 60, y: 12 } });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(outDir, `${prefix}-list-menu-${skin.label}.png`) });
    await page.close();
  }
} catch (error) {
  console.error(error);
  console.error(log.slice(-4000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* gone */ }
}
