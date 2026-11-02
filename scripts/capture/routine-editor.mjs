#!/usr/bin/env node
/**
 * Headless screenshots of "Edit routine" (2026-10-29): the editor on a clock
 * routine and on a webhook routine, desktop and narrow, light and dark; the
 * routine page's webhook and Edit bot's webhook list. Headless Chromium only.
 * Usage: node scripts/capture/routine-editor.mjs [--out DIR] [--port N] [--prefix NAME]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "routine-editor"));
const prefix = arg("--prefix") ?? "after";
const port = Number(arg("--port") ?? 5313);
const skins = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];
const sizes = [{ width: 1280, height: 900, label: "desktop" }, { width: 420, height: 900, label: "narrow" }];
const shots = [
  { query: "view=editor&trigger=clock", label: "editor-clock", full: false },
  { query: "view=editor&trigger=clock&more=1", label: "editor-clock-tall", full: false, tall: true },
  { query: "view=editor&trigger=webhook", label: "editor-webhook", full: false },
  { query: "view=page&trigger=webhook", label: "page-webhook", full: true },
  { query: "view=bot", label: "bot-webhooks", full: true },
  { query: "view=panel&trigger=clock", label: "panel-routine", full: false },
  { query: "view=panel&trigger=clock", label: "panel-run", full: false, click: "[data-run-row]" },
];

const vite = spawn("pnpm", ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, detached: true,
});
let log = "";
vite.stdout?.on("data", (c) => { log += c; });
vite.stderr?.on("data", (c) => { log += c; });
let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/routine-editor.html`;
  for (const start = Date.now(); ; await new Promise((d) => setTimeout(d, 500))) {
    try { if ((await fetch(base)).status < 500) break; } catch { /* retry */ }
    if (Date.now() - start > 120_000) throw new Error("gallery did not start");
  }
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  for (const { width, height, label: size } of sizes) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, timezoneId: "America/Toronto", locale: "fr-CA" });
    for (const { id, label } of skins) for (const shot of shots) {
      await page.setViewportSize({ width, height: shot.tall ? 2200 : height });
      await page.goto(`${base}?skin=${id}&lang=fr&${shot.query}`, { waitUntil: "load" });
      if (shot.tall) {
        await page.waitForSelector("[data-routine-editor-more]");
        await page.evaluate(() => document.querySelector("[data-routine-editor-more]")?.setAttribute("open", ""));
      }
      await page.waitForSelector(shot.full || shot.query.includes("view=panel") ? "[data-gallery-card]" : "[role=dialog]", { state: "visible" });
      if (shot.click) { await page.waitForSelector(shot.click); await page.click(shot.click); }
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(outDir, `${prefix}-${shot.label}-${size}-${label}.png`), fullPage: shot.full });
      console.log(size, label, shot.label);
    }
    await page.close();
  }
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(error); console.error(log.slice(-4000)); process.exitCode = 1;
} finally {
  await browser?.close();
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* gone */ }
}
