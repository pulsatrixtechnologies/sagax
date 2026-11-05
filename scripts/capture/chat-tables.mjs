#!/usr/bin/env node
/**
 * Headless screenshots of the chat-tables gallery (Playwright, no window):
 * Disk Saver routines table and a peer Field/Value/Confidence table, in dark
 * and light skins, before and after the readability fix.
 * Usage: node scripts/capture/chat-tables.mjs [--out DIR] [--port N]
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "chat-tables")));
const port = Number(arg("--port", "5297"));
const skins = [
  { id: "midnight", label: "dark" },
  { id: "daylight", label: "light" },
];
const modes = ["before", "after"];

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
  const base = `http://127.0.0.1:${port}/src/gallery/chat-tables.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch(
    process.env.SAGAX_CHROMIUM
      ? { executablePath: process.env.SAGAX_CHROMIUM, headless: true }
      : { channel: "chrome", headless: true },
  );
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 1 });
  for (const mode of modes) {
    for (const { id, label } of skins) {
      await page.goto(`${base}?skin=${id}&mode=${mode}`, { waitUntil: "networkidle" });
      await page.waitForSelector("[data-gallery]");
      // Let ResizeObserver paint overflow fades on the after tables.
      if (mode === "after") {
        await page.waitForFunction(() => {
          const scrolls = [...document.querySelectorAll("[data-table-scroll]")];
          return scrolls.length > 0 && scrolls.every((el) => el.scrollWidth >= el.clientWidth);
        });
        await page.waitForTimeout(100);
      }
      const file = join(outDir, `${mode}-${label}.png`);
      await page.locator("[data-gallery]").screenshot({ path: file });
      console.log(file);
    }
  }
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
