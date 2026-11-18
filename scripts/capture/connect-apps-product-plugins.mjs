#!/usr/bin/env node
/**
 * Headless screenshots of a marketplace plugin named for a product group
 * (#4696): Plugins > Yours (the group's card with the plugin's skills, and
 * "Added by you" without it), the card's "..." menu, the group's page
 * (Overview with the plugin's row, Skills) and the plugin's own page with the
 * product's logo, "Updates first", and the plugin turned off. The real panel
 * in the gallery, invented names.
 * Usage: node scripts/capture/connect-apps-product-plugins.mjs [--out DIR] [--port N] [--lang en|fr] [--scheme dark|light]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; };
const lang = arg("--lang", "en");
const scheme = arg("--scheme", "dark");
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "connect-apps-product-plugins")));
const port = Number(arg("--port", "5211"));
const skin = scheme === "light" ? "pulsatrix-light" : "pulsatrix";
const tag = `1280x800-${scheme}-${lang}`;

const vite = spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: root, stdio: "ignore", env: { ...process.env, NODE_ENV: "development" } });
let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/connect-apps.html`;
  for (let i = 0; i < 480; i++) { try { const res = await fetch(base); if (res.status < 500) break; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 500)); }
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM } : { channel: "chrome" }) });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, colorScheme: scheme })).newPage();
  page.setDefaultTimeout(120_000);
  const shot = async (name) => { await page.waitForTimeout(800); const file = join(outDir, `${name}-${tag}.png`); await page.screenshot({ path: file }); console.log("shot", file); };
  const open = async (plugin = "1") => {
    await page.goto(`${base}?view=manage&role=member&products=many&harbor=15&productPlugin=${plugin}&updates=1&skin=${skin}&lang=${lang}`, { waitUntil: "networkidle", timeout: 240_000 });
    await page.waitForSelector("[data-plugins-main]", { timeout: 240_000 });
    await page.click('[data-plugins-kind-tab="plugins"]');
    await page.waitForTimeout(800);
  };

  // Plugins > Yours: the group's card, then "Added by you"
  await open();
  await shot("50-plugins-yours");
  // the card's "..." menu: the plugin's page, Update, Uninstall
  const card = page.locator('[data-vendor-bundle="vendor:harbor"]');
  await card.hover();
  await card.locator("[data-entry-menu]").click();
  await shot("51-group-card-menu");
  await page.keyboard.press("Escape");
  // the group's page: Overview with the plugin's row, then Skills
  await card.locator(":scope > button").click();
  await page.waitForSelector("[data-vendor-page]");
  await shot("52-group-page-overview");
  if (await page.locator('[data-vendor-plugins]').count()) {
    await page.locator('[data-vendor-plugins]').scrollIntoViewIfNeeded();
    await shot("53-group-page-overview-plugin-row");
  }
  if (await page.locator('[data-vendor-tab="skills"]').count()) {
    await page.click('[data-vendor-tab="skills"]');
    await shot("54-group-page-skills");
  }
  // the plugin's own page, with the product's logo
  await open();
  const row = page.locator('[data-installed-entry="plugin:harbor-suite@example-tools"] button[aria-label]').first();
  if (await row.count()) {
    await row.click();
  } else {
    await card.locator(":scope > button").click();
    await page.waitForSelector("[data-vendor-plugins]");
    await page.locator('[data-vendor-plugins] [data-installed-entry] button[aria-label]').first().click();
  }
  await page.waitForTimeout(800);
  await shot("55-plugin-page");
  // "Updates first": the group whose plugin has an update comes first
  await open();
  await page.click("[data-plugins-sort-button]");
  await page.click('[data-plugins-sort-option="update"]');
  await shot("56-plugins-yours-updates-first");
  // the plugin turned off: the card says "plugin off"
  await open("off");
  await shot("57-plugins-yours-plugin-off");
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
