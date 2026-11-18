#!/usr/bin/env node
/**
 * Headless captures and a main-thread measure of adding several plugins in a
 * row (#4647). The real Connect apps panel in the gallery
 * (src/gallery/connect-apps.html?view=manage&solo=1&addplugins=1), no window:
 * a card installing (its own spinner, the others still pressable), then
 * three cards added in a row, and a card whose add failed (its own error).
 * Records the longest main-thread task and every press's answer time.
 * Usage: node scripts/capture/plugin-add-freeze.mjs [--out DIR] [--port N] [--root DIR]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const root = resolve(arg("--root", process.cwd()));
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "plugin-add-freeze")));
const port = Number(arg("--port", "5186"));

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { const res = await fetch(url); if (res.status < 500) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Vite gallery did not start at ${url}`);
}

const vite = spawn(
  process.execPath,
  [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" } },
);
let viteLog = "";
vite.stdout?.on("data", (c) => { viteLog += c; });
vite.stderr?.on("data", (c) => { viteLog += c; });

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/connect-apps.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 1100, height: 820 }, deviceScaleFactor: 2, colorScheme: "dark" });
  page.on("pageerror", (error) => console.error("page error:", error.stack));
  if (process.env.SAGAX_CAPTURE_DEBUG) { page.on("console", (message) => { if (message.type() === "error") console.error("console:", message.text().slice(0, 300)); }); page.on("response", (response) => { if (response.status() === 404) console.error("404", response.url()); }); }
  await page.addInitScript(() => {
    window.__longTasks = [];
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__longTasks.push(Math.round(entry.duration)); }).observe({ entryTypes: ["longtask"] });
  });
  await page.goto(`${base}?view=manage&skin=pulsatrix&lang=en&role=admin&solo=1&addplugins=900`, { waitUntil: "load", timeout: 120_000 });
  await page.waitForSelector("[data-plugins-main]", { timeout: 120_000 });
  const shot = async (name) => {
    await page.waitForTimeout(300);
    const file = join(outDir, `${name}.png`);
    await page.locator('[role="dialog"]').first().screenshot({ path: file });
    console.log("shot", file);
  };
  await page.click('[data-plugins-kind-tab="plugins"]');
  // the organization's scope lists the marketplaces' plugins
  await page.click('[data-plugins-view="installed"]');
  await page.waitForSelector('[data-plugins-main="installed"]');
  if (await page.locator('[data-plugins-scope-option="workspace"]').count()) {
    await page.click('[data-plugins-scope-option="workspace"]');
    await page.waitForTimeout(400);
  }
  await page.click('[data-plugins-view="discover"]');
  await page.waitForSelector('[data-plugins-main="discover"]');
  if (process.env.SAGAX_CAPTURE_DEBUG) {
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(outDir, "debug-discover.png") });
    console.error(await page.evaluate(() => [...document.querySelectorAll("[data-plugin-row]")].map((row) => row.getAttribute("data-plugin-row")).slice(0, 30)));
    console.error(await page.evaluate(async () => { const r = await fetch("/api/marketplaces"); return r.status + " " + (await r.text()).slice(0, 200); }));
  }
  const card = (name) => page.locator(`[data-plugin-row="plugin:${name}@catalog-six"], [data-plugin-row$="${name}@catalog-six"]`).first();
  const plus = (name) => card(name).locator("[data-install-button], [data-card-action] button").first();
  await card("notes-wiki").waitFor();
  await page.evaluate(() => { window.__longTasks.length = 0; });
  // three presses in a row, as fast as a person can click
  const presses = [];
  for (const name of ["notes-wiki", "parts-feed", "vault-sync"]) {
    const started = Date.now();
    await plus(name).click({ timeout: 2000 });
    if (process.env.SAGAX_CAPTURE_DEBUG) console.error("after press", name, await page.locator("[data-plugins-main]").first().getAttribute("data-plugins-main"), await page.locator("[data-plugins-subpage]").count());
    presses.push({ name, ms: Date.now() - started });
  }
  await shot("1-installing-in-a-row");
  const others = await Promise.all(["desk-flow", "endpoint-guard"].map(async (name) => !(await plus(name).isDisabled())));
  console.log("other cards still pressable while three install:", others.join(","));
  await page.waitForFunction(() => document.querySelectorAll("[data-card-added]").length >= 3, null, { timeout: 60_000 });
  await shot("2-three-added-in-a-row");
  // the failing one: its own error, under its own card
  await plus("reseller-hub").click();
  await page.waitForSelector('[data-plugin-card-error="reseller-hub@catalog-six"]', { timeout: 10_000 });
  await shot("3-error-on-its-card");
  // the conforming neighbour: Yours, the same cards once added
  await page.click('[data-plugins-view="installed"]');
  await page.waitForSelector('[data-plugins-main="installed"]');
  await shot("4-neighbour-yours");
  const longTasks = await page.evaluate(() => window.__longTasks);
  console.log(JSON.stringify({ presses, longestMainThreadTaskMs: Math.max(0, ...longTasks), longTasks }));
} catch (error) {
  console.error(error);
  if (process.env.SAGAX_CAPTURE_DEBUG) {
    const page = browser?.contexts()[0]?.pages()[0];
    await page?.screenshot({ path: join(outDir, "debug.png") }).catch(() => undefined);
    console.error(await page?.evaluate(() => [...document.querySelectorAll("[data-plugin-row]")].map((row) => row.getAttribute("data-plugin-row"))).catch(() => []));
  }
  console.error(viteLog.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
