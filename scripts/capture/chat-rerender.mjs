#!/usr/bin/env node
/**
 * Headless screenshots of a long chat through the real ChatView (gallery
 * chat-rerender, Playwright, no window), #3323: English and French, idle and
 * with the last turn running, next to the neighbour gallery ask-line (the
 * same ChatView with bot-to-bot rows).
 * Usage: node scripts/capture/chat-rerender.mjs [--out DIR] [--port N] [--mode before|after]
 * Files: <mode>-<skin>-<width>-<lang>-<idle|running>.png, neighbour-<skin>-<width>-<lang>.png
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "chat-rerender")));
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
  const base = `http://127.0.0.1:${port}/src/gallery`;
  await waitForServer(`${base}/chat-rerender.html`);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const shoot = async (url, file, width, skin) => {
    const page = await browser.newPage({ viewport: { width, height: 1300 }, deviceScaleFactor: 2, colorScheme: skin === "daylight" ? "light" : "dark" });
    page.on("pageerror", (error) => console.error(String(error)));
    await page.goto(`${url}&skin=${skin}`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-mid]", { timeout: 30_000 });
    await page.waitForTimeout(900);
    await page.screenshot({ path: join(outDir, file) });
    await page.close();
    console.log(file);
  };
  for (const skin of ["daylight", "pulsatrix"]) {
    for (const width of [1200, 700, 390]) {
      for (const lang of ["en", "fr"]) {
        for (const busy of [false, true]) {
          await shoot(`${base}/chat-rerender.html?lang=${lang}&turns=12${busy ? "&busy=1" : ""}`, `${mode}-${skin}-${width}-${lang}-${busy ? "running" : "idle"}.png`, width, skin);
        }
        if (mode === "after") await shoot(`${base}/ask-line.html?lang=${lang}&n=5&state=done&tools=1`, `neighbour-${skin}-${width}-${lang}.png`, width, skin);
      }
    }
  }
} finally {
  await browser?.close();
  vite.kill();
}
