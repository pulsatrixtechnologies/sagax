#!/usr/bin/env node
/**
 * Headless screenshots of Connect Apps (Playwright, no window): Discover and
 * Installed, light and dark, desktop and narrow width. Shows the search on the
 * scope's line, no Browse Bots button, and Providers inside Installed.
 * Usage: node scripts/capture/connect-apps-tidy.mjs [--root DIR] [--out DIR]
 *   [--port N] [--prefix after]
 * --root runs the gallery of another checkout (for the "before" shots).
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
const outDir = resolve(arg("--out", join(here, "docs", "screenshots", "connect-apps-tidy")));
const port = Number(arg("--port", "5297"));
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

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/connect-apps.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM } : {});
  for (const scheme of ["light", "dark"]) {
    for (const [label, width] of [["wide", 1000], ["narrow", 420]]) {
      const skin = scheme === "light" ? "pulsatrix-light" : "pulsatrix";
      const page = await browser.newPage({ viewport: { width, height: 820 }, deviceScaleFactor: 2, colorScheme: scheme });
      page.on("pageerror", (error) => console.error("page error:", error.stack));
      await page.goto(`${base}?view=manage&skin=${skin}&lang=en`, { waitUntil: "networkidle" });
      await page.waitForSelector('[data-plugins-manage="discover"]', { timeout: 30_000 });
      const dialog = page.locator('[role="dialog"]').first();
      const shot = async (name) => {
        await page.waitForTimeout(700);
        const file = join(outDir, `${prefix}-${name}-${label}-${scheme}.png`);
        await dialog.screenshot({ path: file });
        console.log("shot", file);
      };
      await shot("discover");
      const tabs = await page.locator("[data-plugins-tab]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-plugins-tab")));
      console.log(JSON.stringify({ label, scheme, tabs, browseBots: await page.locator("[data-plugins-browse-bots]").count() }));
      await page.click('[data-plugins-tab="installed"]');
      await page.waitForSelector('[data-plugins-manage="installed"]');
      await shot("installed");
      const providers = page.locator("[data-plugins-providers]");
      if (await providers.count()) {
        await providers.first().scrollIntoViewIfNeeded();
        await shot("installed-providers");
      }
      await page.close();
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
