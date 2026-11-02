#!/usr/bin/env node
/**
 * Headless screenshots of Tools > Memory (2026-11-02):
 * src/gallery/memory-manager.html, French and English, light and dark.
 * Headless Chromium only: no window opens.
 * Usage: node scripts/capture-memory-manager.mjs [--out DIR] [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "memory-manager"));
const port = Number(arg("--port") ?? 5341);
const skins = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];
const views = ["sources", "browse", "note"];

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
  const base = `http://127.0.0.1:${port}/src/gallery/memory-manager.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  for (const lang of ["fr", "en"]) {
    for (const { id, label } of skins) {
      for (const view of views) {
        await page.goto(`${base}?skin=${id}&lang=${lang}&view=${view}`, { waitUntil: "load" });
        await page.waitForSelector('[data-memory-manager-panel]');
        await page.waitForSelector('[data-gallery-ready="1"]', { timeout: 15_000 }).catch(() => {});
        if (view === "note") {
          await page.waitForSelector("[data-memory-read-body], [data-memory-json-tree]", { timeout: 10_000 });
          await page.waitForFunction(() => {
            const text = document.querySelector("[data-memory-note]")?.textContent || "";
            return /Dining|Prefers|likes/i.test(text);
          }, { timeout: 10_000 }).catch(() => {});
        }
        if (view === "browse") {
          await page.waitForSelector("[data-memory-browse]", { timeout: 10_000 }).catch(() => {});
        }
        await page.waitForTimeout(400);
        await page.screenshot({ path: join(outDir, `memory-manager-${view}-${lang}-${label}.png`), fullPage: false });
      }
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
