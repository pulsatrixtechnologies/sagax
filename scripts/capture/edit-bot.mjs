#!/usr/bin/env node
/**
 * Headless screenshots of the Edit bot window (every page) and the bot panel
 * (every tab), from src/gallery/edit-bot.html, solo and organization, light
 * skin. Headless Chromium only: no window opens.
 * Usage: node scripts/capture/edit-bot.mjs [--out DIR] [--port N] [--prefix before|after]
 *   [--sections overview,access,...] (SAGAX_VERIFY_BROWSER_CHROME=<chromium>)
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "edit-bot")));
const port = Number(arg("--port", "5350"));
const prefix = arg("--prefix", "after");
const sections = arg("--sections", "overview,appearance,sharing,soul,rules,skills,files,model,worksOn,access,permissions").split(",");
const lang = arg("--lang", "fr");

async function waitForServer(url, ms = 180_000) {
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
let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/edit-bot.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2, colorScheme: "light" });
  page.on("pageerror", (error) => console.error("page error:", error.message));
  for (const org of ["0", "1"]) {
    const mode = org === "1" ? "org" : "solo";
    for (const section of sections) {
      // one retry: a cold Vite compile can miss the first load
      for (let attempt = 1; ; attempt += 1) {
        try {
          await page.goto(`${base}?view=editor&section=${section}&org=${org}&skin=pulsatrix-light&lang=${lang}`, { waitUntil: "networkidle" });
          await page.waitForSelector("[data-persona-modal]", { timeout: 30_000 });
          break;
        } catch (error) { if (attempt >= 2) throw error; }
      }
      await page.waitForTimeout(700);
      // open every Advanced fold so the hidden rows show too
      await page.evaluate(() => { for (const fold of document.querySelectorAll("[data-persona-modal] details[data-advanced-fold]")) fold.open = true; });
      await page.waitForTimeout(300);
      await page.mouse.move(2, 2);
      await page.waitForTimeout(300);
      const file = join(outDir, `${prefix}-editor-${section}-${mode}.png`);
      await page.locator("[data-persona-modal]").screenshot({ path: file });
      console.log(file);
      // a long page: one more shot per screen until its bottom
      for (let shot = 2; shot <= 4; shot += 1) {
        const moved = await page.evaluate(() => {
          const scrollers = [...document.querySelectorAll("[data-persona-modal], [data-persona-modal] *")].filter((node) => {
            const style = getComputedStyle(node);
            return /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 40;
          });
          const main = scrollers.sort((a, b) => b.clientWidth - a.clientWidth)[0];
          if (!main || main.scrollTop + main.clientHeight >= main.scrollHeight - 4) return false;
          main.scrollTop += main.clientHeight - 80;
          return true;
        });
        if (!moved) break;
        await page.waitForTimeout(250);
        const more = join(outDir, `${prefix}-editor-${section}-${mode}-${shot}.png`);
        await page.locator("[data-persona-modal]").screenshot({ path: more });
        console.log(more);
      }
    }
    await page.goto(`${base}?view=panel&org=${org}&skin=pulsatrix-light&lang=${lang}`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-edit-bot-panel]", { timeout: 60_000 });
    await page.waitForTimeout(700);
    const panelUrl = page.url();
    for (const tab of await page.locator("[data-panel-tab]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-panel-tab")))) {
      try {
        await page.goto(panelUrl, { waitUntil: "networkidle" });
        await page.waitForSelector("[data-panel-tab]", { timeout: 30_000 });
        await page.locator(`[data-panel-tab="${tab}"]`).click();
        await page.waitForTimeout(700);
        const file = join(outDir, `${prefix}-panel-${tab}-${mode}.png`);
        await page.locator("[data-edit-bot-panel]").screenshot({ path: file, timeout: 10_000 });
        console.log(file);
      } catch (error) { console.error(`panel ${tab} (${mode}) skipped:`, error.message.split("\n")[0]); }
    }
  }
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
