#!/usr/bin/env node
/**
 * Headless screenshots of the Automations List view grouped (2026-11-03):
 * by bot with each bot's folders inside, a bot section folded, by folder
 * across bots, and none (the flat list), with the Filters' Group by open
 * once, in the dark and the light skin. Playwright, no window, no focus
 * taken; mocked API, no server.
 * Usage: node scripts/capture/automations-group-by.mjs [--out DIR] [--port N] [--lang en] [--width 1440]
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "automations-group-by")));
const port = Number(arg("--port", "5741"));
const lang = arg("--lang", "en");
const width = Number(arg("--width", "1440"));
const height = 900;
const shots = [
  { name: "by-bot", query: "groupBy=bot" },
  { name: "bot-collapsed", query: "groupBy=bot&collapsed=boreas" },
  { name: "by-folder", query: "groupBy=folder" },
  { name: "none", query: "groupBy=none" },
  { name: "filters", query: "groupBy=bot", filters: true },
];

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
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
let viteLog = "";
vite.stdout?.on("data", (c) => { viteLog += c; });
vite.stderr?.on("data", (c) => { viteLog += c; });

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/automations-group-by.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM, headless: true } : { headless: true });
  const errors = [];
  for (const skin of ["pulsatrix", "daylight"]) {
    for (const shot of shots) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: skin === "daylight" ? "light" : "dark" });
      page.on("pageerror", (error) => { errors.push(String(error)); console.error(String(error)); });
      page.on("console", (message) => { if (message.type() === "error") console.error(message.text()); });
      await page.goto(`${base}?skin=${skin}&lang=${lang}&width=${width}&height=${height}&${shot.query}`, { waitUntil: "networkidle" });
      const target = page.locator("[data-gallery-sample]");
      await target.waitFor();
      await page.locator("[data-routine-row]").first().waitFor();
      if (shot.filters) {
        await page.locator("[data-automations-filters] > summary").click();
        await page.locator("[data-routine-group-by]").waitFor();
      }
      await page.waitForTimeout(400);
      const file = join(outDir, `${shot.name}-${skin === "daylight" ? "light" : "dark"}.png`);
      await target.screenshot({ path: file });
      console.log(file);
      await page.close();
    }
  }
  if (errors.length) throw new Error(`page errors:\n${errors.join("\n")}`);
} catch (error) {
  console.error(viteLog.slice(-2000));
  throw error;
} finally {
  await browser?.close().catch(() => {});
  vite.kill("SIGTERM");
}
