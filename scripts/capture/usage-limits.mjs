#!/usr/bin/env node
/**
 * Headless screenshots of Settings > Usage > Usage limits (#4445, Playwright,
 * no window): 1, 3 and 6 accounts (the sixth set has one account with no
 * short window), one account whose read failed, phone width, dark and light,
 * English and French, with the bots' usage group below as the neighbour.
 * Mocked accounts only; no server.
 * Usage: node scripts/capture/usage-limits.mjs [--out DIR] [--port N]
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "usage-limits-4445")));
const port = Number(arg("--port", "5197"));

const shots = [];
for (const lang of ["en", "fr"]) {
  for (const [skin, label] of [["pulsatrix", "dark"], ["daylight", "light"]]) {
    for (const accounts of [1, 3, 6]) shots.push({ skin, label, lang, query: `accounts=${accounts}`, name: `${accounts}-accounts` });
    shots.push({ skin, label, lang, query: "accounts=6&failed=1", name: "6-accounts-failed" });
    shots.push({ skin, label, lang, query: "accounts=6&failed=1&width=375", name: "phone", viewport: 407 });
  }
}

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Vite gallery did not start at ${url}`);
}

// vite itself, not through pnpm: a SIGTERM must reach the process that listens
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
  const base = `http://127.0.0.1:${port}/src/gallery/usage-limits.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM } : { channel: "chrome" }) });
  for (const { skin, label, lang, query, name, viewport } of shots) {
    const page = await browser.newPage({ viewport: { width: viewport ?? 760, height: 1800 }, deviceScaleFactor: 2 });
    await page.goto(`${base}?skin=${skin}&lang=${lang}&${query}`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-settings-group="usage-limits"]', { state: "attached", timeout: 60_000 });
    await page.waitForTimeout(300);
    const heights = await page.$$eval("[data-plan-row], [data-settings-row='cap-state']", (rows) => rows.map((row) => Math.round(row.getBoundingClientRect().height)));
    const path = join(outDir, `usage-limits-${name}-${lang}-${label}.png`);
    await page.locator('[data-gallery-sample="usage"]').screenshot({ path });
    console.log(`wrote ${path} rows=${heights.join(",")}`);
    await page.close();
  }
} catch (failure) {
  console.error(failure);
  console.error(viteLog.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
