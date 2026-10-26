#!/usr/bin/env node
/**
 * Headless screenshots of the chat-annotations gallery (Playwright, no window):
 * the reply-to quote above a bot's answer, and the routine change chips, in the
 * dark and the light skin. No server; nothing opens.
 * Usage: node scripts/capture-chat-annotations.mjs [--out DIR] [--port N] [--lang fr]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "chat-annotations")));
const port = Number(arg("--port", "5291"));

const skins = [
  { id: "pulsatrix", label: "dark" },
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

// vite itself, not through pnpm: a SIGTERM must reach the process that listens
const vite = spawn(
  process.execPath,
  [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" } },
);
let viteLog = "";
vite.stdout?.on("data", (c) => { viteLog += c; });
vite.stderr?.on("data", (c) => { viteLog += c; });

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/chat-annotations.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  // SAGAX_CHROMIUM: a Chromium or headless shell other than Playwright's own build
  browser = await chromium.launch(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 760, height: 1200 }, deviceScaleFactor: 2 });
  for (const { id, label } of skins) {
    await page.goto(`${base}?skin=${id}&lang=${arg("--lang", "fr")}`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-gallery-sample]", { timeout: 30_000 });
    await page.waitForTimeout(300);
    // by name each time: Vite may reload the page once while it optimizes dependencies
    const names = await page.locator("[data-gallery-sample]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-gallery-sample")));
    for (const name of names) {
      const path = join(outDir, `${name}-${label}.png`);
      await page.locator(`[data-gallery-sample="${name}"]`).screenshot({ path });
      console.log(`wrote ${path}`);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  if (viteLog.trim()) console.error(viteLog.trim());
  process.exitCode = 1;
} finally {
  browser?.close().catch(() => {});
  vite.kill("SIGTERM");
}
