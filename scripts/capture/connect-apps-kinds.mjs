#!/usr/bin/env node
/**
 * Headless screenshots of Connect Apps' three kinds (#4453, lot 1): Skills,
 * Connectors and Plugins, each with Yours and Discover, at Me and at This
 * bot; the one "+ Add" of a kind; the title bar's "..."; and the neighbour
 * page that already follows the reference (a Settings sub-page in the same
 * window) for a side by side. The real panel in the gallery
 * (src/gallery/connect-apps.html), no window, no server.
 * Usage: node scripts/capture/connect-apps-kinds.mjs [--out DIR] [--port N]
 *   [--lang en|fr] [--scheme dark|light] [--width 1280] [--height 800]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const lang = arg("--lang", "en");
const scheme = arg("--scheme", "dark");
const width = Number(arg("--width", "1280"));
const height = Number(arg("--height", "800"));
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "connect-apps-kinds")));
const port = Number(arg("--port", "5191"));
const skin = scheme === "light" ? "pulsatrix-light" : "pulsatrix";
const tag = `${width}x${height}-${scheme}-${lang}`;

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
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM } : { channel: "chrome" }) });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: scheme });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error("page error:", error.stack));
  const shot = async (name) => {
    await page.waitForTimeout(600);
    const file = join(outDir, `${name}-${tag}.png`);
    await page.screenshot({ path: file });
    console.log("shot", file);
  };
  const open = async (query) => {
    await page.goto(`${base}?${query}&skin=${skin}&lang=${lang}`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-plugins-main]", { timeout: 30_000 });
  };
  const kind = async (name) => { await page.click(`[data-plugins-kind-tab="${name}"]`); await page.waitForTimeout(300); };
  const view = async (name) => { await page.click(`[data-plugins-view="${name}"]`); await page.waitForTimeout(300); };

  // Me: the person's own (an organization member with products)
  await open("view=manage&role=member&products=many");
  if (await page.locator('[data-plugins-scope-option="me"]').count()) await page.click('[data-plugins-scope-option="me"]');
  for (const name of ["skills", "connectors", "plugins"]) {
    await kind(name);
    await view("installed");
    await shot(`me-${name}-yours`);
    await view("discover");
    await shot(`me-${name}-discover`);
  }
  await kind("connectors");
  await view("installed");
  await page.click("[data-plugins-add]");
  await shot("me-connectors-add");
  await page.click("[data-plugins-add]");
  await page.click("[data-plugins-more-button]");
  await shot("me-more");
  await page.keyboard.press("Escape").catch(() => {});

  // This bot: what Rocket receives, split in three
  await open("view=manage&role=member&bot=1&products=many");
  for (const name of ["skills", "connectors", "plugins"]) {
    await kind(name);
    await view("installed");
    await shot(`bot-${name}-yours`);
  }

  // the neighbour page that follows the reference, same window
  await page.goto(`${base}?view=settings-subpage&skin=${skin}&lang=${lang}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await shot("neighbour-settings-subpage");
} catch (error) {
  console.error(error);
  console.error(viteLog.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
