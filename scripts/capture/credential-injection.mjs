#!/usr/bin/env node
/**
 * Headless screenshots of an API key's two uses in Settings > Credentials
 * (2026-10-26): src/gallery/credential-injection.html, light and dark: the
 * rows (sent by Sagax, command variable line), the form with every field,
 * the form with the command variable off, and a narrow row. Headless
 * Chromium only: no window opens.
 * Usage: node scripts/capture/credential-injection.mjs [--out DIR] [--port N]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "credential-injection"));
const port = Number(arg("--port") ?? 5293);
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

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/credential-injection.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  const page = await browser.newPage({ viewport: { width: 1000, height: 1400 }, deviceScaleFactor: 2 });
  await page.route("**/api/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  for (const { id, label } of skins) {
    await page.goto(`${base}?skin=${id}&lang=fr`, { waitUntil: "load" });
    await page.waitForSelector("[data-credential-command-variable]");
    for (const sample of ["rows", "form", "form-off", "narrow"]) {
      await page.locator(`[data-gallery-sample="${sample}"]`).screenshot({ path: join(outDir, `credentials-${sample}-${label}.png`) });
    }
  }
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(log);
  throw error;
} finally {
  await browser?.close();
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* gone */ }
}
