#!/usr/bin/env node
/**
 * Headless screenshots (#0867, Playwright channel chrome, no window): a bot on
 * a second Claude instance that shares the first one's login keeps the quiet
 * weekly-limit dot beside the model picker, never a banner above the chat.
 * Gallery chat-notices.html?view=folded-instance-limit, synthetic data only.
 * Usage: node scripts/capture/folded-instance-limit.mjs [--out DIR] [--port N] [--tag after]
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "folded-instance-limit-0867")));
const port = Number(arg("--port", "5186"));
const tag = arg("--tag", "after");
const skins = [
  { id: "midnight", label: "dark" },
  { id: "daylight", label: "light" },
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
  const base = `http://127.0.0.1:${port}/src/gallery/chat-notices.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 760, height: 320 }, deviceScaleFactor: 2 });
  for (const { id, label } of skins) {
    await page.goto(`${base}?lang=en&skin=${id}&view=folded-instance-limit`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-gallery-model-chip]");
    await page.waitForTimeout(400);
    const dot = page.locator("[data-testid=engine-limit-indicator]");
    const shown = await dot.count();
    if (shown) await dot.click();
    if (await page.locator("[data-notice]").count()) throw new Error(`a banner was rendered (${label})`);
    const file = join(outDir, `folded-instance-limit-${tag}-${label}.png`);
    await page.locator("[data-gallery]").screenshot({ path: file });
    console.log(`${file} dot=${shown ? "yes" : "no"}`);
  }
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
