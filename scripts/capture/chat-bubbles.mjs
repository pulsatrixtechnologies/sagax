#!/usr/bin/env node
/**
 * Headless screenshots of the chat-bubbles gallery (Playwright, no window):
 * the person's bubble in the accent and the bot's in grey, in a dark and a
 * light skin, over several accents. No server beyond the gallery's own Vite.
 * Usage: node scripts/capture/chat-bubbles.mjs [--out DIR] [--port N] [--mode before|after] [--gallery bot]
 * --gallery bot: my bubble in a bot's colour on Studio (Midnight dark, Daylight light), files bot-<mode>-<scheme>.png.
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "chat-bubbles")));
const port = Number(arg("--port", "5294"));
const mode = arg("--mode", "after");
const gallery = arg("--gallery", "");
const skins = gallery === "bot"
  ? [{ id: "midnight", label: "dark" }, { id: "daylight", label: "light" }]
  : [{ id: "pulsatrix", label: "dark" }, { id: "pulsatrix-light", label: "light" }];
const pageName = gallery === "bot" ? "chat-bubbles-bot" : "chat-bubbles";
const prefix = gallery === "bot" ? "bot-" : "";

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
  const base = `http://127.0.0.1:${port}/src/gallery/${pageName}.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1 });
  for (const { id, label } of skins) {
    await page.goto(`${base}?skin=${id}&mode=${mode}`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-gallery]");
    const file = join(outDir, `${prefix}${mode}-${label}.png`);
    await page.locator("[data-gallery]").screenshot({ path: file });
    console.log(file);
  }
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
