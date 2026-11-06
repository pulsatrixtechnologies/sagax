#!/usr/bin/env node
/**
 * Headless screenshot of the App icon picker (src/gallery/app-icon-picker.html)
 * at 1480x900, and a click on a character icon that must reach the desktop
 * bridge. Headless Chromium only: no window opens.
 * Usage: node scripts/capture/app-icon-picker.mjs [--out DIR] [--port N] [--choice character:ghost]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "app-icon-picker")));
const port = Number(arg("--port", "5195"));
const choice = arg("--choice", "character:ghost");

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const vite = spawn(
  process.execPath,
  [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" } },
);
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/app-icon-picker.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  for (const skin of [{ id: "pulsatrix-light", label: "light" }, { id: "pulsatrix", label: "dark" }]) {
    const page = await browser.newPage({ viewport: { width: 1480, height: 900 }, deviceScaleFactor: 1, colorScheme: skin.label });
    page.on("pageerror", (error) => console.error("page error:", error.stack));
    await page.route("**/api/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not in this gallery" }) }));
    await page.goto(`${base}?skin=${skin.id}`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelectorAll("[data-app-icon] img").length >= 33, null, { timeout: 60_000 });
    const ids = await page.$$eval("[data-app-icon]", (nodes) => nodes.map((node) => node.getAttribute("data-app-icon")));
    console.log(skin.label, ids.length, "tiles:", ids.slice(-11).join(","));
    await page.click(`[data-app-icon="${choice}"]`);
    await page.waitForFunction(() => window.__appIconSet, null, { timeout: 30_000 });
    console.log("bridge.set:", JSON.stringify(await page.evaluate(() => window.__appIconSet)));
    await page.mouse.move(0, 0);
    await page.locator("[data-app-icon-picker]").screenshot({ path: join(outDir, `app-icon-picker-${skin.label}.png`), animations: "disabled" });
    await page.close();
  }
} catch (error) {
  console.error(error);
  console.error(log);
  process.exitCode = 1;
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
