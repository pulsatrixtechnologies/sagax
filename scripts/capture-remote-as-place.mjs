#!/usr/bin/env node
/**
 * Headless screenshots of remote hosts as Computer places and calm asleep /
 * waking / running screens (2026-11-01). Gallery: src/gallery/remote-as-place.html.
 * Usage: node scripts/capture-remote-as-place.mjs [--out DIR] [--port N] [--lang en]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "remote-as-place")));
const calmDir = join(outDir, "computer-asleep");
const port = Number(arg("--port", "5311"));
const lang = arg("--lang", "en");

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      /* retry */
    }
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
  const base = `http://127.0.0.1:${port}/src/gallery/remote-as-place.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  await mkdir(calmDir, { recursive: true });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.SAGAX_VERIFY_BROWSER_CHROME || process.env.SAGAX_CHROMIUM
      ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME || process.env.SAGAX_CHROMIUM }
      : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });

  await page.goto(`${base}?skin=pulsatrix&lang=${lang}`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-gallery-sample='place-dropdown']");
  await page.waitForSelector("[data-bot-remote-hosts]");
  await page.waitForTimeout(400);
  await page.locator("[data-gallery-sample='place-dropdown']").screenshot({ path: join(outDir, "after-computer-place-closed.png") });
  console.log("after-computer-place-closed.png");
  await page.locator("[data-gallery-sample='endpoints']").screenshot({ path: join(outDir, "after-endpoints-section.png") });
  console.log("after-endpoints-section.png");
  await page.locator("[data-gallery-sample='details-clean']").screenshot({ path: join(outDir, "after-details-no-sessions.png") });
  console.log("after-details-no-sessions.png");

  await page.goto(`${base}?skin=pulsatrix&lang=${lang}&open=1`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-gallery-sample='place-dropdown'] [role='listbox']");
  await page.waitForTimeout(300);
  await page.locator("[data-gallery-sample='place-dropdown']").screenshot({ path: join(outDir, "after-place-dropdown-with-host.png") });
  console.log("after-place-dropdown-with-host.png");

  await page.goto(`${base}?skin=pulsatrix&lang=${lang}&view=calm`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-gallery-sample='asleep'] [data-screen-calm='asleep']");
  await page.waitForSelector("[data-gallery-sample='waking'] [data-screen-calm='waking']");
  await page.waitForSelector("[data-gallery-sample='running'] [data-computer-open]");
  await page.waitForTimeout(500);
  await page.locator("[data-gallery-sample='asleep']").screenshot({ path: join(calmDir, "after-asleep.png") });
  console.log("computer-asleep/after-asleep.png");
  await page.locator("[data-gallery-sample='waking']").screenshot({ path: join(calmDir, "after-waking.png") });
  console.log("computer-asleep/after-waking.png");
  await page.locator("[data-gallery-sample='running']").screenshot({ path: join(calmDir, "after-running-open.png") });
  console.log("computer-asleep/after-running-open.png");

  await page.goto(`${base}?skin=pulsatrix&lang=${lang}&view=rename`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-computer-rename-input]");
  await page.waitForTimeout(300);
  await page.locator("[data-gallery-sample='place-dropdown']").screenshot({ path: join(calmDir, "after-place-rename.png") });
  console.log("computer-asleep/after-place-rename.png");
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
  if (vite.exitCode === null) await Promise.race([new Promise((r) => vite.once("exit", r)), new Promise((r) => setTimeout(r, 5_000))]);
  if (vite.exitCode === null) vite.kill("SIGKILL");
  if (vite.exitCode && vite.exitCode !== 0 && !viteLog.includes(String(port))) console.error(viteLog);
}
