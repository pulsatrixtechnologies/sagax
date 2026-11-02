#!/usr/bin/env node
/**
 * Headless screenshots of the Settings pages split on 2026-10-28 (Account,
 * Security, Vault, Models, Voice) from src/gallery/settings-pages.html, in a
 * light and a dark skin. The dialog is drawn at its full height so each page
 * shows whole. A page that does not exist in the checkout (before the split)
 * opens the page that held it then, and is shot as such. Headless Chromium
 * only: no window opens; the gallery answers /api itself.
 * Usage: node scripts/capture/settings-pages.mjs [--out DIR] [--port N]
 *   [--prefix before|after] [--lang en|fr] [--sections account,security,...]
 *   [--query providers=1] [--wait ms]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "settings-pages")));
const port = Number(arg("--port", "5311"));
const prefix = arg("--prefix", "after");
const lang = arg("--lang", "en");
const sections = arg("--sections", "account,security,credentials,engines,voice").split(",");
// extra gallery parameters, e.g. --query providers=1 (a fuller set of engines and keys)
const query = arg("--query", "");
const settle = Number(arg("--wait", "900"));
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
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  for (const skin of skins) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2, colorScheme: skin.label });
    page.on("pageerror", (error) => console.error("page error:", error.stack));
    for (const section of sections) {
      await page.goto(`${base}?section=${section}&skin=${skin.id}&lang=${lang}${query ? `&${query}` : ""}`, { waitUntil: "networkidle" });
      await page.waitForSelector('[role="dialog"][aria-labelledby="app-settings-title"] [data-settings-pane]', { timeout: 30_000 });
      await page.waitForTimeout(settle);
      // the whole page, not the 700px window: the dialog grows with its page
      await page.addStyleTag({ content: '[aria-labelledby="app-settings-title"]{height:auto!important;max-height:none!important}[aria-labelledby="app-settings-title"] [data-settings-pane]{overflow:visible!important}[aria-labelledby="app-settings-title"] nav{overflow:visible!important}.fixed.inset-0{position:static!important;min-height:100vh;align-items:flex-start!important}' });
      await page.waitForTimeout(300);
      const shown = await page.locator('[aria-labelledby="app-settings-title"] [data-settings-pane] h2').first().textContent().catch(() => "");
      const file = join(outDir, `${prefix}-${section}-${skin.label}.png`);
      await page.locator('[role="dialog"][aria-labelledby="app-settings-title"]').screenshot({ path: file });
      console.log("shot", file, `(page: ${shown?.trim()})`);
    }
    await page.close();
  }
} catch (error) {
  console.error(error);
  console.error(log);
  process.exitCode = 1;
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
