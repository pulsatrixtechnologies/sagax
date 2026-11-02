#!/usr/bin/env node
/**
 * Headless screenshots of run-sheet step labels (V10): short runCommand
 * targets without UUIDs or full paths, folded tool searches. Synthetic
 * gallery only. Headless Chromium: no window opens.
 * Usage: node scripts/capture-step-labels.mjs [--out DIR] [--port N] [--prefix NAME]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "step-labels"));
const port = Number(arg("--port") ?? 5327);
const prefix = arg("--prefix") ?? "after";
const skins = [
  { id: "pulsatrix-light", label: "light" },
  { id: "pulsatrix", label: "dark" },
];

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {
      /* retry */
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const vite = spawn(
  "pnpm",
  ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, detached: true },
);
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/step-labels.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.SAGAX_VERIFY_BROWSER_CHROME
      ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME }
      : process.env.SAGAX_CHROMIUM
        ? { executablePath: process.env.SAGAX_CHROMIUM }
        : { channel: "chrome" }),
  });
  const page = await browser.newPage({ viewport: { width: 900, height: 1100 }, deviceScaleFactor: 2 });
  for (const { id, label } of skins) {
    await page.goto(`${base}?skin=${id}&lang=en`, { waitUntil: "load" });
    await page.waitForSelector('[data-shot="step-labels"]', { timeout: 60_000 });
    await page.waitForTimeout(400);
    await page.locator('[data-shot="step-labels"]').screenshot({ path: join(outDir, `${prefix}-${label}.png`) });
    await page.locator('[data-shot="run-sheet"]').screenshot({ path: join(outDir, `${prefix}-run-sheet-${label}.png`) });
    await page.locator('[data-shot="exchange"]').screenshot({ path: join(outDir, `${prefix}-exchange-${label}.png`) });
  }
  console.log(`screenshots in ${outDir} (prefix=${prefix})`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (log) console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* already gone */ }
}
