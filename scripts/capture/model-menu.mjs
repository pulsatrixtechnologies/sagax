#!/usr/bin/env node
/**
 * Headless screenshots of the composer's model menu through the real
 * ModelPanel (gallery model-menu, real Chrome headless, DPR 2, no window):
 * the short menu (Auto, favorites, All models) and All models with its stars,
 * light and dark, English and French.
 * Usage: node scripts/capture/model-menu.mjs [--out DIR] [--port N] [--mode before|after]
 * Files: <mode>-<lang>-<theme>-<short|all|auto>.png
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "model-menu")));
const port = Number(arg("--port", "5343"));
const mode = arg("--mode", "after");

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
  const base = `http://127.0.0.1:${port}/src/gallery/model-menu.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 420, height: 640 }, deviceScaleFactor: 2 });
  for (const lang of ["en", "fr"]) {
    for (const theme of ["light", "dark"]) {
      for (const view of ["short", "all", "auto"]) {
        await page.goto(`${base}?lang=${lang}&theme=${theme}&view=${view === "auto" ? "short" : view}${view === "auto" ? "&auto=1" : ""}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(400);
        await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
        const file = join(outDir, `${mode}-${lang}-${theme}-${view}.png`);
        await page.locator("[data-model-menu]").screenshot({ path: file });
        console.log(file);
      }
    }
  }
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
