#!/usr/bin/env node
/**
 * Headless screenshots of the share mark after a bot's name (#2615),
 * src/gallery/sidebar.html?share=1: Atlas shared (two people), Iris in one
 * group with a person (Partially shared, the group named), Milo in two
 * (counted). Per skin and language: the whole sidebar, each marked row with
 * its tooltip text drawn under it (headless Chromium never paints the native
 * title tooltip), and the rail. Headless only: no window opens.
 * Usage: node scripts/capture/bot-share-mark.mjs [--out DIR] [--port N]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "bot-share-mark"));
const port = Number(arg("--port") ?? 5191);
const skins = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];

async function waitForServer(url, ms = 180_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const vite = spawn("pnpm", ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

// Draws the mark's title under it, styled as the system tooltip.
const showTooltip = (page, id) => page.evaluate((botId) => {
  const mark = document.querySelector(`[data-sidebar-bot-row="${botId}"] [data-bot-share]`);
  if (!mark) throw new Error(`no share mark on ${botId}`);
  const box = mark.getBoundingClientRect();
  const tip = document.createElement("div");
  tip.setAttribute("data-capture-tooltip", "");
  tip.textContent = mark.getAttribute("title");
  Object.assign(tip.style, {
    position: "fixed", left: `${box.left}px`, top: `${box.bottom + 6}px`, zIndex: "9999", whiteSpace: "pre", font: "12px -apple-system, system-ui, sans-serif",
    background: "#f5f5f5", color: "#1d1d1f", border: "1px solid rgba(0,0,0,.18)", borderRadius: "4px", padding: "3px 7px", boxShadow: "0 2px 6px rgba(0,0,0,.18)",
  });
  document.body.appendChild(tip);
}, id);

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/sidebar.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  for (const lang of ["fr", "en"]) {
    for (const { id, label } of skins) {
      const page = await browser.newPage({ viewport: { width: 1180, height: 1015 }, deviceScaleFactor: 2 });
      await page.goto(`${base}?skin=${id}&lang=${lang}&share=1`, { waitUntil: "load" });
      await page.waitForSelector("[data-bot-share]", { state: "attached" });
      await page.waitForTimeout(800);
      await page.locator("[data-gallery]").screenshot({ path: join(outDir, `sidebar-${lang}-${label}.png`) });
      for (const bot of ["atlas", "iris", "milo"]) {
        await showTooltip(page, bot);
        const row = page.locator(`[data-sidebar-bot-row="${bot}"]`).first();
        const box = await row.boundingBox();
        await page.screenshot({ path: join(outDir, `row-${bot}-${lang}-${label}.png`), clip: { x: box.x, y: box.y, width: box.width, height: box.height + 52 } });
        await page.evaluate(() => document.querySelector("[data-capture-tooltip]")?.remove());
      }
      await page.close();
      // phone width (mobile web): the same rows
      const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
      await phone.goto(`${base}?skin=${id}&lang=${lang}&share=1&width=390`, { waitUntil: "load" });
      await phone.waitForSelector("[data-bot-share]", { state: "attached" });
      await phone.waitForTimeout(800);
      await phone.screenshot({ path: join(outDir, `phone-${lang}-${label}.png`) });
      await phone.close();
      // the rail: the mark is in the row's label
      const rail = await browser.newPage({ viewport: { width: 400, height: 900 }, deviceScaleFactor: 2 });
      await rail.goto(`${base}?skin=${id}&lang=${lang}&share=1&rail=1`, { waitUntil: "load" });
      await rail.waitForSelector("[data-sidebar-bot-row]");
      await rail.waitForTimeout(600);
      const titles = await rail.$$eval("[data-sidebar-bot-row]", (rows) => rows.map((row) => [row.getAttribute("aria-label"), row.getAttribute("title"), row.closest("[title]")?.getAttribute("title"), row.querySelector("[aria-label]")?.getAttribute("aria-label")].filter(Boolean).join(" | ")));
      console.log(`rail titles ${lang}/${label}: ${JSON.stringify(titles.filter((t) => /hared|artag/.test(t)))}`);
      await rail.close();
    }
  }
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (log) console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* already gone */ }
}
