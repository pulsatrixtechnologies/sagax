#!/usr/bin/env node
/**
 * Headless captures of the "needs you" card (2026-11-05):
 * src/gallery/needs-you-card.html, the card from a hand-off that reached no
 * card in the chat and a routine run's own card with its items (one card per
 * result, never the same items twice) and a hand-off's question with its
 * answers, dark and light, English and French, beside an approval card.
 * Headless Chromium only: no window opens. Its own Vite port (never 5173).
 * Usage: node scripts/capture/needs-you-card.mjs [--out DIR] [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "needs-you-card"));
const port = Number(arg("--port") ?? 5391);

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const viteBin = join(root, "node_modules", "vite", "bin", "vite.js");
const vite = spawn(process.execPath, [viteBin, "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

let browser;
let failed = false;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/needs-you-card.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const executablePath = process.env.SAGAX_VERIFY_BROWSER_CHROME;
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  for (const skin of ["pulsatrix", "pulsatrix-light"]) {
    for (const lang of ["en", "fr"]) {
      const page = await browser.newPage({ viewport: { width: 900, height: 1000 }, deviceScaleFactor: 2 });
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error?.stack ?? error).slice(0, 800)));
      await page.goto(`${base}?${new URLSearchParams({ skin, lang, width: "900", height: "1000" })}`, { waitUntil: "load" });
      await page.waitForSelector("[data-attention-card]");
      await page.waitForSelector("[data-routine-run-attention]");
      await page.waitForTimeout(500);
      const file = join(outDir, `needs-you-card-${skin === "pulsatrix" ? "dark" : "light"}-${lang}.png`);
      await page.locator("[data-gallery-sample='needs-you-card']").screenshot({ path: file });
      const tickets = await page.locator("[data-attention-ticket]").count();
      console.log(`${file} (${tickets} ticket buttons)${errors.length ? ` ERRORS: ${errors.join(" | ")}` : ""}`);
      // one card per result: 1 hand-off item + 2 run items, never repeated
      if (errors.length || tickets !== 3) failed = true;
      await page.close();
    }
    // 2026-11-06: an approval card in the same skin, to hold the question card against
    const approval = await browser.newPage({ viewport: { width: 760, height: 700 }, deviceScaleFactor: 2 });
    await approval.goto(`http://127.0.0.1:${port}/src/gallery/approval-card.html?${new URLSearchParams({ skin, lang: "en", card: "command" })}`, { waitUntil: "load" });
    await approval.waitForTimeout(800);
    const approvalFile = join(outDir, `approval-card-${skin === "pulsatrix" ? "dark" : "light"}.png`);
    await approval.screenshot({ path: approvalFile, fullPage: true });
    console.log(approvalFile);
    await approval.close();
  }
} catch (error) {
  failed = true;
  console.error(error, log.slice(-2000));
} finally {
  await browser?.close().catch(() => {});
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* already gone */ }
}
process.exit(failed ? 1 : 0);
