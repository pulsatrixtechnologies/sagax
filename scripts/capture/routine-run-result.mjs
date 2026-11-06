#!/usr/bin/env node
/**
 * Headless screenshots of a finished routine's report in the chat (#2081):
 * src/gallery/routine-run-cards.html?scene=report, light and dark, with a
 * normal bot reply above it for comparison, plus the all-states scene and the
 * unified scene (#2096, #2098: Stop on the live card, a question answered in
 * place, the report in the chat).
 * Headless Chromium only: no window opens.
 * Usage: node scripts/capture/routine-run-result.mjs [--out DIR] [--port N] [--tag before|after]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "routine-run-result"));
const port = Number(arg("--port") ?? 5207);
const tag = arg("--tag") ?? "after";
const skins = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];

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
  const base = `http://127.0.0.1:${port}/src/gallery/routine-run-cards.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  const page = await browser.newPage({ viewport: { width: 900, height: 1500 }, deviceScaleFactor: 2 });
  for (const { id, label } of skins) {
    await page.goto(`${base}?skin=${id}&scene=report&width=900&height=1500`, { waitUntil: "load" });
    await page.waitForSelector("[data-routine-run-card] table");
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(outDir, `${tag}-report-${label}.png`) });
    await page.goto(`${base}?skin=${id}&width=900&height=1500`, { waitUntil: "load" });
    await page.waitForSelector('[data-routine-run-card][data-routine-run-state="running"]');
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(outDir, `${tag}-states-${label}.png`) });
    await page.goto(`${base}?skin=${id}&scene=unified&width=900&height=1500`, { waitUntil: "load" });
    await page.waitForSelector("[data-run-stop]");
    await page.waitForSelector("[data-attention-reply]");
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(outDir, `${tag}-unified-${label}.png`) });
  }
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(error);
  console.error(log.slice(-4000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* gone */ }
}
