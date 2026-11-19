#!/usr/bin/env node
/**
 * Headless screenshots of the composer's mode menu (#4900), dark and light,
 * beside the account menu (the conforming neighbour): the menu with each
 * mode's side tooltip, the chip reading "Expert", and the tooltips for a
 * person with one provider, three providers and only local models.
 * Synthetic data and demo providers only. Real Chrome headless, DPR 2.
 * Usage: node scripts/capture/mode-menu.mjs [--out DIR] [--port N]
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
const port = Number(arg("--port", "5197"));
const skins = [{ id: "pulsatrix", label: "dark" }, { id: "daylight", label: "light" }];
const shots = [
  { name: "menu-fast-tooltip", query: "case=menu&mode=expert&hover=fast&providers=1", tip: "Quick responses · Grok 4.7" },
  { name: "menu-expert-tooltip", query: "case=menu&mode=expert&hover=expert&providers=1", tip: "Thinks hard · Grok 4.7" },
  { name: "menu-heavy-tooltip", query: "case=menu&mode=expert&hover=heavy&providers=1", tip: "Team of Experts · Grok 4.7" },
  { name: "menu-heavy-three-providers", query: "case=menu&mode=heavy&hover=heavy&providers=3", tip: "Team of Experts · GPT-6 Astra, Claude Opus 5.5, Grok 4.7" },
  { name: "menu-build-tooltip", query: "case=menu&mode=build&hover=build&providers=3", tip: "Builds and codes · GPT-5.5 Codex" },
  { name: "menu-local-only-expert", query: "case=menu&mode=expert&hover=expert&providers=local", tip: "Thinks hard · Qwen3.5 122B A10B" },
  { name: "menu-pinned-model", query: "case=menu&mode=pinned&hover=auto&providers=1", tip: "Picks from the request" },
  { name: "composer-chip-expert", query: "case=chip&mode=expert&providers=1" },
  { name: "composer-chip-auto", query: "case=chip&mode=auto&providers=1" },
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
let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/mode-menu.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const exe = process.env.SAGAX_VERIFY_BROWSER_CHROME || process.env.SAGAX_CHROMIUM;
  browser = await chromium.launch({ headless: true, ...(exe ? { executablePath: exe } : {}) });
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 2 });
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
      const file = join(outDir, `${shot.name}-${label}.png`);
      await page.screenshot({ path: file });
      console.log(file);
    }
  }
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
