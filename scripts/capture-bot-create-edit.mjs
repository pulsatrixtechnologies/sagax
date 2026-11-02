#!/usr/bin/env node
/**
 * Headless screenshots of lot 4 creation/edit views (2026-11-01):
 * quick create, template step, zip import step, edit bot, bulk edit, team bot.
 * Gallery src/gallery/bot-create-edit.html (synthetic data only).
 * Light and dark, desktop 1280, mid 700, narrow 390. Headless Chromium only.
 * Usage: node scripts/capture-bot-create-edit.mjs [--out DIR] [--port N] [--prefix before|after]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "bot-create-edit"));
const port = Number(arg("--port") ?? 5344);
const prefix = arg("--prefix") ?? "after";
const skins = [{ id: "pulsatrix-light", label: "light" }, { id: "pulsatrix", label: "dark" }];
const sizes = [
  { width: 1280, height: 800, label: "desktop" },
  { width: 700, height: 860, label: "mid" },
  { width: 390, height: 844, label: "narrow" },
];
/** Base gallery view, then optional click into a wizard sub-step. */
const views = [
  { id: "quick", gallery: "quick" },
  { id: "template", gallery: "quick", click: '[data-wizard-other="template"]', wait: "[data-wizard-template], [data-new-bot-form]" },
  { id: "import-zip", gallery: "quick", click: '[data-wizard-other="import-zip"]', wait: '[data-wizard-import="zip"], [data-bot-zip-import]' },
  { id: "edit", gallery: "edit", wait: "[data-persona-editor]" },
  { id: "bulk", gallery: "bulk", wait: "[data-bulk-edit-view], [data-bulk-edit]" },
  { id: "teambot", gallery: "teambot", wait: "[data-teambot-from-thread]" },
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

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/bot-create-edit.html`;
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
      // Skip light+narrow combo to keep the set smaller (same as lot 3).
      if (size.label === "narrow" && skin.label === "light") continue;
      if (size.label === "mid" && skin.label === "light" && view.id !== "quick" && view.id !== "edit") continue;
      const url = `${base}?view=${view.gallery}&width=${size.width}&height=${size.height}&skin=${skin.id}&lang=en`;
      await page.goto(url, { waitUntil: "load" });
      await page.waitForSelector("[data-gallery-sample]");
      if (view.click) {
        await page.waitForSelector(view.click, { timeout: 15_000 });
        await page.click(view.click);
      }
      if (view.wait) {
        await page.waitForSelector(view.wait, { timeout: 15_000 });
      } else {
        await page.waitForSelector("[data-bot-wizard-screen], [data-persona-editor], [data-bulk-edit], [data-teambot-from-thread]", { timeout: 15_000 });
      }
      await page.waitForTimeout(700);
      // Vite's error overlay can paint AbortError noise from cancelled fetches.
      await page.evaluate(() => { document.querySelector("vite-error-overlay")?.remove(); });
      const file = join(outDir, `${prefix}-${view.id}-${size.label}-${skin.label}.png`);
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
