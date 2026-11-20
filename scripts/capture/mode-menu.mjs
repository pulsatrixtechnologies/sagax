#!/usr/bin/env node
/**
 * Headless screenshots of the composer's mode menu (#4900, #5088) through the
 * gallery src/gallery/mode-menu.tsx (real composer, chip, ModelPanel with its
 * modes and real menu sections): the modes with a tooltip, Heavy chosen,
 * Manual's list of every model by provider and account (a signed-out one
 * included), a pinned model. Real Chrome headless, DPR 2, no window.
 * Usage: node scripts/capture/mode-menu.mjs [--out DIR] [--port N]
 * Files: <shot>-<dark|light>.png
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "mode-menu")));
const port = Number(arg("--port", "5387"));
const skins = [{ id: "pulsatrix", label: "dark" }, { id: "daylight", label: "light" }];
const shots = [
  { name: "menu-auto-fast-tooltip", query: "mode=auto&hover=fast", tip: "Quick responses · Grok 4 Fast" },
  { name: "menu-heavy-tooltip", query: "mode=heavy&hover=heavy", tip: "Team of Experts · GPT-6 Astra, Claude Fable 5.2, Claude Opus 5.5, Grok 4.7" },
  { name: "menu-manual-pinned", query: "mode=manual" },
  { name: "manual-list", query: "mode=manual&view=all" },
  { name: "manual-list-scrolled", query: "mode=manual&view=all&scroll=1" },
];

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
// drain Vite's output: a full pipe stalls the dev server mid-page
vite.stdout.resume();
vite.stderr.resume();
let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/mode-menu.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 900, height: 760 }, deviceScaleFactor: 2 });
  for (const { id, label } of skins) {
    for (const shot of shots) {
      await page.goto(`${base}?lang=en&skin=${id}&${shot.query}`, { waitUntil: "networkidle" });
      await page.waitForSelector("[data-gallery-chip]");
      const hover = new URLSearchParams(shot.query).get("hover");
      if (hover) {
        await page.hover(`[data-mode-row="${hover}"]`);
        await page.waitForSelector(`[data-mode-tooltip="${hover}"]`);
        const text = await page.evaluate((mode) => document.querySelector(`[data-mode-tooltip="${mode}"]`)?.textContent ?? "", hover);
        if (shot.tip && text !== shot.tip) throw new Error(`${shot.name} (${label}): tooltip reads "${text}", expected "${shot.tip}"`);
      }
      if (new URLSearchParams(shot.query).get("scroll")) {
        await page.evaluate(() => { const list = document.querySelector("[data-model-panel-scroll]"); if (list) list.scrollTop = list.scrollHeight; });
      }
      const file = join(outDir, `${shot.name}-${label}.png`);
      await page.screenshot({ path: file });
      console.log(file);
    }
  }
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
