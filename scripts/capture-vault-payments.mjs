#!/usr/bin/env node
/**
 * Headless screenshots of Settings > Vault > Payments:
 * src/gallery/vault-payments.html, French and English, light and dark.
 * Headless Chromium only: no window opens.
 * Usage: node scripts/capture-vault-payments.mjs [--out DIR] [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "vault-payments"));
const port = Number(arg("--port") ?? 5347);
const skins = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];
const tabs = ["payments", "all"];

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

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/vault-payments.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  for (const lang of ["fr", "en"]) {
    for (const { id, label } of skins) {
      for (const tab of tabs) {
        await page.goto(`${base}?skin=${id}&lang=${lang}&tab=${tab}`, { waitUntil: "load" });
        await page.waitForSelector("[data-credentials-settings]");
        await page.waitForSelector('[data-gallery-ready="1"]', { timeout: 15_000 }).catch(() => {});
        if (tab === "payments") {
          await page.waitForSelector("[data-settings-card='credentials.payments.methods']", { timeout: 10_000 });
        }
        await page.waitForTimeout(400);
        await page.screenshot({ path: join(outDir, `vault-payments-${tab}-${lang}-${label}.png`), fullPage: false });
      }
    }
  }
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (log) console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* already gone */ }
}
