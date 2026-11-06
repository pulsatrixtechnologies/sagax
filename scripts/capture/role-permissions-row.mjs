#!/usr/bin/env node
/**
 * Headless screenshots of the missing-permission row in the bot panel,
 * Details > Permissions (2026-11-05, #2085; the Roles tab is gone).
 * Gallery src/gallery/visible-roles.html (synthetic data only): with
 * refusals, without refusals, disclosure open. Light and dark.
 * Headless Chromium only, no visible window.
 * Usage: node scripts/capture/role-permissions-row.mjs [--out DIR] [--port N] [--prefix after]
 *   [--root DIR] [--views "permissions,permissions&refusals=none,permissions&open=1"]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const root = resolve(arg("--root") ?? here);
const outDir = resolve(arg("--out") ?? join(here, "docs", "screenshots", "role-permissions-row"));
const port = Number(arg("--port") ?? 5266);
const prefix = arg("--prefix") ?? "after";
const views = (arg("--views") ?? "permissions,permissions&refusals=none,permissions&open=1").split(",");
const skins = [{ id: "pulsatrix-light", label: "light" }, { id: "pulsatrix", label: "dark" }];

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

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/visible-roles.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 720, height: 900 }, deviceScaleFactor: 2 });
  page.on("pageerror", (error) => console.error("page error:", error.stack));
  for (const skin of skins) for (const view of views) {
    await page.goto(`${base}?view=${view}&skin=${skin.id}&lang=fr`, { waitUntil: "load" });
    await page.waitForSelector("[data-gallery]");
    await page.waitForTimeout(900);
    const name = view.replace(/&/g, "-").replace(/=/g, "-");
    const file = join(outDir, `${prefix}-${name}-${skin.label}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(file);
  }
} catch (error) {
  console.error(error);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* already gone */ }
}
