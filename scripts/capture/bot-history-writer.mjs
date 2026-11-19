#!/usr/bin/env node
/**
 * Headless screenshots of the bot's History (#4940,
 * src/gallery/bot-history-writer.html): before (every change reads as the
 * person's own) and after (an AI client's change by its name and MCP).
 * Light and dark, French and English. Headless Chrome only: no window opens.
 * Usage: node scripts/capture/bot-history-writer.mjs [--out DIR] [--port N]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "bot-history-writer"));
const port = Number(arg("--port") ?? 5351);
const skins = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const vite = spawn("pnpm", ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" },
  // its own process group, so stopping the group stops vite too
  detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/bot-history-writer.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : { channel: "chrome" }) });
  const page = await browser.newPage({ viewport: { width: 700, height: 700 }, deviceScaleFactor: 2 });
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(120_000);
  page.on("pageerror", (error) => { console.error("pageerror", error.message); });
  for (const { id, label } of skins) {
    for (const lang of ["fr", "en"]) {
      for (const when of ["before", "after"]) {
        await page.goto(`${base}?skin=${id}&lang=${lang}${when === "before" ? "&before=1" : ""}`, { waitUntil: "load" });
        await page.waitForSelector("[data-history-gallery] li");
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);
        const name = `${when}-${label}-${lang}.png`;
        await page.locator("[data-history-gallery] > div").screenshot({ path: join(outDir, name) });
        console.log(name, JSON.stringify(await page.locator("[data-history-gallery]").innerText()).slice(0, 300));
      }
    }
  }
} catch (error) {
  console.error(error);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* already stopped */ }
}
