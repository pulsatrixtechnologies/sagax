#!/usr/bin/env node
/**
 * Headless screenshots of Browse Bots' xAI Bot Marketplace section
 * (src/gallery/bot-catalog-xai.html): the home before the source and with
 * it, its full list, an error, and a bot's import preview, light and dark.
 * Usage: node scripts/capture/bot-catalog-xai.mjs --out DIR [--port N]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "bot-catalog-xai"));
const port = Number(arg("--port") ?? 5293);
const skins = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];
const views = [
  { name: "before-home", q: "view=home&xai=0" },
  { name: "after-home", q: "view=home" },
  { name: "after-all", q: "view=all" },
  { name: "after-error", q: "view=home&state=error" },
  { name: "after-detail", q: "view=detail" },
];

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
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

try {
  const base = `http://127.0.0.1:${port}/src/gallery/bot-catalog-xai.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  try {
    for (const { id, label } of skins) {
      for (const shot of views) {
        const page = await browser.newPage({ viewport: { width: 1100, height: 860 }, deviceScaleFactor: 2 });
        await page.goto(`${base}?lang=fr&skin=${id}&${shot.q}`, { waitUntil: "load" });
        await page.waitForSelector("[data-gallery-frame] [data-bot-catalog-home], [data-gallery-frame] [data-bot-catalog-detail]");
        await page.waitForTimeout(600);
        if (shot.name !== "before-home" && shot.name !== "after-detail") {
          await page.evaluate(() => document.querySelector('[data-catalog-section="xai"]')?.scrollIntoView({ block: "start" }));
          await page.waitForTimeout(150);
        }
        await page.screenshot({ path: join(outDir, `${shot.name}-${label}.png`) });
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(log);
  throw error;
} finally {
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* already gone */ }
}
