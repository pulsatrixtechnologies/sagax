#!/usr/bin/env node
/**
 * Headless screenshots of the claude.ai artifact cards
 * (src/gallery/claude-artifact-cards.html), light and dark, French and
 * English: owned with its comment threads, someone else's, the consent card
 * and the signed-out state, beside the plain page card. Headless Chromium
 * only: no window opens. fetch is mocked inside the gallery.
 * Usage: node scripts/capture/claude-artifact-cards.mjs [--out DIR] [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "claude-artifact-cards"));
const port = Number(arg("--port") ?? 5187);
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
  const base = `http://127.0.0.1:${port}/src/gallery/claude-artifact-cards.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  const page = await browser.newPage({ viewport: { width: 640, height: 1400 }, deviceScaleFactor: 2 });
  for (const { id, label } of skins) {
    for (const lang of ["fr", "en"]) {
      await page.goto(`${base}?skin=${id}&lang=${lang}`, { waitUntil: "load" });
      await page.waitForSelector("[data-claude-artifact-comment]");
      await page.waitForTimeout(300);
      await page.locator("[data-gallery-panel]").screenshot({ path: join(outDir, `claude-artifacts-all-${lang}-${label}.png`) });
      if (lang !== "fr") continue;
      for (const card of ["owned", "other", "consent", "signed-out"]) {
        await page.locator(`[data-gallery-card="${card}"]`).screenshot({ path: join(outDir, `claude-artifact-${card}-${label}.png`) });
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
