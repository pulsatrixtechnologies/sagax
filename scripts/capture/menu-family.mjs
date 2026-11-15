#!/usr/bin/env node
/**
 * Headless captures of the menu family (#4183): the conversation menu, the
 * section menu and the conversation's "..." menu (src/gallery/context-menus),
 * then the sidebar's bot row menu beside the account menu, the conforming
 * neighbour (src/gallery/app-shell-sidebar), the cards' three dots menus
 * and a team section's menu (src/gallery/row-menus), light and dark, English and
 * French. Headless Chromium only: no window opens.
 * Usage: node scripts/capture/menu-family.mjs [--out DIR] [--port N] [--prefix before|after]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "menu-family"));
const port = Number(arg("--port") ?? 5311);
const prefix = arg("--prefix") ?? "after";
const skins = [{ id: "pulsatrix-light", label: "light" }, { id: "pulsatrix", label: "dark" }];
const langs = ["en", "fr"];

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
  const base = `http://127.0.0.1:${port}/src/gallery`;
  await waitForServer(`${base}/context-menus.html`);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, channel: process.env.SAGAX_CAPTURE_CHANNEL ?? "chrome" });
  for (const skin of skins) for (const lang of langs) {
    const tag = `${skin.label}-${lang}`;
    // the conversation menu and its neighbours
    let page = await browser.newPage({ viewport: { width: 760, height: 560 }, deviceScaleFactor: 2 });
    await page.goto(`${base}/context-menus.html?skin=${skin.id}&lang=${lang}`, { waitUntil: "networkidle" });
    await page.locator('[role="menu"]').first().waitFor({ timeout: 60_000 });
    const exportButton = page.locator('.fixed.right-6 button[aria-haspopup="menu"]').first();
    if (await exportButton.count()) await exportButton.click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(outDir, `${prefix}-context-menus-${tag}.png`) });
    await page.close();
    // the sidebar: a bot row's menu, then the account menu beside it
    page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    await page.goto(`${base}/app-shell-sidebar.html?skin=${skin.id}&lang=${lang}&parity=1`, { waitUntil: "networkidle" });
    const row = page.locator("[data-sidebar-bot-row]").first();
    await row.waitFor({ timeout: 60_000 });
    await row.click({ button: "right" });
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(outDir, `${prefix}-bot-row-menu-${tag}.png`) });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    const account = page.locator('[data-sidebar-account-row] button[aria-haspopup="menu"], [data-sidebar-account-rail] button[aria-haspopup="menu"]').first();
    await account.click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(outDir, `${prefix}-account-menu-${tag}.png`) });
    await page.close();
    // the cards' three dots menus: the goal card, a message, the call card
    for (const [sample, opener] of [["goal", "[data-goal-run-more]"], ["message", "[data-more-button]"], ["call", "[data-voice-call] summary"]]) {
      page = await browser.newPage({ viewport: { width: 640, height: 520 }, deviceScaleFactor: 2 });
      await page.goto(`${base}/row-menus.html?skin=${skin.id}&lang=${lang}`, { waitUntil: "networkidle" });
      const button = page.locator(`[data-sample="${sample}"] ${opener}`).first();
      await button.waitFor({ state: "attached", timeout: 60_000 });
      await page.locator(`[data-sample="${sample}"]`).hover();
      await button.click({ force: true });
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(outDir, `${prefix}-${sample}-menu-${tag}.png`) });
      await page.close();
    }
    // a team map section's three dots menu
    page = await browser.newPage({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 2 });
    await page.goto(`${base}/row-menus.html?skin=${skin.id}&lang=${lang}&sample=team`, { waitUntil: "networkidle" });
    const manage = page.locator("section details > summary[aria-label]").last();
    await manage.waitFor({ timeout: 60_000 });
    await manage.click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(outDir, `${prefix}-team-section-menu-${tag}.png`) });
    await page.close();
  }
  console.log(`captures in ${outDir}`);
} catch (error) {
  console.error(error);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* gone */ }
}
