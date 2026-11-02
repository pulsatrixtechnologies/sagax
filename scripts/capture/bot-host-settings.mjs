#!/usr/bin/env node
/**
 * Headless screenshots of a bot's "Where this bot runs" row (organization server and one computer), light and dark
 * (src/gallery/bot-host-settings.html). Headless Chromium only: no
 * window opens. Usage: node scripts/capture/bot-host-settings.mjs --out DIR [--tag before|after] [--port N]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "bot-host-settings"));
const tag = arg("--tag") ?? "after";
const port = Number(arg("--port") ?? 5317);
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
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

try {
  const base = `http://127.0.0.1:${port}/src/gallery/bot-host-settings.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  const page = await browser.newPage({ viewport: { width: 700, height: 700 }, deviceScaleFactor: 2 });
  await page.addInitScript(() => { try { localStorage.setItem("sagax.interfaceMode.v1", "advanced"); } catch { /* none */ } });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/lifecycle-hooks")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: false, events: [] }) });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not in this gallery" }) });
  });
  for (const host of ["fleet", "machine"]) {
    for (const { id, label } of skins) {
      await page.goto(`${base}?skin=${id}&lang=${arg("--lang") ?? "fr"}&host=${host}`, { waitUntil: "load" });
      await page.waitForSelector("[data-bot-host-row]");
      await page.waitForTimeout(300);
      await page.locator('[data-gallery-panel=""]').screenshot({ path: join(outDir, `where-${host}-${tag}-${label}.png`) });
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
