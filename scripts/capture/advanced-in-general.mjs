#!/usr/bin/env node
/**
 * Headless captures for M-20261127-068: Advanced on General, gone from Updates.
 * Real SettingsModal via the settings-pages gallery. Playwright channel chrome,
 * no visible window. Usage:
 *   node scripts/capture/advanced-in-general.mjs [--out DIR] [--port N]
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
const outDir = resolve(arg("--out", "/Users/Workspace/artifacts/release-2026-11-27/advanced-in-general"));
const port = Number(arg("--port", "5327"));
const settle = Number(arg("--wait", "900"));
const langs = ["en", "fr"];
const sections = ["general", "updates"];
const skins = [
  { id: "pulsatrix-light", label: "light" },
  { id: "pulsatrix", label: "dark" },
];

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {
      /* retry */
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const vite = spawn(
  process.execPath,
  [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" } },
);
const vitePid = vite.pid;
let log = "";
vite.stdout?.on("data", (chunk) => {
  log += chunk;
});
vite.stderr?.on("data", (chunk) => {
  log += chunk;
});

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/settings-pages.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.SAGAX_VERIFY_BROWSER_CHROME
      ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME }
      : { channel: "chrome" }),
  });
  for (const lang of langs) {
    for (const skin of skins) {
      const page = await browser.newPage({
        viewport: { width: 1100, height: 900 },
        deviceScaleFactor: 2,
        colorScheme: skin.label,
      });
      page.on("pageerror", (error) => console.error("page error:", error.stack));
      for (const section of sections) {
        await page.goto(`${base}?section=${section}&skin=${skin.id}&lang=${lang}`, { waitUntil: "networkidle" });
        await page.waitForSelector('[role="dialog"][aria-labelledby="app-settings-title"] [data-settings-pane]', { timeout: 30_000 });
        await page.waitForTimeout(settle);
        await page.addStyleTag({
          content:
            '[aria-labelledby="app-settings-title"]{height:auto!important;max-height:none!important}[aria-labelledby="app-settings-title"] [data-settings-pane]{overflow:visible!important}[aria-labelledby="app-settings-title"] nav{overflow:visible!important}.fixed.inset-0{position:static!important;min-height:100vh;align-items:flex-start!important}',
        });
        await page.waitForTimeout(300);
        const file = join(outDir, `${section}-${skin.label}-${lang}.png`);
        await page.locator('[role="dialog"][aria-labelledby="app-settings-title"]').screenshot({ path: file });
        const hasAdvanced = await page.locator('[data-settings-card="general.advanced"]').count();
        const hasOld = await page.locator('[data-settings-card="updates.advanced"]').count();
        console.log("shot", file, { section, advancedRows: hasAdvanced, oldAdvancedRows: hasOld });
      }
      await page.close();
    }
  }
} catch (error) {
  console.error(error);
  console.error(log);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  if (vitePid) {
    try {
      process.kill(vitePid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
}
