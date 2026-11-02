#!/usr/bin/env node
/**
 * Headless screenshots of the routine run exchange footer (gallery
 * routine-run-exchange). Synthetic data only. No visible window.
 * Usage: node scripts/capture-routine-run-exchange-footer.mjs [--out DIR] [--port N] [--mode before|after]
 * Files: <mode>-<status>-<width>-<scheme>.png
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "routine-run-exchange-footer")));
const port = Number(arg("--port", "5317"));
const mode = arg("--mode", "after");
const skins = [{ id: "pulsatrix", label: "dark" }, { id: "pulsatrix-light", label: "light" }];
const widths = [{ width: 420, label: "narrow" }, { width: 960, label: "wide" }];
const statuses = ["completed", "running"];

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Vite gallery did not start at ${url}`);
}

const vite = spawn(
  process.execPath,
  [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" } },
);
let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/routine-run-exchange.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM } : {}),
  });
  for (const status of statuses) {
    for (const { width, label: size } of widths) {
      const page = await browser.newPage({ viewport: { width, height: 820 }, deviceScaleFactor: 1 });
      for (const { id, label } of skins) {
        await page.goto(`${base}?skin=${id}&status=${status}`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector("[data-testid=routine-run-exchange]", { timeout: 60_000 });
        await page.waitForSelector("[data-routine-run-actions]", { timeout: 60_000 });
        await new Promise((r) => setTimeout(r, 400));
        // Scroll the transcript to the bottom so the last bubble meets the footer.
        await page.locator("[data-testid=bot-exchange-scroll]").evaluate((node) => {
          node.scrollTop = node.scrollHeight;
        });
        const file = join(outDir, `${mode}-${status}-${size}-${label}.png`);
        await page.screenshot({ path: file });
        console.log(file);
      }
      await page.close();
    }
  }
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
