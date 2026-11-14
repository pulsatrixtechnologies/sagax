#!/usr/bin/env node
/**
 * Headless screenshots of "When something changes in a product" in the
 * routine editor (#4250, S4) next to its neighbour, the GitHub trigger:
 * the trigger list open, then each trigger's fields, in the dark and the
 * light skin. Mocked API; no server, nothing read. Playwright, no window.
 * Usage: node scripts/capture/routine-product-trigger.mjs [--out DIR] [--port N] [--lang fr] [--samples github,product] [--prefix after] [--menus no] [--search text] [--linked no]
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "routine-product-trigger")));
const port = Number(arg("--port", "5331"));
const lang = arg("--lang", "fr");
const samples = arg("--samples", "github,product").split(",");
const prefix = arg("--prefix", "after");
const menus = arg("--menus", "yes") !== "no";
const search = arg("--search", "");
const linked = arg("--linked", "yes");

async function waitForServer(url, ms = 180_000) {
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
console.log(`vite pid ${vite.pid}`);
let viteLog = "";
vite.stdout?.on("data", (c) => { viteLog += c; });
vite.stderr?.on("data", (c) => { viteLog += c; });

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/routine-product-trigger.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 900, height: 1600 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  for (const skin of ["pulsatrix", "daylight"]) {
    const tone = skin === "daylight" ? "light" : "dark";
    for (const sample of samples) {
      await page.goto(`${base}?skin=${skin}&lang=${lang}&sample=${sample}&linked=${linked}`, { waitUntil: "networkidle", timeout: 180_000 });
      const dialog = page.locator("[role=dialog]").first();
      await dialog.waitFor({ timeout: 60_000 });
      await page.evaluate(() => { const d = document.querySelector("[role=dialog]"); if (d) d.style.maxHeight = "none"; });
      const edit = page.locator("[data-routine-edit-mode]").first();
      if (await edit.count()) await edit.click();
      const row = page.locator("button[data-routine-when-row]").first();
      await row.waitFor({ timeout: 30_000 });
      if (await row.count()) await row.click();
      await page.locator("[data-routine-when-picker]").waitFor({ timeout: 30_000 });
      if (sample === "product") await page.locator("[data-product-watchable]").first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(300);
      const fields = join(outDir, `${prefix}-${sample}-fields-${lang}-${tone}.png`);
      await dialog.screenshot({ path: fields });
      console.log(fields);
      if (sample === "product" && search && await page.locator("[data-product-search]").count()) {
        await page.locator("[data-product-search]").fill(search);
        await page.waitForTimeout(200);
        const searched = join(outDir, `${prefix}-${sample}-search-${lang}-${tone}.png`);
        await dialog.screenshot({ path: searched });
        console.log(searched);
      }
      if (!menus) continue;
      await page.locator("[data-schedule-frequency] button").first().click();
      await page.locator("[role=listbox], [role=menu]").first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(200);
      const menu = join(outDir, `${prefix}-${sample}-menu-${lang}-${tone}.png`);
      await page.screenshot({ path: menu, fullPage: true });
      console.log(menu);
    }
  }
  if (errors.length) throw new Error(`page errors:\n${errors.join("\n")}`);
} catch (error) {
  console.error(viteLog.slice(-6000));
  throw error;
} finally {
  await browser?.close().catch(() => {});
  vite.kill("SIGTERM");
}
