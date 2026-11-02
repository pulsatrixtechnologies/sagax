#!/usr/bin/env node
/**
 * Headless screenshots of bot-panel pushed pages (2026-11-01, lot 3):
 * panel sample, instructions, activity detail, history, skill review.
 * Gallery src/gallery/bot-panel-pages.html (synthetic data only).
 * Light and dark, desktop 1280 and narrow 700. Headless Chromium only.
 * Usage: node scripts/capture/bot-panel-pages.mjs [--out DIR] [--port N] [--prefix before|after]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "bot-panel-pages"));
const port = Number(arg("--port") ?? 5333);
const prefix = arg("--prefix") ?? "after";
const skins = [{ id: "pulsatrix-light", label: "light" }, { id: "pulsatrix", label: "dark" }];
const sizes = [{ width: 1280, height: 800, label: "desktop" }, { width: 700, height: 860, label: "narrow" }];
const views = ["panel", "instructions", "activity", "history", "skill"];

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
  const base = `http://127.0.0.1:${port}/src/gallery/bot-panel-pages.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}),
  });
  for (const size of sizes) {
    const page = await browser.newPage({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2 });
    page.on("pageerror", (error) => console.error("page error:", error.stack));
    for (const skin of skins) for (const view of views) {
      if (size.label === "narrow" && skin.label === "light") continue;
      const url = `${base}?view=${view}&width=${size.width}&height=${size.height}&skin=${skin.id}&lang=en`;
      await page.goto(url, { waitUntil: "load" });
      await page.waitForSelector("[data-gallery-sample]");
      await page.waitForTimeout(900);
      const file = join(outDir, `${prefix}-${view}-${size.label}-${skin.label}.png`);
      await page.screenshot({ path: file });
      console.log(file);
    }
    await page.close();
  }
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (log) console.error(log.slice(-4000));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* gone */ }
}
