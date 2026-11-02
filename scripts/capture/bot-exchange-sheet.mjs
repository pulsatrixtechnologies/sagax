#!/usr/bin/env node
/**
 * Headless screenshots of an open bot-to-bot conversation (gallery
 * bot-exchange-sheet, Playwright, no window) at three widths (narrow,
 * medium, very wide) in a dark and a light skin.
 * Usage: node scripts/capture/bot-exchange-sheet.mjs [--out DIR] [--port N] [--mode before|after]
 * Files: <mode>-<width>-<scheme>.png
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "bot-exchange-sheet")));
const port = Number(arg("--port", "5297"));
const mode = arg("--mode", "after");
const skins = [{ id: "pulsatrix", label: "dark" }, { id: "pulsatrix-light", label: "light" }];
const widths = [{ width: 560, label: "narrow" }, { width: 1100, label: "medium" }, { width: 1800, label: "wide" }];

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
  const base = `http://127.0.0.1:${port}/src/gallery/bot-exchange-sheet.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM } : {});
  for (const { width, label: size } of widths) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
    for (const { id, label } of skins) {
      await page.goto(`${base}?skin=${id}`, { waitUntil: "networkidle" });
      await page.waitForSelector("[data-testid=bot-exchange-sheet]");
      const file = join(outDir, `${mode}-${size}-${label}.png`);
      await page.screenshot({ path: file });
      console.log(file);
    }
    await page.close();
  }
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
