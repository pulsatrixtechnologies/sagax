#!/usr/bin/env node
/**
 * Headless screenshots of the routine views (src/gallery/routines-ux.html):
 * the Automations list, calendar and run logs, a routine's page, a run's
 * detail (completed with a table, waiting for an approval, failed, running)
 * and the bot panel's routine page, light and dark, at a desktop width and a
 * narrow one. Headless Chromium only: no window opens; the gallery answers
 * /api itself.
 * Usage: node scripts/capture/routines-ux.mjs [--out DIR] [--port N] [--prefix before|after]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "routines-ux"));
const port = Number(arg("--port") ?? 5298);
const prefix = arg("--prefix") ?? "after";
const skins = [{ id: "pulsatrix-light", label: "light" }, { id: "pulsatrix", label: "dark" }];
const sizes = [{ width: 1200, height: 760, label: "desktop" }, { width: 430, height: 820, label: "narrow" }];
const views = [
  { name: "list", query: "view=list" },
  { name: "calendar", query: "view=calendar" },
  { name: "logs", query: "view=logs" },
  { name: "routine", query: "view=routine" },
  { name: "run-completed", query: "view=run&case=completed" },
  { name: "run-waiting", query: "view=run&case=waiting" },
  { name: "run-failed", query: "view=run&case=failed" },
  { name: "run-running", query: "view=run&case=running" },
  { name: "panel", query: "view=panel" },
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
  const base = `http://127.0.0.1:${port}/src/gallery/routines-ux.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  for (const size of sizes) {
    const page = await browser.newPage({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2 });
    page.on("pageerror", (error) => console.error("page error:", error.stack));
    for (const skin of skins) for (const view of views) {
      await page.goto(`${base}?${view.query}&width=${size.width}&height=${size.height}&skin=${skin.id}&lang=en`, { waitUntil: "load" });
      await page.waitForSelector("[data-gallery-sample], [data-gallery-panel]");
      await page.waitForTimeout(1800);
      const file = join(outDir, `${prefix}-${view.name}-${size.label}-${skin.label}.png`);
      await page.screenshot({ path: file });
      console.log(file);
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
