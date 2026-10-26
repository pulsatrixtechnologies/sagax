#!/usr/bin/env node
/**
 * Headless screenshots of Browse Bots' bot profile (src/gallery/bot-catalog-detail.html):
 * every tab, light and dark, wide and narrow, plus the empty states.
 * Usage: node scripts/capture-bot-catalog-detail.mjs --out DIR [--prefix before|after] [--port N]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "bot-catalog-detail"));
const prefix = arg("--prefix") ?? "after";
const port = Number(arg("--port") ?? 5291);
const skins = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];
const tabs = ["soul", "memories", "skills", "routines", "integrations"];

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
  const base = `http://127.0.0.1:${port}/src/gallery/bot-catalog-detail.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  const shots = [];
  for (const { id, label } of skins) {
    for (const tab of tabs) shots.push({ name: `${prefix}-${tab}-${label}-wide`, q: `skin=${id}&tab=${tab}`, size: { width: 1000, height: 780 } });
    shots.push({ name: `${prefix}-soul-${label}-narrow`, q: `skin=${id}&tab=soul&w=420`, size: { width: 440, height: 780 } });
    shots.push({ name: `${prefix}-skills-${label}-narrow`, q: `skin=${id}&tab=skills&w=420`, size: { width: 440, height: 780 } });
    for (const tab of ["soul", "memories", "skills"]) shots.push({ name: `${prefix}-${tab}-empty-${label}`, q: `skin=${id}&tab=${tab}&empty=1`, size: { width: 1000, height: 780 } });
    shots.push({ name: `${prefix}-soul-${label}-bottom`, q: `skin=${id}&tab=soul`, size: { width: 1000, height: 780 }, scroll: true });
    shots.push({ name: `${prefix}-memories-private-${label}`, q: `skin=${id}&tab=memories&private=1`, size: { width: 1000, height: 780 } });
  }
  for (const shot of shots) {
    const page = await browser.newPage({ viewport: shot.size, deviceScaleFactor: 2 });
    await page.goto(`${base}?lang=fr&${shot.q}`, { waitUntil: "load" });
    await page.waitForSelector("[data-gallery-frame] [data-bot-catalog-detail]");
    await page.waitForTimeout(500);
    if (shot.scroll) {
      await page.evaluate(() => { const pane = document.querySelector("[data-bot-catalog-detail]"); if (pane) pane.scrollTop = pane.scrollHeight; });
      await page.waitForTimeout(150);
    }
    await page.screenshot({ path: join(outDir, `${shot.name}.png`) });
    await page.close();
  }
  await browser.close();
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(error);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  try { process.kill(-vite.pid, "SIGTERM"); } catch { vite.kill("SIGTERM"); }
}
