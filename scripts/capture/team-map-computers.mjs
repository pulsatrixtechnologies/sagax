#!/usr/bin/env node
/**
 * Headless screenshots (Playwright, real Chrome channel, no window) of the Add
 * computer modal opened from the Team map computer button and from Remote
 * sessions, at 900 and 420 px. The two modals must be identical.
 * Usage: node scripts/capture/team-map-computers.mjs [--out DIR] [--port N]
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "team-map-computers")));
const port = Number(arg("--port", "5293"));

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
console.log(`vite pid ${vite.pid}`);
let browser;
try {
  const origin = `http://127.0.0.1:${port}/src/gallery`;
  await waitForServer(`${origin}/team-map.html`);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ channel: "chrome" });
  for (const width of [900, 420]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
    await page.goto(`${origin}/team-map.html?dialog=computers&lang=en&width=${width}&height=900`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-add-computer-os]", { timeout: 30_000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(outDir, `team-map-${width}.png`) });
    await page.goto(`${origin}/remote-sessions-admin.html?dialog=add&lang=en`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-add-computer-os]", { timeout: 30_000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(outDir, `remote-sessions-${width}.png`) });
    await page.close();
  }
  console.log(`captures in ${outDir}`);
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
