#!/usr/bin/env node
/**
 * Headless screenshots for page-window Always on top (#2046):
 * before (no item / unchecked path) and after (menu with Always on top checked).
 * Gallery src/gallery/page-viewer.html. Headless Chromium only.
 * Usage: node scripts/capture/page-always-on-top.mjs [--out DIR] [--port N] [--prefix before|after]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "page-always-on-top"));
const port = Number(arg("--port") ?? 5186);
const prefix = arg("--prefix") ?? "after";

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
try {
  const base = `http://127.0.0.1:${port}/src/gallery/page-viewer.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 }, deviceScaleFactor: 2 });
  page.on("pageerror", (error) => console.error("page error:", error.stack));

  // panel mode: more menu has no Always on top (conversation surface)
  await page.goto(`${base}?lang=en&skin=pulsatrix&menu=1&status=published`, { waitUntil: "load" });
  await page.waitForSelector("[data-page-more]");
  await page.waitForTimeout(700);
  await page.locator("[data-page-more]").click();
  await page.waitForTimeout(300);
  const panelMenu = join(outDir, `${prefix}-panel-menu-en.png`);
  await page.screenshot({ path: panelMenu });
  console.log(panelMenu);

  // own window: Always on top off
  await page.goto(`${base}?lang=en&skin=pulsatrix&window=1&menu=1&status=published`, { waitUntil: "load" });
  await page.waitForSelector("[data-page-always-on-top]", { timeout: 10_000 });
  await page.waitForTimeout(400);
  const off = join(outDir, `${prefix}-window-menu-off-en.png`);
  await page.screenshot({ path: off });
  console.log(off);

  // own window: Always on top on
  await page.goto(`${base}?lang=en&skin=pulsatrix&window=1&menu=1&ontop=1&status=published`, { waitUntil: "load" });
  await page.waitForSelector("[data-page-always-on-top][aria-checked=true]", { timeout: 10_000 });
  await page.waitForTimeout(400);
  const on = join(outDir, `${prefix}-window-menu-on-en.png`);
  await page.screenshot({ path: on });
  console.log(on);

  // French label
  await page.goto(`${base}?lang=fr&skin=pulsatrix&window=1&menu=1&ontop=1&status=published`, { waitUntil: "load" });
  await page.waitForSelector("[data-page-always-on-top][aria-checked=true]", { timeout: 10_000 });
  await page.waitForTimeout(400);
  const fr = join(outDir, `${prefix}-window-menu-on-fr.png`);
  await page.screenshot({ path: fr });
  console.log(fr);

  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (log) console.error(log.slice(-4000));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* gone */ }
}
