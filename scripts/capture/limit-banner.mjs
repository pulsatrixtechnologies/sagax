#!/usr/bin/env node
/**
 * Headless screenshots of the engine-limit banner + chat header bot pill
 * (gallery chat-notices.html?view=engine-limit). Synthetic data only.
 * Usage: node scripts/capture/limit-banner.mjs [--out DIR] [--port N]
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "limit-banner")));
const port = Number(arg("--port", "5297"));
const skins = [
  { id: "midnight", label: "dark" },
  { id: "daylight", label: "light" },
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
  const base = `http://127.0.0.1:${port}/src/gallery/chat-notices.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const launch = process.env.SAGAX_VERIFY_BROWSER_CHROME || process.env.SAGAX_CHROMIUM
    ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME || process.env.SAGAX_CHROMIUM }
    : {};
  browser = await chromium.launch({ headless: true, ...launch });
  const page = await browser.newPage({ viewport: { width: 900, height: 480 }, deviceScaleFactor: 2 });
  for (const { id, label } of skins) {
    await page.goto(`${base}?lang=en&skin=${id}&view=engine-limit`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-testid=engine-limit-notice]");
    await page.waitForSelector("[data-bot-header-pill]");
    // No stray High under the bot pill.
    const stray = await page.evaluate(() => {
      const header = document.querySelector("[data-bot-header-pill]")?.parentElement;
      return header ? /(?:^|[^a-z])High(?:[^a-z]|$)/i.test(header.textContent ?? "") : false;
    });
    if (stray) throw new Error(`stray High under bot pill (${label})`);
    const file = join(outDir, `engine-limit-${label}.png`);
    await page.locator("[data-gallery]").screenshot({ path: file });
    console.log(file);
  }
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
