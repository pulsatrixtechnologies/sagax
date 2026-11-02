#!/usr/bin/env node
/**
 * Headless screenshots of "Only when something changes" in the routine
 * modal (Playwright, no window, no focus taken): the modal without a watch
 * (its neighbour), a file watch, a tool watch with Check now answered, a
 * command watch that wakes the computer, and the Automations row badge, in
 * the dark and the light skin. Mocked API; no server, nothing read.
 * Usage: node scripts/capture/routine-watch.mjs [--out DIR] [--port N] [--lang fr]
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "routine-watch")));
const port = Number(arg("--port", "5291"));
const lang = arg("--lang", "fr");

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
  const base = `http://127.0.0.1:${port}/src/gallery/routine-watch.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM, headless: true } : { headless: true });
  const page = await browser.newPage({ viewport: { width: 900, height: 2600 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  for (const skin of ["pulsatrix", "daylight"]) {
    for (const sample of ["off", "files", "tool", "command", "list"]) {
      await page.goto(`${base}?skin=${skin}&lang=${lang}&sample=${sample}`, { waitUntil: "networkidle" });
      const target = sample === "list" ? page.locator("[data-gallery-card]") : page.locator("[role=dialog]");
      await target.waitFor();
      if (sample === "tool") {
        await page.locator("[data-testid=routine-watch] button", { hasText: lang === "fr" ? "Vérifier maintenant" : "Check now" }).click();
        await page.locator("[data-testid=routine-watch] [role=status]").waitFor();
      }
      // The modal scrolls inside itself: show it whole.
      await page.evaluate(() => { const d = document.querySelector("[role=dialog]"); if (d) { d.style.maxHeight = "none"; } });
      const file = join(outDir, `${sample}-${skin === "daylight" ? "light" : "dark"}.png`);
      await target.screenshot({ path: file });
      console.log(file);
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
