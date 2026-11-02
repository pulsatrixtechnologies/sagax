#!/usr/bin/env node
/**
 * Headless screenshots of a bot's Permissions card, light and dark
 * (src/gallery/bot-permissions-rows.html). Headless Chromium only: no
 * window opens. Usage: node scripts/capture/bot-permissions-rows.mjs --out DIR [--tag before|after] [--port N]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "bot-permissions-rows"));
const tag = arg("--tag") ?? "after";
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
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

try {
  const base = `http://127.0.0.1:${port}/src/gallery/bot-permissions-rows.html`;
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
  for (const { id, label } of skins) {
    await page.goto(`${base}?skin=${id}&lang=en${arg("--query") ? `&${arg("--query")}` : ""}`, { waitUntil: "load" });
    await page.waitForSelector('[data-settings-row="lifecycleHooks"]');
    await page.waitForSelector("[data-settings-group], [data-settings-row]");
    await page.waitForTimeout(300);
    await page.locator('[data-gallery-panel=""]').screenshot({ path: join(outDir, `permissions-${tag}-${label}.png`) });
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
