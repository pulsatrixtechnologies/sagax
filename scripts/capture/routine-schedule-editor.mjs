#!/usr/bin/env node
/**
 * Headless screenshots of the routine editor's schedule (2026-10-29):
 * desktop and narrow, light and dark, a weekday routine at three times and
 * one no model fits (Advanced). Headless Chromium only.
 * Usage: node scripts/capture/routine-schedule-editor.mjs [--out DIR] [--port N] [--prefix NAME]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "routine-schedule-editor"));
const prefix = arg("--prefix") ?? "after";
const port = Number(arg("--port") ?? 5311);
const skins = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];
const sizes = [{ width: 1280, height: 900, label: "desktop" }, { width: 420, height: 900, label: "narrow" }];
const samples = [{ cron: "30 8,12,16 * * 1-5", label: "weekdays" }, { cron: "15 9-17/2 * * 1-5", label: "advanced" }];

const vite = spawn("pnpm", ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, detached: true,
});
let log = "";
vite.stdout?.on("data", (c) => { log += c; });
vite.stderr?.on("data", (c) => { log += c; });
let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/routine-schedule-editor.html`;
  for (const start = Date.now(); ; await new Promise((d) => setTimeout(d, 500))) {
    try { if ((await fetch(base)).status < 500) break; } catch { /* retry */ }
    if (Date.now() - start > 120_000) throw new Error("gallery did not start");
  }
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  for (const { width, height, label: size } of sizes) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, timezoneId: "America/Toronto", locale: "fr-CA" });
    for (const { id, label } of skins) for (const sample of samples) {
      await page.goto(`${base}?skin=${id}&lang=fr&cron=${encodeURIComponent(sample.cron)}`, { waitUntil: "load" });
      await page.waitForSelector("[role=dialog]", { state: "visible" });
      await page.waitForTimeout(400);
      const schedule = await page.$("[data-schedule-section]");
      if (schedule) await schedule.scrollIntoViewIfNeeded();
      const text = await page.locator("[role=dialog]").first().textContent({ timeout: 10_000 }) ?? "";
      console.log(size, label, sample.label, /cron/i.test(text) ? "MENTIONS CRON" : "no cron text");
      await page.screenshot({ path: join(outDir, `${prefix}-${sample.label}-${size}-${label}.png`) });
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
