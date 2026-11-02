#!/usr/bin/env node
/**
 * Headless screenshots of the outbound cards (src/gallery/outbound-cards.html),
 * light and dark, French and English: the existing one-way call and purchase
 * cards, then the conversation call (approval, in progress, results). Each
 * card is also shot alone. Headless Chromium only: no window opens.
 * Usage: node scripts/capture/outbound-cards.mjs [--out DIR] [--port N]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "outbound-cards"));
const port = Number(arg("--port") ?? 5297);
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
  const base = `http://127.0.0.1:${port}/src/gallery/outbound-cards.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  const page = await browser.newPage({ viewport: { width: 720, height: 1000 }, deviceScaleFactor: 2 });
  for (const { id, label } of skins) {
    for (const lang of ["fr", "en"]) {
      await page.goto(`${base}?skin=${id}&lang=${lang}`, { waitUntil: "load" });
      await page.waitForSelector("[data-outbound-card]");
      await page.waitForTimeout(250);
      await page.locator("[data-gallery-panel]").screenshot({ path: join(outDir, `outbound-all-${lang}-${label}.png`) });
      if (lang !== "fr") continue;
      const cards = page.locator("[data-outbound-card]");
      const count = await cards.count();
      for (let index = 0; index < count; index += 1) {
        await cards.nth(index).screenshot({ path: join(outDir, `outbound-card-${index + 1}-${label}.png`) });
      }
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
