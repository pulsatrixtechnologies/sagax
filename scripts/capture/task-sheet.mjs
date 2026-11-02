#!/usr/bin/env node
/**
 * Headless screenshots of a task's sheet (src/gallery/task-sheet.html):
 * light and dark, desktop width and a narrow window. Headless Chromium
 * only: no window opens.
 * Usage: node scripts/capture/task-sheet.mjs [--out DIR] [--port N] [--prefix NAME] [--lang fr]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "task-sheet"));
const port = Number(arg("--port") ?? 5321);
const prefix = arg("--prefix") ?? "task-sheet";
const lang = arg("--lang") ?? "fr";
const skins = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];
const widths = [{ label: "desktop", width: 1180, height: 820 }, { label: "narrow", width: 430, height: 860 }];

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const vite = spawn("pnpm", ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" },
  detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/task-sheet.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  for (const { label: size, width, height } of widths) {
    for (const { id, label } of skins) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
      await page.goto(`${base}?skin=${id}&lang=${lang}`, { waitUntil: "load" });
      await page.waitForSelector("[data-activity-detail]");
      await page.waitForTimeout(1_200);
      await page.screenshot({ path: join(outDir, `${prefix}-${lang}-${size}-${label}.png`) });
      await page.close();
    }
  }
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (log) console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* already gone */ }
}
