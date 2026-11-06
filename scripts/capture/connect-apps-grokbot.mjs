#!/usr/bin/env node
/**
 * Headless screenshots of Plugins as Grok Bot's Connect Apps (#2104, JC
 * 2026-11-06: the look must be identical). The real panel in the gallery
 * (src/gallery/connect-apps.html?view=manage), no window: the home, the home
 * scrolled (the search row sticks), Manage, a plugin's page, a skill's page and
 * "Add a custom connector", each at DPR 2 for a side-by-side with the
 * reference captures.
 * Usage: node scripts/capture/connect-apps-grokbot.mjs [--out DIR] [--port N]
 *   [--lang en] [--scheme dark|light] [--role member|admin]
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "connect-apps-grokbot")));
const port = Number(arg("--port", "5298"));
const lang = arg("--lang", "en");
const scheme = arg("--scheme", "dark");
const skin = arg("--skin", scheme === "light" ? "pulsatrix-light" : "pulsatrix");
const role = arg("--role", "admin");

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
  const page = await browser.newPage({ viewport: { width: 1100, height: 820 }, deviceScaleFactor: 2, colorScheme: scheme });
  page.on("pageerror", (error) => console.error("page error:", error.stack));
  await page.goto(`${base}?view=manage&skin=${skin}&lang=${lang}&role=${role}`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-plugins-main="discover"]', { timeout: 30_000 });
  const shot = async (name) => {
    await page.waitForTimeout(700);
    const file = join(outDir, `${name}.png`);
    await page.locator('[role="dialog"]').first().screenshot({ path: file });
    console.log("shot", file);
  };
  const home = async () => {
    while (await page.locator("[data-plugins-back]").count()) await page.click("[data-plugins-back]");
    if (await page.locator("[data-plugins-home]").count()) await page.click("[data-plugins-home]");
    await page.waitForSelector('[data-plugins-main="discover"]');
  };

  await shot("1-home");
  // scrolled: the search row sticks under the window's top
  const overflows = await page.locator('[data-plugins-manage="discover"]').evaluate((list) => list.scrollHeight > list.clientHeight + 40);
  if (overflows) {
    await page.locator('[data-plugins-manage="discover"]').evaluate((list) => { list.scrollTop = Math.min(520, list.scrollHeight - list.clientHeight); });
    await page.waitForSelector("[data-plugins-stuck]", { state: "attached" });
    await shot("6-home-scrolled");
    await page.locator('[data-plugins-manage="discover"]').evaluate((list) => { list.scrollTop = 0; });
  } else {
    console.log("skip 6-home-scrolled: the home does not scroll at this size");
  }

  await page.click("[data-plugins-connected]");
  await page.waitForSelector('[data-plugins-main="installed"]');
  // the organization's scope lists the most (and offers the custom connector)
  if (await page.locator('[data-plugins-scope-option="workspace"]').count()) {
    await page.click('[data-plugins-scope-option="workspace"]');
    await page.waitForTimeout(400);
  }
  await shot("2-manage");

  // a plugin's page: the first plugin row of Manage
  const pluginRow = page.locator('[data-installed-entry^="plugin:"] button[aria-label]').first();
  if (await pluginRow.count()) {
    await pluginRow.click();
    await page.waitForSelector("[data-plugins-subpage]");
    await shot("3-plugin-detail");
    await page.locator('[data-plugins-subpage] [data-plugins-list], [data-plugins-subpage] .overflow-y-auto').first().evaluate((list) => { list.scrollTop = list.scrollHeight; }).catch(() => {});
    await shot("4-plugin-detail-scrolled");
    await page.click("[data-plugins-back]");
    await page.waitForSelector('[data-plugins-main="installed"]');
  }

  // a skill's page
  const skillRow = page.locator('[data-installed-entry^="skill:"] button[aria-label]').first();
  if (await skillRow.count()) {
    await skillRow.click();
    await page.waitForSelector("[data-plugins-skill]");
    await shot("5-skill");
    await page.click("[data-plugins-back]");
  } else {
    console.log("skip 5-skill: Manage lists no skill");
  }

  await home();
  await page.locator('[data-plugins-manage="discover"]').evaluate((list) => { list.scrollTop = list.scrollHeight; });
  await page.click("[data-plugins-add-custom]");
  await page.waitForSelector("[data-plugins-connector-page]");
  await shot("7-custom-connector");
} catch (error) {
  console.error(error);
  console.error(viteLog.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
