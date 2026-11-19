#!/usr/bin/env node
/**
 * Headless screenshots of the update marks of Connect Apps (#4504): the "N
 * updates" pill, the Update mark on a row, an update running, one that
 * failed (the item and why; the old version stays), the versions and notes on
 * an item's page, and "Updates first" in the sort. The real panel in the
 * gallery (?updates=1), no window, no server.
 * Usage: node scripts/capture/connect-apps-updates.mjs [--out DIR] [--port N]
 *   [--lang en|fr] [--scheme dark|light]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; };
const lang = arg("--lang", "en");
const scheme = arg("--scheme", "dark");
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "connect-apps-updates")));
const port = Number(arg("--port", "5200"));
const skin = scheme === "light" ? "pulsatrix-light" : "pulsatrix";
const tag = `1280x800-${scheme}-${lang}`;

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { const res = await fetch(url); if (res.status < 500) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Vite gallery did not start at ${url}`);
}

const vite = spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: root, stdio: "ignore", env: { ...process.env, NODE_ENV: "development" } });
let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/connect-apps.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM } : { channel: "chrome" }) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, colorScheme: scheme });
  const page = await context.newPage();
  const shot = async (name) => { await page.waitForTimeout(500); const file = join(outDir, `${name}-${tag}.png`); await page.screenshot({ path: file }); console.log("shot", file); };
  const open = async (mode) => {
    await page.goto(`${base}?view=manage&role=member&products=many&updates=${mode}&skin=${skin}&lang=${lang}`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-plugins-main]", { timeout: 30_000 });
    await page.click('[data-plugins-kind-tab="plugins"]');
    await page.waitForTimeout(500);
  };

  // the marks: the pill in the header, "Update" on the rows with one, none on the organization's
  await open("1");
  await shot("30-updates-marks-plugins");

  // the page of an item with an update: its versions (from, to) and the notes
  await page.locator('[data-installed-entry="plugin:code-review@claude-plugins-official"] button[aria-label]').first().click();
  await page.waitForTimeout(600);
  await shot("31-update-detail-versions-notes");

  // "Updates first" in the sort
  await open("1");
  await page.click("[data-plugins-sort-button]");
  await page.click('[data-plugins-sort-option="update"]');
  await page.click("[data-plugins-sort-button]");
  await shot("32-sort-menu-updates-first");
  await page.keyboard.press("Escape");

  // one row updating (slow answer): the row shows progress
  await open("slow");
  await page.locator('[data-installed-entry="plugin:code-review@claude-plugins-official"] [data-row-update]').click();
  await page.waitForTimeout(300);
  await shot("33-update-running-row");

  // update all: the failure names the item and why, the old version stays, the done ones lose their mark
  await open("1");
  await page.click("[data-plugins-update-all]");
  await page.waitForSelector("[data-update-failure]", { timeout: 10_000 });
  await shot("34-update-all-done-one-failed");

  // #475: a plugin the app updated by itself says so in one line, its routines follow
  await open("auto");
  await shot("35-auto-updated-line");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
