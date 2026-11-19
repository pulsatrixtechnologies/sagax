#!/usr/bin/env node
/**
 * #5014: headless screenshots of Providers > Claude through the real Settings
 * dialog (src/gallery/settings-pages.html, two signed-in Claude accounts):
 * the strategy under the Accounts list (High-water and its threshold), its
 * three choices open, and Most-free picked (no threshold), light and dark,
 * English and French. Real Chrome headless (channel "chrome"), DPR 2, no
 * window; the gallery answers /api itself.
 * Usage: node scripts/capture/account-switch.mjs [--out DIR] [--port N] [--mode before|after]
 * Files: <mode>-<lang>-<theme>-<page|choices|most-free>.png
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "account-switch")));
const port = Number(arg("--port", "5347"));
const mode = arg("--mode", "after");
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

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/settings-pages.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  for (const lang of ["en", "fr"]) {
    for (const skin of skins) {
      const page = await browser.newPage({ viewport: { width: 1100, height: 1000 }, deviceScaleFactor: 2, colorScheme: skin.label });
      page.on("pageerror", (error) => console.error("page error:", error.stack));
      await page.goto(`${base}?section=providers&subPage=providers.provider:anthropic&providers=1&skin=${skin.id}&lang=${lang}`, { waitUntil: "networkidle", timeout: 180_000 });
      await page.waitForSelector('[data-provider-page="anthropic"]', { timeout: 30_000 });
      await page.waitForTimeout(900);
      const shot = async (name) => {
        const file = join(outDir, `${mode}-${lang}-${skin.label}-${name}.png`);
        await page.locator('[role="dialog"][aria-labelledby="app-settings-title"]').screenshot({ path: file });
        console.log(file);
      };
      await shot("page");
      const pill = page.locator('[data-provider-account-switch] [data-pill-select]').first();
      if (await pill.count()) {
        await pill.click();
        await page.waitForTimeout(300);
        await shot("choices");
        await page.locator('[role="option"]').nth(1).click();
        await page.waitForTimeout(600);
        await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
        await shot("most-free");
      }
      await page.close();
    }
  }
} catch (error) {
  console.error(error);
  console.error(log);
  process.exitCode = 1;
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
