#!/usr/bin/env node
/**
 * Headless screenshots of native controls on a dark skin and a gradient tint
 * (#1507): an open native list, a dropdown, a date field, and an accent
 * button enabled and disabled. Playwright, no window. No server.
 * Usage: node scripts/capture/native-controls.mjs [--out DIR] [--prefix before-] [--port N]
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "native-controls")));
const port = Number(arg("--port", "5294"));
const prefix = arg("--prefix", "");

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch { /* retry */ }
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
  const base = `http://127.0.0.1:${port}/src/gallery/native-controls.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM, headless: true } : { headless: true });
  for (const [name, query] of [["dark", "skin=pulsatrix"], ["cyberpunk", "skin=pulsatrix&tint=cyberpunk"], ["light", "skin=daylight"]]) {
    // The OS asks for light, as on the reported machines: the skin decides.
    const page = await browser.newPage({ viewport: { width: 520, height: 420 }, deviceScaleFactor: 2, colorScheme: "light" });
    await page.goto(`${base}?${query}`, { waitUntil: "networkidle" });
    const target = page.locator("[data-gallery-card]");
    await target.waitFor();
    await page.waitForTimeout(300);
    const file = join(outDir, `${prefix}${name}.png`);
    await target.screenshot({ path: file });
    console.log(file);
    await page.close();
  }
} catch (error) {
  console.error(viteLog.slice(-2000));
  throw error;
} finally {
  await browser?.close().catch(() => {});
  vite.kill("SIGTERM");
}
