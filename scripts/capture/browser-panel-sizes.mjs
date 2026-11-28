#!/usr/bin/env node
/**
 * Headless captures of the docked browser panel and the artifact side panel
 * beside the real chat header (M-20261127-179): src/gallery/screen-panel.html
 * and src/gallery/artifact-side-panel.html with ?chathead=1, light and dark,
 * fr and en, the bot driving and the person in control, at the panel's
 * default width and wide, with two places (browser, VM) and with three. Writes the sizes it measured (round controls,
 * glyphs, type, field height) to <prefix>-sizes.json beside the PNGs.
 * Real Chrome headless, DPR 2: no window opens.
 * Usage: node scripts/capture/browser-panel-sizes.mjs --out DIR [--prefix after] [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "browser-panel-sizes"));
const port = Number(arg("--port") ?? 5341);
const prefix = arg("--prefix") ?? "after";
const skins = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];
const langs = ["fr", "en"];

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

/** Box, type and fill of each control, read in the page. */
function measure() {
  const box = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const glyph = element.querySelector("svg");
    return {
      w: Math.round(rect.width * 10) / 10,
      h: Math.round(rect.height * 10) / 10,
      radius: style.borderTopLeftRadius,
      font: style.fontSize,
      glyph: glyph ? Math.round(glyph.getBoundingClientRect().width * 10) / 10 : null,
    };
  };
  const label = (element) => element.getAttribute("aria-label") || element.textContent?.trim().slice(0, 24) || element.tagName;
  const all = (selector) => [...document.querySelectorAll(selector)].map((element) => ({ label: label(element), ...box(element) }));
  return {
    chatHeader: all("[data-chat-head-sample] [data-chat-header-bar] button"),
    panelButtons: all("[data-screen-panel] button:not([role=tab]), [data-screen-panel] summary, [data-artifact-side-panel] button"),
    panelTabs: all("[data-screen-panel] [role=tab], [data-browser-tabs] [data-browser-tab]"),
    text: all("[data-browser-tab] [data-browser-tab-title], [data-browser-holder] [data-browser-holder-pill], [data-artifact-side-panel-header] span"),
    field: all("[data-browser-address-row] input"),
    rows: all("[data-browser-tabs], [data-browser-address-row], [data-screen-panel-tabs], [data-artifact-side-panel-header]"),
  };
}

const vite = spawn("pnpm", ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

let browser;
try {
  const screen = `http://127.0.0.1:${port}/src/gallery/screen-panel.html`;
  const artifact = `http://127.0.0.1:${port}/src/gallery/artifact-side-panel.html`;
  await waitForServer(screen);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 880 }, deviceScaleFactor: 2 });
  // the first load waits for Vite to optimise the gallery's dependencies
  page.setDefaultNavigationTimeout(180_000);
  const sizes = {};
  for (const lang of langs) {
    for (const { id, label } of skins) {
      // The owner's case (browser and VM), then the three places at a wide panel.
      const shots = [
        ["bot-default", "&places=2&panel=480"],
        ["you-default", "&places=2&panel=480&control=you"],
        ["you-wide", "&places=2&panel=760&control=you"],
        ["you-wide-3places", "&panel=760&control=you"],
      ];
      for (const [shot, query] of shots) {
        await page.goto(`${screen}?skin=${id}&lang=${lang}&chathead=1&neighbour=0&width=1280${query}`, { waitUntil: "load" });
        await page.waitForSelector("[data-browser-stage] canvas, [data-browser-stage] img", { timeout: 15_000 }).catch(() => {});
        await page.waitForTimeout(1200);
        const name = `${prefix}-browser-${shot}-${lang}-${label}`;
        await page.locator("[data-gallery-sample]").screenshot({ path: join(outDir, `${name}.png`) });
        const sample = await page.locator("[data-gallery-sample]").boundingBox();
        await page.screenshot({ path: join(outDir, `${name}-top.png`), clip: { x: sample.x, y: sample.y, width: sample.width, height: 150 } });
        sizes[name] = await page.evaluate(measure);
        console.log(name);
      }
      await page.goto(`${artifact}?skin=${id}&lang=${lang}&width=1280`, { waitUntil: "load" });
      await page.waitForSelector("[data-artifact-side-panel]");
      await page.waitForSelector("[data-artifact-frame]", { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(900);
      const name = `${prefix}-artifact-${lang}-${label}`;
      await page.locator("[data-gallery-sample]").screenshot({ path: join(outDir, `${name}.png`) });
      const sample = await page.locator("[data-gallery-sample]").boundingBox();
      await page.screenshot({ path: join(outDir, `${name}-top.png`), clip: { x: sample.x, y: sample.y, width: sample.width, height: 150 } });
      sizes[name] = await page.evaluate(measure);
      console.log(name);
    }
  }
  await writeFile(join(outDir, `${prefix}-sizes.json`), `${JSON.stringify(sizes, null, 2)}\n`);
  console.log(`captures in ${outDir}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (log) console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* already gone */ }
}
