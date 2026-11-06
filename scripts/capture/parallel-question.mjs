#!/usr/bin/env node
/**
 * Headless captures of a parallel task's question (#2082, 2026-11-05):
 * src/gallery/parallel-question.html, the conversation the task serves and
 * the task's own conversation, dark and light, English and French.
 * Headless Chromium only: no window opens. Its own Vite port (never 5173).
 * Usage: node scripts/capture/parallel-question.mjs [--out DIR] [--port N] [--tag before|after]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "parallel-question"));
const port = Number(arg("--port") ?? 5244);
const tag = arg("--tag") ?? "after";

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
  const base = `http://127.0.0.1:${port}/src/gallery/parallel-question.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const executablePath = process.env.SAGAX_VERIFY_BROWSER_CHROME;
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  for (const skin of ["pulsatrix", "pulsatrix-light"]) {
    for (const lang of ["en", "fr"]) {
      const page = await browser.newPage({ viewport: { width: 1400, height: 760 }, deviceScaleFactor: 2 });
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error?.stack ?? error).slice(0, 800)));
      await page.goto(`${base}?${new URLSearchParams({ skin, lang })}`, { waitUntil: "load" });
      await page.waitForSelector("[data-parallel-card]");
      await page.waitForTimeout(1200);
      const file = join(outDir, `parallel-question-${tag}-${skin === "pulsatrix" ? "dark" : "light"}-${lang}.png`);
      await page.locator("[data-gallery-sample='parallel-question']").screenshot({ path: file });
      const overlay = await page.locator("[data-gallery-pane='source'] [data-parallel-question]").count();
      const inline = await page.locator("[data-gallery-pane='task'] [data-question-card], [data-gallery-pane='task'] [role='group'], [data-gallery-pane='task'] button").count();
      console.log(`${file} (overlay in source chat: ${overlay}, controls in task chat: ${inline})${errors.length ? ` ERRORS: ${errors.join(" | ")}` : ""}`);
      if (errors.length) failed = true;
      await page.close();
    }
  }
} catch (error) {
  failed = true;
  console.error(error);
  console.error(log.slice(-2000));
} finally {
  await browser?.close();
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* gone */ }
}
process.exit(failed ? 1 : 0);
