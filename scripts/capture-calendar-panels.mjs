#!/usr/bin/env node
/**
 * Headless screenshots of the Automations calendar without modals
 * (2026-11-01, lot 1 of docs: /Users/Workspace/plans/2026-11-01-sagax-ux-no-modals.md):
 * the week grid, quick create on an empty slot, a routine's details, a
 * calendar call's details, the editor opened from the details and the paused
 * routines list. Gallery `src/gallery/routines-ux.html?view=calendar` (ten
 * neutral fictional routines, one call; the gallery answers /api itself).
 * Headless Chromium only: no window opens. Light and dark, desktop and narrow.
 * Usage: node scripts/capture-calendar-panels.mjs [--out DIR] [--port N] [--prefix before|after]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "calendar-panels"));
const port = Number(arg("--port") ?? 5299);
const prefix = arg("--prefix") ?? "after";
const skins = [{ id: "pulsatrix-light", label: "light" }, { id: "pulsatrix", label: "dark" }];
const sizes = [{ width: 1280, height: 800, label: "desktop" }, { width: 430, height: 860, label: "narrow" }];

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

/** Each step starts from a fresh calendar and leaves one surface open. */
const steps = [
  { name: "calendar", run: async () => {} },
  { name: "quick-create", run: async (page) => {
    const cells = page.locator('[role="gridcell"]');
    const count = await cells.count();
    const cell = cells.nth(Math.min(2, count - 1));
    await cell.scrollIntoViewIfNeeded();
    const box = await cell.boundingBox();
    // An empty slot about a third down the visible part of the column.
    const view = await page.evaluate(() => ({ h: window.innerHeight }));
    const y = Math.min(box.y + box.height - 10, Math.max(box.y + 10, view.h * 0.45));
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(400);
    await page.keyboard.type("Draft the weekly summary");
  } },
  { name: "routine-details", run: async (page) => {
    await page.locator("[data-event-card]").filter({ hasText: /briefing|sweep|Backup/ }).first().click();
  } },
  { name: "call-details", run: async (page) => {
    await page.locator("[data-event-card]").filter({ hasText: "Weekly sync" }).first().click();
  } },
  { name: "edit-from-details", run: async (page) => {
    await page.locator("[data-event-card]").filter({ hasText: /briefing|sweep|Backup/ }).first().click();
    await page.waitForTimeout(500);
    const edit = page.locator('[data-routine-configure], button:has-text("Edit")').first();
    await edit.click();
  } },
  { name: "paused", run: async (page) => {
    await page.locator('summary[aria-label="Automation menu"], [aria-label="Automation menu"]').first().click();
    await page.waitForTimeout(250);
    await page.locator('[aria-label="View paused routines"]').first().click();
  } },
];

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
  for (const size of sizes) {
    const page = await browser.newPage({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2 });
    page.on("pageerror", (error) => console.error("page error:", error.stack));
    for (const skin of skins) for (const step of steps) {
      if (size.label === "narrow" && skin.label === "light") continue;
      await page.goto(`${base}?view=calendar&width=${size.width}&height=${size.height}&skin=${skin.id}&lang=en`, { waitUntil: "load" });
      await page.waitForSelector("[data-gallery-sample]");
      await page.waitForTimeout(1500);
      try {
        await step.run(page);
      } catch (error) {
        console.error(`${step.name} (${size.label}, ${skin.label}): ${error.message.split("\n")[0]}`);
      }
      await page.waitForTimeout(700);
      const file = join(outDir, `${prefix}-${step.name}-${size.label}-${skin.label}.png`);
      await page.screenshot({ path: file });
      console.log(file);
    }
    await page.close();
  }
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(error); console.error(log.slice(-4000)); process.exitCode = 1;
} finally {
  await browser?.close();
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* gone */ }
}
