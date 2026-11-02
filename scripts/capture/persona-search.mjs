#!/usr/bin/env node
/**
 * Headless screenshots of the Edit bot modal and its search box, from
 * src/gallery/persona-search.html, in a light and a dark skin. Shots per
 * query: the modal as it opens (no query), then a French word and an English
 * word leading to a page. Headless Chromium only: no window opens.
 * Usage: node scripts/capture/persona-search.mjs [--out DIR] [--port N]
 *   [--prefix before|after] [--queries "mascotte,engine,zzzxq"]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "persona-search")));
const port = Number(arg("--port", "5312"));
const prefix = arg("--prefix", "after");
const queries = arg("--queries", "mascotte,engine,zzzxq").split(",");
const skins = [{ id: "pulsatrix-light", label: "light" }, { id: "pulsatrix", label: "dark" }];

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
let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/persona-search.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  for (const skin of skins) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 2, colorScheme: skin.label });
    page.on("pageerror", (error) => console.error("page error:", error.stack));
    for (const query of ["", ...queries]) {
      await page.goto(`${base}?skin=${skin.id}&lang=en`, { waitUntil: "networkidle" });
      await page.waitForSelector("[data-persona-modal]", { timeout: 60_000 });
      await page.waitForTimeout(600);
      const field = page.locator("[data-persona-search]");
      if (field.count && prefix === "after" && await field.count()) {
        if (query) { await field.fill(query); await page.waitForTimeout(500); }
      } else if (query) continue; // before: the box does not exist
      const file = join(outDir, `${prefix}-${query || "open"}-${skin.label}.png`);
      await page.locator("[data-persona-modal]").screenshot({ path: file });
      console.log("shot", file);
    }
    await page.close();
  }
} finally {
  await browser?.close();
  vite.kill();
}
