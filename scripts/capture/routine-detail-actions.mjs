#!/usr/bin/env node
/**
 * Headless screenshots of a routine page's action bar (2026-10-28): narrow
 * (icons) and wide (labels) panels, light and dark. Headless Chromium only.
 * Usage: node scripts/capture/routine-detail-actions.mjs [--out DIR] [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "routine-detail-actions"));
const port = Number(arg("--port") ?? 5297);
const skins = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];
const widths = [{ px: 300, label: "narrow" }, { px: 380, label: "medium" }, { px: 680, label: "wide" }];

const vite = spawn("pnpm", ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, detached: true,
});
let log = "";
vite.stdout?.on("data", (c) => { log += c; });
vite.stderr?.on("data", (c) => { log += c; });
let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/routine-detail-actions.html`;
  for (const start = Date.now(); ; await new Promise((d) => setTimeout(d, 500))) {
    try { if ((await fetch(base)).status < 500) break; } catch { /* retry */ }
    if (Date.now() - start > 120_000) throw new Error("gallery did not start");
  }
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  const page = await browser.newPage({ viewport: { width: 760, height: 460 }, deviceScaleFactor: 2 });
  for (const { id, label } of skins) for (const { px, label: size } of widths) {
    await page.goto(`${base}?skin=${id}&lang=fr&width=${px}`, { waitUntil: "load" });
    await page.waitForSelector("[data-routine-detail-actions]");
    await page.waitForTimeout(300);
    const info = await page.$$eval("[data-routine-detail-actions] button", (bs) => bs.map((b) => ({ label: b.getAttribute("aria-label"), text: b.textContent?.trim(), shown: b.querySelector("span") ? getComputedStyle(b.querySelector("span")).display !== "none" : false, w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) })));
    console.log(label, size, JSON.stringify(info));
    await page.screenshot({ path: join(outDir, `actions-${size}-${label}.png`) });
  }
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(error); console.error(log.slice(-4000)); process.exitCode = 1;
} finally {
  await browser?.close();
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* gone */ }
}
