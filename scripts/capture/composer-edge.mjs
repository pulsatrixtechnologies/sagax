#!/usr/bin/env node
/**
 * Headless captures of the composer's edge beside the account menu's
 * (src/gallery/composer-edge): idle, focused, + menu open, model menu open,
 * pinned card, each with the account menu open beside it. Headless Chrome only.
 * Usage: node scripts/capture/composer-edge.mjs [--out DIR] [--port N] [--prefix before|after]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "composer-edge"));
const port = Number(arg("--port") ?? 5179);
const prefix = arg("--prefix") ?? "after";
const runs = [
  { skin: "pulsatrix", scheme: "dark", lang: "fr" }, { skin: "pulsatrix-light", scheme: "light", lang: "en" },
  { skin: "foundry", scheme: "dark2", lang: "en" }, { skin: "atelier", scheme: "light2", lang: "en" },
];
const cases = ["idle", "focus", "plus", "model", "pinned"];
const widths = [1280, 390];

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const vite = spawn("pnpm", ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, detached: true,
});
console.error(`vite pid ${vite.pid}`);
let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/composer-edge.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, channel: process.env.SAGAX_CAPTURE_CHANNEL ?? "chrome" });
  for (const run of runs) for (const width of widths) for (const sample of cases) {
    const page = await browser.newPage({ viewport: { width, height: width > 600 ? 640 : 760 }, deviceScaleFactor: 2 });
    await page.goto(`${base}?skin=${run.skin}&lang=${run.lang}&case=${sample}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(outDir, `${prefix}-${sample}-${run.scheme}-${run.lang}-${width}.png`) });
    await page.close();
  }
} finally {
  await browser?.close();
  try { process.kill(-vite.pid); } catch { /* gone */ }
}
