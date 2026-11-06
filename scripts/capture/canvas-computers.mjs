#!/usr/bin/env node
/**
 * Headless captures of the team canvas Computers panel (2026-11-06):
 * src/gallery/canvas-computers.html, the list and the Unattended Remote
 * Control install code, dark and light, English and French.
 * Headless Chromium only: no window opens. Its own Vite port (never 5173).
 * Usage: node scripts/capture/canvas-computers.mjs [--out DIR] [--port N] [--tag before|after]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "canvas-computers"));
const port = Number(arg("--port") ?? 5191);
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
  const base = `http://127.0.0.1:${port}/src/gallery/canvas-computers.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const executablePath = process.env.SAGAX_VERIFY_BROWSER_CHROME;
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  for (const skin of ["pulsatrix", "pulsatrix-light"]) {
    for (const lang of ["en", "fr"]) {
      for (const view of ["list", "code"]) {
        const page = await browser.newPage({ viewport: { width: 460, height: 800 }, deviceScaleFactor: 2 });
        const errors = [];
        page.on("pageerror", (error) => errors.push(String(error?.stack ?? error).slice(0, 800)));
        await page.goto(`${base}?${new URLSearchParams({ skin, lang, ...(view === "code" ? { code: "1" } : {}) })}`, { waitUntil: "load" });
        await page.waitForSelector("aside");
        await page.waitForTimeout(1000);
        if (view === "code") {
          const submit = page.locator("[data-unattended-generate]");
          if (await submit.count()) { await submit.click(); await page.waitForSelector("[data-unattended-code]"); await page.waitForTimeout(400); }
        }
        const file = join(outDir, `canvas-computers-${tag}-${view}-${skin === "pulsatrix" ? "dark" : "light"}-${lang}.png`);
        await page.locator("[data-gallery-sample='canvas-computers']").screenshot({ path: file });
        const boat = await page.getByText(/Connect Boat|New cloud computer|Connecter Boat|Nouvel ordinateur infonuagique/).count();
        const unattended = await page.locator("[data-unattended-setup]").count();
        console.log(`${file} (boat entries: ${boat}, unattended setup: ${unattended})${errors.length ? ` ERRORS: ${errors.join(" | ")}` : ""}`);
        if (errors.length) failed = true;
        await page.close();
      }
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
