#!/usr/bin/env node
/**
 * Headless screenshots (2026-11-08): the proposal cards in the chat (a
 * learned skill, a routine), open and settled, and the composer's box for an
 * open skill. Light and dark, French and English, plus the SKILL.md
 * disclosure opened. Synthetic data only, no visible window, real Chrome
 * headless (channel chrome), its own Vite port (never 5173).
 * Usage: node scripts/capture/proposal-cards.mjs [--out DIR] [--port N]
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "proposal-cards")));
const port = Number(arg("--port", "5197"));
const skins = [{ id: "pulsatrix", label: "dark" }, { id: "pulsatrix-light", label: "light" }];

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch { /* retry */ }
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
  const origin = `http://127.0.0.1:${port}/src/gallery`;
  await waitForServer(`${origin}/proposal-cards.html`);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  for (const { id, label } of skins) {
    for (const lang of ["fr", "en"]) {
      const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2 });
      await page.goto(`${origin}/proposal-cards.html?skin=${id}&lang=${lang}`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("[aria-label]", { timeout: 60_000 });
      await new Promise((r) => setTimeout(r, 600));
      const file = join(outDir, `proposal-cards-${lang}-${label}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log(file);
      const toggle = page.locator("[data-skill-md-toggle]").first();
      if (await toggle.count()) {
        await toggle.click();
        await new Promise((r) => setTimeout(r, 300));
        const openFile = join(outDir, `proposal-cards-${lang}-${label}-skillmd-open.png`);
        await page.screenshot({ path: openFile, fullPage: true });
        console.log(openFile);
      }
      await page.close();
    }
  }
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
