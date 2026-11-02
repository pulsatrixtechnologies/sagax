#!/usr/bin/env node
/**
 * Headless screenshots of Connect Apps' Bots tab and its one search
 * (2026-10-29), Playwright, no window: the real panel in the gallery
 * (src/gallery/connect-apps.html?view=manage, neutral names). Shots:
 * Discover, the Bots tab, a search with mixed results, a bot opened from
 * the results. --check fails when Connect Apps' title or tab row moves
 * between Discover and Bots, or the search finds fewer than three kinds.
 * Usage: node scripts/capture/bots-tab.mjs [--out DIR] [--port N]
 *   [--lang en] [--prefix after] [--width 1000] [--scheme dark|light]
 *   [--query week] [--check]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "bots-tab")));
const port = Number(arg("--port", "5299"));
const lang = arg("--lang", "en");
const prefix = arg("--prefix", "after");
const width = Number(arg("--width", "1000"));
const scheme = arg("--scheme", "dark");
const query = arg("--query", "week");
const skin = arg("--skin", scheme === "light" ? "pulsatrix-light" : "pulsatrix");
const strict = process.argv.includes("--check");

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { const res = await fetch(url); if (res.status < 500) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Vite gallery did not start at ${url}`);
}

const vite = spawn(
  process.execPath,
  [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" } },
);
let viteLog = "";
vite.stdout?.on("data", (c) => { viteLog += c; });
vite.stderr?.on("data", (c) => { viteLog += c; });

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/connect-apps.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width, height: 820 }, deviceScaleFactor: 2, colorScheme: scheme });
  page.on("pageerror", (error) => console.error("page error:", error.stack));
  await page.goto(`${base}?view=manage&skin=${skin}&lang=${lang}`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-plugins-manage="discover"]', { timeout: 30_000 });
  const dialog = page.locator('[role="dialog"]').first();
  const shot = async (name) => {
    await page.waitForTimeout(700);
    const file = join(outDir, `${prefix}-${name}.png`);
    await dialog.screenshot({ path: file });
    console.log("shot", file);
  };
  const box = async (selector) => (await page.locator(selector).first().boundingBox()) ?? null;
  await shot("1-discover");
  const before = { title: await box("#plugins-title"), tabs: await box("[data-plugins-manage-tabs]") };
  await page.click('[data-plugins-tab="bots"]');
  await page.waitForSelector("[data-bot-catalog-home]", { timeout: 30_000 });
  await page.waitForSelector("[data-catalog-row]", { timeout: 30_000 });
  await shot("2-bots-tab");
  const after = { title: await box("#plugins-title"), tabs: await box("[data-plugins-manage-tabs]") };
  await page.fill("[data-plugins-search]", query);
  await page.waitForSelector("[data-plugins-search-group]", { timeout: 30_000 });
  await page.waitForTimeout(600);
  await page.keyboard.press("ArrowDown");
  await shot("3-search-mixed");
  const groups = await page.locator("[data-plugins-search-group]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-plugins-search-group")));
  const bot = page.locator('[data-plugins-search-group="bots"] [role="option"]').first();
  if (await bot.count()) {
    await bot.click();
    await page.waitForSelector("[data-bot-catalog-detail]", { timeout: 30_000 });
    await shot("4-bot-from-search");
  }
  console.log(JSON.stringify({ before, after, groups }));
  if (strict) {
    const moved = (a, b) => !a || !b || Math.abs(a.y - b.y) > 0.5 || Math.abs(a.x - b.x) > 0.5;
    if (moved(before.title, after.title)) throw new Error("Connect Apps' title moved on the Bots tab");
    if (moved(before.tabs, after.tabs)) throw new Error("the tab row moved on the Bots tab");
    if (groups.length < 3) throw new Error(`the search found ${groups.length} kinds, expected 3 or more`);
  }
} catch (error) {
  console.error(error);
  console.error(viteLog.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  vite.kill();
}
