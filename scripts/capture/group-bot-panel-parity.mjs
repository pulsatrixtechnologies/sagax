#!/usr/bin/env node
/**
 * Headless screenshots that put the real bot panel beside the real group panel
 * (src/gallery/group-bot-panel-parity.html), light and dark, so the two right
 * panels can be read as one design: each tab of the group panel (Members with
 * Advanced folded, then opened) and each tab of the bot panel. Headless
 * Chromium only: no window opens.
 * Usage: node scripts/capture/group-bot-panel-parity.mjs [--out DIR] [--port N]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "group-bot-panel-parity"));
const port = Number(arg("--port") ?? 5191);
const skins = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];

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
  const base = `http://127.0.0.1:${port}/src/gallery/group-bot-panel-parity.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  const page = await browser.newPage({ viewport: { width: 1160, height: 1000 }, deviceScaleFactor: 2 });
  for (const { id, label } of skins) {
    await page.goto(`${base}?skin=${id}&lang=fr`, { waitUntil: "load" });
    await page.waitForSelector("[data-parity-row]");
    await page.waitForTimeout(400);
    await page.locator("[data-parity-row]").screenshot({ path: join(outDir, `side-by-side-${label}.png`) });
    const groupPanel = page.locator("[data-ref-group]");
    const botPanel = page.locator("[data-ref-bot]");
    for (const tab of ["details", "members", "instructions", "memory", "library", "computer"]) {
      const button = groupPanel.locator(`[data-panel-tab="${tab}"]`);
      if (!(await button.count())) continue;
      await button.click();
      await page.waitForTimeout(300);
      await groupPanel.screenshot({ path: join(outDir, `group-${tab}-${label}.png`) });
      if (tab === "members") {
        await groupPanel.locator("[data-group-advanced-toggle]").click();
        await page.waitForTimeout(200);
        await groupPanel.screenshot({ path: join(outDir, `group-members-advanced-open-${label}.png`) });
      }
    }
    for (const tab of ["details", "library", "computer"]) {
      const button = botPanel.locator(`[data-panel-tab="${tab}"]`);
      if (!(await button.count())) continue;
      await button.click();
      await page.waitForTimeout(300);
      await botPanel.screenshot({ path: join(outDir, `bot-${tab}-${label}.png`) });
    }
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
