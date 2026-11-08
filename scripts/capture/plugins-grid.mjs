#!/usr/bin/env node
/**
 * Headless screenshots of Plugins as a card grid (Playwright channel chrome,
 * no window): Manage (Installed, scrolled), Discover and This Mac, light and
 * dark, wide, medium and narrow. Also reports whether the title row and its
 * pills sit fully under the back bar, at rest and scrolled.
 * Usage: node scripts/capture/plugins-grid.mjs [--root DIR] [--out DIR]
 *   [--port N] [--prefix after]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const root = resolve(arg("--root", here));
const outDir = resolve(arg("--out", join(here, "docs", "screenshots", "plugins-grid")));
const port = Number(arg("--port", "5191"));
const prefix = arg("--prefix", "after");

async function waitForServer(url, ms = 180_000) {
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

/** The title row's top and the back bar's bottom: the title must start under the bar. */
async function headerReport(page) {
  return page.evaluate(() => {
    const bar = document.querySelector("[data-plugins-manage-bar]")?.getBoundingClientRect();
    const list = document.querySelector('[data-plugins-list][data-plugins-manage="installed"]')?.getBoundingClientRect();
    const title = document.getElementById("plugins-title")?.getBoundingClientRect();
    const cols = getComputedStyle(document.querySelector("[data-plugins-installed] ul") ?? document.body).gridTemplateColumns;
    return { barBottom: bar?.bottom, listTop: list?.top, titleTop: title?.top, titleBottom: title?.bottom, columns: cols.split(" ").length };
  });
}

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery`;
  await waitForServer(`${base}/connect-apps.html`);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  for (const scheme of ["light", "dark"]) {
    const skin = scheme === "light" ? "pulsatrix-light" : "pulsatrix";
    for (const [label, width] of [["wide", 1280], ["medium", 860], ["narrow", 420]]) {
      const page = await browser.newPage({ viewport: { width, height: 820 }, deviceScaleFactor: 2, colorScheme: scheme });
      page.on("pageerror", (error) => console.error("page error:", error.stack));
      await page.goto(`${base}/connect-apps.html?view=manage&skin=${skin}&lang=en`, { waitUntil: "networkidle" });
      await page.waitForSelector("[data-plugins-main]", { timeout: 60_000 });
      // Plugins opens on its home (Discover): "N connected" leads to Manage.
      if (!(await page.locator('[data-plugins-manage="installed"]').count())) await page.click("[data-plugins-connected]");
      await page.waitForSelector('[data-plugins-manage="installed"]', { timeout: 30_000 });
      await page.waitForTimeout(800);
      const dialog = page.locator('[role="dialog"]').first();
      const shot = async (name) => {
        await page.waitForTimeout(500);
        const file = join(outDir, `${prefix}-${name}-${label}-${scheme}.png`);
        await dialog.screenshot({ path: file });
        console.log("shot", file);
      };
      console.log(JSON.stringify({ label, scheme, state: "rest", ...(await headerReport(page)) }));
      await shot("installed");
      const showAll = page.locator("[data-plugins-show-all]");
      if (await showAll.count()) { await showAll.first().click(); }
      await page.locator('[data-plugins-list][data-plugins-manage="installed"]').evaluate((node) => { node.scrollTop = 120; });
      console.log(JSON.stringify({ label, scheme, state: "scrolled", ...(await headerReport(page)) }));
      await shot("installed-scrolled");
      await page.click("[data-plugins-home]");
      await page.waitForSelector('[data-plugins-manage="discover"]');
      await shot("discover");
      await page.close();

      const mac = await browser.newPage({ viewport: { width, height: 700 }, deviceScaleFactor: 2, colorScheme: scheme });
      await mac.goto(`${base}/this-mac-grid.html?skin=${skin}&lang=en&width=${width - 40}`, { waitUntil: "networkidle" });
      await mac.waitForSelector("[data-gallery-ready]");
      await mac.waitForTimeout(400);
      const file = join(outDir, `${prefix}-this-mac-${label}-${scheme}.png`);
      await mac.locator("[data-gallery-ready]").screenshot({ path: file });
      console.log("shot", file);
      await mac.close();
    }
  }
} catch (error) {
  console.error(error);
  console.error(viteLog.slice(-4000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
