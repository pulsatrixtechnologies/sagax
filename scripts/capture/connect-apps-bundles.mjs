#!/usr/bin/env node
/**
 * Headless screenshots of a vendor as one bundle (#4453): its row under
 * Plugins, its page (Overview, Connectors), its products as rows of
 * Connectors marked "in <vendor>", a plugin's page with its tabs, and the
 * calm failure notice of an update. The real panel in the gallery.
 * Usage: node scripts/capture/connect-apps-bundles.mjs [--out DIR] [--port N] [--lang en|fr] [--scheme dark|light]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; };
const lang = arg("--lang", "en");
const scheme = arg("--scheme", "dark");
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "connect-apps-bundles")));
const port = Number(arg("--port", "5200"));
const skin = scheme === "light" ? "pulsatrix-light" : "pulsatrix";
const tag = `1280x800-${scheme}-${lang}`;

const vite = spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: root, stdio: "ignore", env: { ...process.env, NODE_ENV: "development" } });
let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/connect-apps.html`;
  for (let i = 0; i < 240; i++) { try { const res = await fetch(base); if (res.status < 500) break; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 500)); }
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM } : { channel: "chrome" }) });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, colorScheme: scheme })).newPage();
  const shot = async (name) => { await page.waitForTimeout(500); const file = join(outDir, `${name}-${tag}.png`); await page.screenshot({ path: file }); console.log("shot", file); };
  const open = async (query = "") => {
    await page.goto(`${base}?view=manage&role=member&products=many&updates=1${query}&skin=${skin}&lang=${lang}`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-plugins-main]", { timeout: 30_000 });
  };
  const kind = async (name) => { await page.click(`[data-plugins-kind-tab="${name}"]`); await page.waitForTimeout(400); };

  // the bundle: one row under Plugins
  await open();
  await kind("plugins");
  await page.locator("[data-vendor-bundle]").first().scrollIntoViewIfNeeded();
  await shot("40-bundle-row-plugins");
  // its page: Overview, then Connectors
  await page.locator("[data-vendor-bundle] > button").first().click();
  await page.waitForSelector("[data-vendor-page]");
  await shot("41-bundle-page-overview");
  await page.click('[data-vendor-tab="connectors"]');
  await shot("42-bundle-page-connectors");
  // its products stay rows of Connectors, marked "in <vendor>"
  await open();
  await kind("connectors");
  await shot("43-connectors-yours-in-vendor-chips");
  // the featured slide of the vendor opens the same page
  await page.click('[data-plugins-view="discover"]');
  const dots = page.locator("[data-featured-dot]");
  const count = await dots.count();
  if (count > 0) {
    await dots.nth(count - 1).click();
    await page.locator("[data-featured-banner]").hover();
    await page.click("[data-featured-vendor-go]");
    await page.waitForSelector("[data-vendor-page]");
    await shot("44-featured-slide-opens-bundle");
  }
  // a plugin's page with its tabs (Overview and Skills for a plugin that brings a skill)
  await open();
  await kind("plugins");
  await page.locator('[data-installed-entry="plugin:code-review@claude-plugins-official"] button[aria-label]').first().click();
  await page.waitForTimeout(600);
  await shot("45-plugin-page-overview");
  if (await page.locator('[data-plugin-detail-tab="skills"]').count()) {
    await page.click('[data-plugin-detail-tab="skills"]');
    await shot("46-plugin-page-skills");
  }
  // the calm failure notice of an update
  await open();
  await kind("plugins");
  await page.click("[data-plugins-update-all]");
  await page.waitForSelector("[data-update-failure]", { timeout: 10_000 });
  await shot("47-update-failure-notice");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
