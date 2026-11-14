#!/usr/bin/env node
/**
 * Headless screenshots of listening to a conversation (#4100,
 * src/gallery/listening-card.html) beside the live phone call card, light and
 * dark, French and English: the whole panel, the card alone, then the
 * sidebar pill under eleven bots beside the Live call's. Headless
 * Chromium only: no window opens.
 * Usage: node scripts/capture/listening-card.mjs [--out DIR] [--port N]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "listening-card"));
const port = Number(arg("--port") ?? 5331);
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
  detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

try {
  const base = `http://127.0.0.1:${port}/src/gallery/listening-card.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : { channel: "chrome" }) });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  page.setDefaultTimeout(60_000);
  for (const { id, label } of skins) {
    for (const lang of ["fr", "en"]) {
      await page.goto(`${base}?skin=${id}&lang=${lang}`, { waitUntil: "load" });
      await page.waitForSelector("body[data-gallery-ready]");
      // the neighbour's live transcript open, as the listening card's is
      const toggle = page.locator("[data-outbound-live-toggle]").first();
      if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
      await page.locator("[data-listening-open-transcript]").first().click().catch(() => undefined);
      await page.waitForTimeout(300);
      await page.locator("[data-gallery-panel]").screenshot({ path: join(outDir, `listening-${lang}-${label}.png`) });
      await page.locator("[data-listening-card='here']").screenshot({ path: join(outDir, `listening-card-${lang}-${label}.png`) });
      // the sidebar pill under eleven bots, beside the Live call's (its neighbour)
      await page.locator("[data-gallery-sidebars]").screenshot({ path: join(outDir, `listening-sidebar-${lang}-${label}.png`) });
    }
  }
  await browser.close();
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(error);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  try { process.kill(-vite.pid, "SIGTERM"); } catch { vite.kill("SIGTERM"); }
}
