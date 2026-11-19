#!/usr/bin/env node
/**
 * Headless screenshots of a question card's facts table (gallery ask-facts,
 * real Chrome, no window): the ordinary question card, the same ticket card
 * without facts (before) and with them (after), light and dark, French.
 * Usage: node scripts/capture/ask-facts.mjs [--out DIR] [--port N]
 * Files: ask-facts-<light|dark>.png
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "ask-facts")));
const port = Number(arg("--port", "5347"));

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      if ((await fetch(url)).status < 500) return;
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
  const base = `http://127.0.0.1:${port}/src/gallery/ask-facts.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 640 }, deviceScaleFactor: 2 });
  for (const [name, skin] of [["light", "pulsatrix-light"], ["dark", "pulsatrix"]]) {
    await page.goto(`${base}?lang=fr&skin=${skin}`);
    await page.waitForSelector('[data-variant="after"] [data-ask-facts]');
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(outDir, `ask-facts-${name}.png`) });
    console.log(`wrote ask-facts-${name}.png`);
  }
} finally {
  await browser?.close();
  vite.kill();
}
