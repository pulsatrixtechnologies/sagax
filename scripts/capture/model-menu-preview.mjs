#!/usr/bin/env node
/**
 * Headless screenshots of the model menu provider preview (#2181, #2709):
 * 4 models per provider, "Show more (N)", and the model in use kept visible
 * past the first 4 (gallery model-menu-preview.html). Synthetic data only.
 * Usage: node scripts/capture/model-menu-preview.mjs [--out DIR] [--port N]
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "model-menu-preview")));
const port = Number(arg("--port", "5195"));
const skins = [
  { id: "pulsatrix", label: "pulsatrix" },
  { id: "daylight", label: "daylight" },
];

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

const vite = spawn(
  process.execPath,
  [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" } },
);
let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/model-menu-preview.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const launch = process.env.SAGAX_VERIFY_BROWSER_CHROME || process.env.SAGAX_CHROMIUM
    ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME || process.env.SAGAX_CHROMIUM }
    : {};
  browser = await chromium.launch({ headless: true, ...launch });
  const page = await browser.newPage({ viewport: { width: 520, height: 860 }, deviceScaleFactor: 2 });
  for (const { id, label } of skins) {
    // The 8th Claude model is in use: it must show among the visible rows.
    await page.goto(`${base}?lang=en&skin=${id}&active=7`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-gallery-menu] [role=option]");
    await page.waitForTimeout(400);
    const seen = await page.evaluate(() => document.querySelector("[data-gallery-menu]")?.textContent ?? "");
    if (!seen.includes("Claude Sonnet 4.6")) throw new Error(`active model past 4 not shown (${label})`);
    const file = join(outDir, `picker-submenu-active-beyond4-${label}.png`);
    await page.locator("[data-gallery-menu]").screenshot({ path: file });
    console.log(file);
  }
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
