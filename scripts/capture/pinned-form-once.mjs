#!/usr/bin/env node
/**
 * Headless screenshots of a 1:1 chat while a form waits on the person: the
 * form lives on the pinned card only, the conversation keeps a compact line.
 * Cases: widget, checklist, settled; dark and light. Synthetic data only.
 * Usage: node scripts/capture/pinned-form-once.mjs [--out DIR] [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "pinned-form-once"));
const port = Number(arg("--port") ?? 5247);
const vite = spawn("pnpm", ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: "ignore", env: { ...process.env, NODE_ENV: "development" }, detached: true,
});
let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/pinned-form-once.html`;
  for (let i = 0; i < 360; i++) { try { if ((await fetch(base)).status < 500) break; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 500)); }
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  for (const which of ["widget", "checklist", "settled"]) for (const [skin, mode] of [["midnight", "dark"], ["daylight", "light"]]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2 });
    await page.goto(`${base}?${new URLSearchParams({ skin, lang: "en", case: which })}`, { waitUntil: "load" });
    await page.waitForSelector('[role="log"]');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(outDir, `${which}-${mode}.png`) });
    const counts = await page.evaluate(() => ({
      pinned: document.querySelectorAll("[data-pinned-waiting]").length,
      history: document.querySelectorAll('[role="log"] [data-waiting-history]').length,
      checkboxesInLog: document.querySelectorAll('[role="log"] input[type="checkbox"], [role="log"] [role="checkbox"]').length,
      checkboxesPinned: document.querySelectorAll('[data-pinned-waiting] input[type="checkbox"], [data-pinned-waiting] [role="checkbox"]').length,
    }));
    console.log(which, mode, JSON.stringify(counts));
    await page.close();
  }
} finally {
  await browser?.close();
  try { process.kill(-vite.pid); } catch { /* gone */ }
}
