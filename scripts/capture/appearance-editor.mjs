#!/usr/bin/env node
/**
 * Headless screenshots of Edit bot > Appearance (src/gallery/appearance-editor.html),
 * the real persona editor on a fictional bot wearing Shapes, light and dark:
 * one shot per tab of the Mascot view (Mascot, Shape, Color, Skin; a checkout
 * without the tabs gives one shot of the whole page), the dialog drawn at its
 * full height. The script answers /api itself. Headless Chromium only: no
 * window opens.
 * Usage: node scripts/capture/appearance-editor.mjs [--out DIR] [--port N]
 *   [--prefix before|after] [--lang en|fr] [--tabs mascot,skin]
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "appearance-redesign")));
const port = Number(arg("--port", "5317"));
const prefix = arg("--prefix", "after");
const lang = arg("--lang", "en");
const tabs = arg("--tabs", "mascot,shape,color,skin").split(",");
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

const dialog = '[role="dialog"][data-persona-modal]';
let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/appearance-editor.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  for (const skin of skins) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2, colorScheme: skin.label });
    page.on("pageerror", (error) => console.error("page error:", error.stack));
    // the gallery holds its own bot: every server call answers that it is not here
    await page.route("**/api/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not in this gallery" }) }));
    await page.goto(`${base}?skin=${skin.id}&lang=${lang}`, { waitUntil: "networkidle" });
    await page.waitForSelector(`${dialog} [data-mascot-look-editor]`, { timeout: 30_000 });
    // the whole page, not the window: the dialog grows with its page
    await page.addStyleTag({ content: `${dialog}{height:auto!important;max-height:none!important}${dialog} [data-persona-pane]{overflow:visible!important}${dialog} nav{overflow:visible!important}` });
    const tabbed = (await page.locator("[data-appearance-tab]").count()) > 0;
    for (const tab of tabbed ? tabs : ["page"]) {
      if (tabbed) await page.locator(`[data-appearance-tab="${tab}"]`).click();
      await page.mouse.move(0, 0);
      // the Mascot view loads lazily: shoot it drawn, never its placeholder
      await page.waitForSelector(`${dialog} [data-mascot-stage]`, { timeout: 30_000 });
      await page.waitForTimeout(900);
      const file = join(outDir, `${prefix}-${tab}-${skin.label}.png`);
      await page.locator(dialog).screenshot({ path: file, animations: "disabled" });
      console.log("shot", file);
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
