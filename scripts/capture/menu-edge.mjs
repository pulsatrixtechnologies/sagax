#!/usr/bin/env node
/**
 * Headless captures of menus opened at the window's right edge with long
 * names (#4183, src/gallery/menu-edge): the bot panel's Computer "..." menu
 * with a long computer name, and the conversation menu's Move to folder page
 * with long folder names, light and dark, English and French. Each capture
 * also reports whether the menu stays inside the window. Headless Chromium
 * only: no window opens.
 * Usage: node scripts/capture/menu-edge.mjs [--out DIR] [--port N] [--prefix before|after]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "menu-edge"));
const port = Number(arg("--port") ?? 5312);
const prefix = arg("--prefix") ?? "after";
const skins = [{ id: "pulsatrix-light", label: "light" }, { id: "pulsatrix", label: "dark" }];
const cases = [{ id: "computer", menu: "[data-computer-card-menu]" }, { id: "move", menu: "[data-thread-menu]" }];

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

let browser;
const report = [];
try {
  const base = `http://127.0.0.1:${port}/src/gallery/menu-edge.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, channel: process.env.SAGAX_CAPTURE_CHANNEL ?? "chrome" });
  for (const skin of skins) for (const lang of ["en", "fr"]) for (const sample of cases) {
    const page = await browser.newPage({ viewport: { width: 900, height: 560 }, deviceScaleFactor: 2 });
    await page.goto(`${base}?skin=${skin.id}&lang=${lang}&case=${sample.id}`, { waitUntil: "networkidle" });
    const menu = page.locator(sample.menu).first();
    await menu.waitFor({ timeout: 60_000 });
    await page.waitForTimeout(500);
    const box = await menu.boundingBox();
    const cut = await menu.evaluate((element) => [...element.querySelectorAll("span, button")].some((node) => node.scrollWidth > node.clientWidth + 1));
    report.push({ sample: sample.id, scheme: skin.label, lang, left: box?.x, right: box ? box.x + box.width : null, width: box?.width, inside: box ? box.x >= 0 && box.x + box.width <= 900 : false, cut });
    await page.screenshot({ path: join(outDir, `${prefix}-${sample.id}-edge-${skin.label}-${lang}.png`) });
    await page.close();
  }
  console.log(JSON.stringify(report, null, 1));
  console.log(`captures in ${outDir}`);
} catch (error) {
  console.error(error);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* gone */ }
}
