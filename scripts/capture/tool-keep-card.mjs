#!/usr/bin/env node
/**
 * #4527 lot E: captures Settings > Developer > Per bot > Tool selection with
 * the tools a bot stopped listing up front (src/gallery/tool-keep-card.tsx),
 * French dark and English light, at 1280 and 390 wide: the card as before
 * (nothing left out), the new row closed, and open.
 *
 * Usage: node scripts/capture/tool-keep-card.mjs [--out DIR] [--port 5177]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "tool-keep-card")));
const port = Number(arg("--port", "5177"));
const looks = [{ skin: "pulsatrix", lang: "fr", label: "dark-fr" }, { skin: "pulsatrix-light", lang: "en", label: "light-en" }];
const states = [{ query: "&empty=1", label: "before" }, { query: "", label: "closed" }, { query: "&open=1", label: "open" }];

async function waitForServer(url, ms = 180_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const vite = spawn(
  process.execPath,
  [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" } },
);
vite.stdout.resume();
vite.stderr.resume();

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/tool-keep-card.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  for (const look of looks) {
    for (const width of [1280, 390]) {
      for (const state of states) {
        const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2, colorScheme: look.label.startsWith("dark") ? "dark" : "light" });
        page.on("pageerror", (error) => console.error("page error:", error.message));
        await page.goto(`${base}?skin=${look.skin}&lang=${look.lang}${state.query}`, { waitUntil: "networkidle" });
        await page.waitForSelector("[data-tool-groups]", { timeout: 60_000 });
        if (state.label !== "before") await page.waitForSelector('[data-tool-group="tool-keep"]', { timeout: 30_000 });
        if (state.label === "open") await page.waitForSelector('[data-tool-row="agents/list_rooms"]', { timeout: 30_000 });
        await page.waitForTimeout(400);
        await page.screenshot({ path: join(outDir, `${look.label}-${width}-${state.label}.png`), fullPage: true });
        console.log("shot", look.label, width, state.label);
        await page.close();
      }
    }
  }
} finally {
  await browser?.close();
  vite.kill();
}
