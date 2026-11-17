#!/usr/bin/env node
/**
 * Headless screenshots of the Routines page (2026-11-17): the Overview tab
 * (Runs figures, the routines table), its Filters popover and the grouped
 * view, in French dark and English light, at 1280 and 390 wide. Playwright,
 * no window, no focus taken; mocked API, no server.
 * Usage: node scripts/capture/routines-page.mjs [--out DIR] [--port N]
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "routines-page")));
const port = Number(arg("--port", "5180"));
const height = 1000;
const shots = [
  { name: "overview", query: "tab=overview" },
  { name: "filters", query: "tab=overview", filters: true },
  { name: "grouped", query: "tab=overview&groupBy=bot" },
  { name: "logs", query: "tab=logs" },
  { name: "empty", query: "tab=overview&empty=1" },
  { name: "all-good", query: "tab=overview&quiet=1" },
];
const looks = [
  { skin: "pulsatrix", scheme: "dark", lang: "fr", tag: "fr-dark" },
  { skin: "daylight", scheme: "light", lang: "en", tag: "en-light" },
];
const widths = [1280, 390];

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
  const base = `http://127.0.0.1:${port}/src/gallery/routines-overview.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM, headless: true } : { headless: true });
  const errors = [];
  for (const look of looks) {
    for (const width of widths) {
      for (const shot of shots) {
        const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: look.scheme });
        page.on("pageerror", (error) => { errors.push(String(error)); console.error(String(error)); });
        page.on("console", (message) => { if (message.type() === "error") console.error(message.text()); });
        await page.goto(`${base}?skin=${look.skin}&lang=${look.lang}&width=${width}&height=${height}&${shot.query}`, { waitUntil: "networkidle" });
        await page.locator("[data-gallery-sample]").waitFor();
        await page.locator("[data-routines-tabs]").waitFor();
        if (shot.filters) {
          await page.locator("[data-automations-filters] > summary").click();
          await page.locator('[data-routine-filter="status"]').waitFor();
        }
        await page.waitForTimeout(400);
        // The layout at 390 (and every width): nothing scrolls sideways, no table row is wider than the page.
        const overflow = await page.evaluate(() => {
          const sample = document.querySelector("[data-gallery-sample]");
          const wide = [...document.querySelectorAll("[data-routine-row]")].filter((row) => row.scrollWidth > row.clientWidth + 1).length;
          return { page: sample.scrollWidth - sample.clientWidth, wide };
        });
        if (overflow.page > 1 || overflow.wide > 0) errors.push(`${shot.name} ${look.tag} ${width}: overflow ${JSON.stringify(overflow)}`);
        const file = join(outDir, `${shot.name}-${look.tag}-${width}.png`);
        await page.locator("[data-gallery-sample]").screenshot({ path: file });
        console.log(file);
        await page.close();
      }
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
