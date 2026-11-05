#!/usr/bin/env node
/**
 * Headless screenshots of Connect Apps > Discover, then Browse Bots opened
 * from the Bots tab (Playwright, no window): the real panel in the gallery
 * (src/gallery/connect-apps.html?view=manage). Checks that Browse Bots keeps
 * Connect Apps' title and tab row where they are, and that the category
 * chips stay inside the window.
 * Usage: node scripts/capture/browse-bots-nav.mjs [--out DIR] [--port N]
 *   [--lang en] [--prefix after] [--width 1000] [--scheme dark|light]
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "browse-bots-nav")));
const port = Number(arg("--port", "5298"));
const lang = arg("--lang", "en");
const prefix = arg("--prefix", "after");
const width = Number(arg("--width", "1000"));
const scheme = arg("--scheme", "dark");
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
  await shot("1-connect-apps");
  const before = { title: await box("#plugins-title"), search: await box("[data-plugins-search]") };
  // Browse Bots is the Bots tab (2026-10-29): Discover has no button for it
  await page.click('[data-plugins-tab="bots"]');
  await page.waitForSelector("[data-bot-catalog-home]", { timeout: 30_000 });
  await page.waitForTimeout(800);
  await shot("2-browse-bots");
  const frame = await dialog.boundingBox();
  const after = { title: await box("#plugins-title"), search: await box("[data-catalog-search]") };
  const chips = await page.locator("[data-catalog-chip]").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().right));
  const chipsRight = Math.max(0, ...chips);
  console.log(JSON.stringify({ before, after, frameRight: frame && frame.x + frame.width, chipsRight }));
  if (strict) {
    if (!after.title || !before.title || Math.abs(after.title.y - before.title.y) > 0.5 || Math.abs(after.title.x - before.title.x) > 0.5) throw new Error("Connect Apps' title moved when Browse Bots opened");
    if (frame && chipsRight > frame.x + frame.width - 16) throw new Error("the category chips run past the window");
  }
  await page.click("[data-catalog-back]");
  await page.waitForSelector("[data-plugins-search]");
  await shot("3-back-to-connect-apps");
} catch (error) {
  console.error(error);
  console.error(viteLog.slice(-4000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
