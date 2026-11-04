#!/usr/bin/env node
/**
 * Headless screenshots (2026-11-04): a routine run's pending approval on the
 * desktop, in the Approvals page (named by its bot and its routine) and
 * pinned in the run's sheet above its footer. Synthetic data only, no
 * visible window, its own Vite port (never 5173).
 * Usage: node scripts/capture/routine-run-approval.mjs [--out DIR] [--port N]
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "routine-run-approval")));
const port = Number(arg("--port", "5191"));
const skins = [{ id: "pulsatrix", label: "dark" }, { id: "pulsatrix-light", label: "light" }];

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Vite gallery did not start at ${url}`);
}

const vite = spawn(
  process.execPath,
  [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" } },
);
let browser;
try {
  const origin = `http://127.0.0.1:${port}/src/gallery`;
  await waitForServer(`${origin}/routine-run-exchange.html`);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM } : {}) });
  for (const { id, label } of skins) {
    for (const lang of ["en", "fr"]) {
      const sheet = await browser.newPage({ viewport: { width: 960, height: 820 }, deviceScaleFactor: 2 });
      await sheet.goto(`${origin}/routine-run-exchange.html?skin=${id}&lang=${lang}&status=waiting`, { waitUntil: "domcontentloaded" });
      await sheet.waitForSelector("[data-exchange-pinned] [data-task-waiting-approvals]", { timeout: 60_000 });
      await new Promise((r) => setTimeout(r, 400));
      const sheetFile = join(outDir, `run-sheet-${lang}-${label}.png`);
      await sheet.screenshot({ path: sheetFile });
      console.log(sheetFile);
      await sheet.close();

      const inbox = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
      await inbox.goto(`${origin}/approvals-page.html?skin=${id}&lang=${lang}&n=3&routine=1`, { waitUntil: "domcontentloaded" });
      await inbox.waitForSelector("[data-approval-row]", { timeout: 60_000 });
      await inbox.waitForSelector("[data-approval-detail]", { timeout: 60_000 });
      await new Promise((r) => setTimeout(r, 400));
      const inboxFile = join(outDir, `approvals-${lang}-${label}.png`);
      await inbox.screenshot({ path: inboxFile });
      console.log(inboxFile);
      await inbox.close();
    }
  }
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
