#!/usr/bin/env node
/**
 * Headless captures of a decision's notification (#2909):
 * src/gallery/notification-context.html, the desktop banner (macOS, Windows)
 * and the phone's Updates row for the capture's routine (long answers: the
 * context and Open only) and a legible "A or B?" (whole labels), dark and light.
 * Headless Chrome only: no window opens. Its own Vite port (never 5173).
 * Writes docs/screenshots/notification-context/ by default.
 * Usage: node scripts/capture/notification-context.mjs [--out DIR] [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "notification-context"));
const port = Number(arg("--port") ?? 5187);

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
  const base = `http://127.0.0.1:${port}/src/gallery/notification-context.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  for (const skin of ["pulsatrix", "pulsatrix-light"]) {
    const page = await browser.newPage({ viewport: { width: 1320, height: 1100 }, deviceScaleFactor: 2 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error?.stack ?? error).slice(0, 800)));
    await page.goto(`${base}?${new URLSearchParams({ skin })}`, { waitUntil: "load" });
    await page.waitForSelector("[data-updates-row]");
    await page.waitForTimeout(400);
    const file = join(outDir, `notification-context-${skin === "pulsatrix" ? "dark" : "light"}.png`);
    await page.locator("[data-gallery-sample='notification-context']").screenshot({ path: file });
    const text = await page.locator("[data-gallery-sample='notification-context']").innerText();
    // the context is readable (no raw table), no answer is cut, long answers are Open only
    const problems = [];
    if (text.includes("|---")) problems.push("raw table");
    if (!text.includes("Membre : Alex · Heures : 2,5")) problems.push("table not as text");
    if (!text.includes("Ouvrir")) problems.push("no Open");
    if (!text.includes("Locale")) problems.push("no whole label");
    console.log(`${file}${errors.length || problems.length ? ` PROBLEMS: ${[...errors, ...problems].join(" | ")}` : ""}`);
    if (errors.length || problems.length) failed = true;
    await page.close();
  }
} catch (error) {
  failed = true;
  console.error(error, log.slice(-2000));
} finally {
  await browser?.close().catch(() => {});
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* already gone */ }
}
process.exit(failed ? 1 : 0);
