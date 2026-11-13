#!/usr/bin/env node
/**
 * Headless screenshots of Settings > Usage (#4095) from
 * src/gallery/settings-pages.html with the gallery's usage answers: one
 * engine, three engines, three with one in error; English and French; light
 * and dark; 1280 and 390 px wide; each segment of the breakdown (by source,
 * by bot, by model) when the page has them. The neighbouring Models page is
 * shot the same way, to set side by side. Headless Chromium only (channel
 * chrome when SAGAX_CAPTURE_CHANNEL=chrome): no window opens.
 * Usage: node scripts/capture/usage-page.mjs [--out DIR] [--port N] [--prefix before|after]
 *   [--modes one,three,error] [--langs en,fr] [--widths 1280,390] [--segments source,bot,model]
 *   [--open usage.breakdown] (folds drawn open, for the page before #4095)
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
const list = (name, fallback) => arg(name, fallback).split(",").filter(Boolean);
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "usage-page-4095")));
const port = Number(arg("--port", "5331"));
const prefix = arg("--prefix", "after");
const modes = list("--modes", "one,three,error");
const langs = list("--langs", "en,fr");
const widths = list("--widths", "1280,390").map(Number);
const segments = list("--segments", "");
const openCards = list("--open", "");
const skins = [{ id: "pulsatrix-light", label: "light" }, { id: "pulsatrix", label: "dark" }];

async function waitForServer(url, ms = 120_000) {
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
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

const FULL_HEIGHT = '[aria-labelledby="app-settings-title"]{height:auto!important;max-height:none!important}[aria-labelledby="app-settings-title"] [data-settings-pane]{overflow:visible!important}[aria-labelledby="app-settings-title"] nav{overflow:visible!important}.fixed.inset-0{position:static!important;min-height:100vh;align-items:flex-start!important}';

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/settings-pages.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_CAPTURE_CHANNEL ? { channel: process.env.SAGAX_CAPTURE_CHANNEL } : {}) });
  const shoot = async (page, file) => {
    await page.waitForSelector('[role="dialog"][aria-labelledby="app-settings-title"] [data-settings-pane]', { timeout: 30_000 });
    await page.waitForTimeout(900);
    await page.addStyleTag({ content: FULL_HEIGHT });
    await page.waitForTimeout(250);
    await page.locator('[role="dialog"][aria-labelledby="app-settings-title"]').screenshot({ path: join(outDir, file) });
    console.log("shot", join(outDir, file));
  };
  for (const skin of skins) {
    for (const width of widths) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2, colorScheme: skin.label });
      if (openCards.length) await page.addInitScript((ids) => { localStorage.setItem("openmausbot.settingsCards.v1", JSON.stringify(Object.fromEntries(ids.map((id) => [id, true])))); }, openCards);
      page.on("pageerror", (error) => console.error("page error:", error.stack));
      for (const lang of langs) {
        // the neighbouring page, drawn by the same window
        await page.goto(`${base}?section=engines&skin=${skin.id}&lang=${lang}&usage=three`, { waitUntil: "networkidle" });
        await shoot(page, `${prefix}-neighbour-models-${lang}-${skin.label}-${width}.png`);
        for (const mode of modes) {
          await page.goto(`${base}?section=usage&skin=${skin.id}&lang=${lang}&usage=${mode}`, { waitUntil: "networkidle" });
          if (segments.length === 0) {
            await shoot(page, `${prefix}-usage-${mode}-${lang}-${skin.label}-${width}.png`);
            continue;
          }
          for (const segment of segments) {
            // the segmented control lists by source, by bot, by model, in that order
            const index = ["source", "bot", "model"].indexOf(segment);
            await page.waitForSelector("[data-usage-segments] button", { timeout: 30_000 });
            await page.locator("[data-usage-segments] button").nth(index).click();
            await page.waitForSelector(`[data-usage-segments="${segment}"]`, { timeout: 10_000 });
            await shoot(page, `${prefix}-usage-${mode}-${segment}-${lang}-${skin.label}-${width}.png`);
          }
        }
      }
      await page.close();
    }
  }
} catch (error) {
  console.error(error);
  console.error(log.slice(-3000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
