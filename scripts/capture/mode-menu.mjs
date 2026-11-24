#!/usr/bin/env node
/**
 * Headless screenshots of the composer's mode menu (#4900, #5088;
 * M-20261123-040, M-20261123-045, M-20261123-047) through the gallery
 * src/gallery/mode-menu.tsx (real composer, chip, ModelPanel with its modes
 * and real menu sections): the rows (Auto, Fast, Expert, Heavy, Build,
 * Reasoning, All models) with a tooltip, Reasoning greyed under a mode that
 * sets its own level, the reasoning levels, and each step of All models
 * (providers, accounts, models, a provider with one account going straight
 * to its models), a pinned model. Real Chrome headless, DPR 2, no window.
 * Usage: node scripts/capture/mode-menu.mjs [--out DIR] [--port N] [--lang en|fr]
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
const lang = arg("--lang", "en");
const english = lang === "en";
// `steps`: the rows a person clicks, in order, before the shot
const shots = [
  { name: "01-menu-auto", query: "mode=auto" },
  { name: "02-menu-fast-tooltip", query: "mode=auto&hover=fast", tip: english ? "Quick responses · Grok 4 Fast" : undefined },
  { name: "03-menu-expert-reasoning-imposed", query: "mode=expert" },
  { name: "04-menu-build", query: "mode=build&hover=build", tip: english ? "A model made for code · Grok Code 2" : undefined },
  { name: "05-reasoning-levels", query: "mode=auto", steps: ['[data-mode-row="reasoning"]'] },
  { name: "06-all-models-providers", query: "mode=auto", steps: ['[data-mode-row="all"]'] },
  { name: "07-all-models-accounts", query: "mode=auto", steps: ['[data-mode-row="all"]', '[data-model-cascade-provider="anthropic"]'] },
  { name: "08-all-models-models", query: "mode=auto", steps: ['[data-mode-row="all"]', '[data-model-cascade-provider="anthropic"]', "[data-model-cascade-account] >> nth=1"] },
  { name: "09-all-models-single-account", query: "mode=auto", steps: ['[data-mode-row="all"]', '[data-model-cascade-provider="xai"]'] },
  { name: "10-all-models-local", query: "mode=auto", steps: ['[data-mode-row="all"]', '[data-model-cascade-provider="local"]'] },
  { name: "11-menu-pinned", query: "mode=pinned" },
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
      await page.goto(`${base}?lang=${lang}&skin=${id}&${shot.query}`, { waitUntil: "networkidle" });
      await page.waitForSelector("[data-gallery-chip]");
      for (const step of shot.steps ?? []) await page.click(step);
      // nothing "Off" or "Signed out" is ever listed in the mode menu (M-20261123-047)
      const words = await page.evaluate(() => document.querySelector("[data-gallery-menu]")?.textContent ?? "");
      if (/Signed out|Déconnecté|\boff\b/i.test(words)) throw new Error(`${shot.name} (${label}): the menu lists something that cannot run: ${words}`);
      const hover = new URLSearchParams(shot.query).get("hover");
      if (hover) {
        await page.hover(`[data-mode-row="${hover}"]`);
        await page.waitForSelector(`[data-mode-tooltip="${hover}"]`);
        const text = await page.evaluate((mode) => document.querySelector(`[data-mode-tooltip="${mode}"]`)?.textContent ?? "", hover);
        if (shot.tip && text !== shot.tip) throw new Error(`${shot.name} (${label}): tooltip reads "${text}", expected "${shot.tip}"`);
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
