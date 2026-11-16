#!/usr/bin/env node
/**
 * Headless screenshots of Connect Apps' three kinds (#4453, lot 1, header and
 * grouping redone 2026-11-16): one row of controls with underlined tabs, no
 * scope control, the scope on the item (right click, Choose the bots, the
 * Install menu), a vendor row unfolded, the window from a bot's page; the
 * neighbour page that already follows the reference (a Settings sub-page in the same
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
    // every text size on screen, and the elements outside the one scale
    const report = await page.evaluate(() => {
      const scale = new Set(["11px", "12px", "13px", "14px", "18px"]);
      const sizes = {}; const off = [];
      const root = document.querySelector("[data-plugins-main]") ?? document.body;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.textContent.trim()) continue;
        const size = getComputedStyle(node.parentElement).fontSize;
        sizes[size] = (sizes[size] ?? 0) + 1;
        if (!scale.has(size)) off.push(`${size} ${node.parentElement.tagName.toLowerCase()}.${String(node.parentElement.className).slice(0, 40)} "${node.textContent.trim().slice(0, 24)}"`);
      }
      return { sizes, off: off.slice(0, 6) };
    });
    console.log("sizes", name, JSON.stringify(report.sizes), report.off.length ? `OFF ${JSON.stringify(report.off)}` : "");
  };
  const open = async (query) => {
    await page.goto(`${base}?${query}&skin=${skin}&lang=${lang}`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-plugins-main]", { timeout: 30_000 });
  };
  const kind = async (name) => { await page.click(`[data-plugins-kind-tab="${name}"]`); await page.waitForTimeout(300); };
  const view = async (name) => { await page.click(`[data-plugins-view="${name}"]`); await page.waitForTimeout(300); };


    const clickIf = async (selector) => { if (await page.locator(selector).count()) await page.click(selector); };

  // Me: the person's own (an organization member with products). One row of
  // controls, no scope control; the scope is chosen on the item.
  await open("view=manage&role=member&products=many");
  await kind("connectors");
  await view("installed");
  await shot("01-header-connectors-yours");
  for (const name of ["skills", "connectors", "plugins"]) {
    await kind(name);
    await view("installed");
    await shot(`02-yours-${name}`);
  }

  // a vendor row unfolded to its products
  await kind("connectors");
  await view("installed");
  await page.click("[data-vendor-toggle]");
  await shot("03-vendor-unfolded");
  await page.click("[data-vendor-toggle]");

  // the right-click menu on a vendor row, then "Choose the bots"
  const row = page.locator("[data-vendor] [data-item-row]").first();
  await row.click({ button: "right", position: { x: 160, y: 24 } });
  await shot("04-right-click-menu");
  await page.click('[data-entry-action="choose"]');
  await page.waitForTimeout(300);
  await shot("05-choose-the-bots");
  await page.keyboard.press("Escape");
  await page.mouse.click(5, 5);

  // the "..." menu of a plugin row
  await kind("plugins");
  await view("installed");
  if (await page.locator("[data-entry-menu]").count()) {
    await page.locator("[data-entry-menu]").first().click();
    await shot("06-plugin-menu");
    await page.keyboard.press("Escape");
  }

  // Discover with the filter open, and the Install menu
  await kind("connectors");
  await view("discover");
  await shot("07-discover-connectors");
  await clickIf("[data-plugins-filter-button]");
  await shot("08-discover-filter-open");
  await page.keyboard.press("Escape");
  await page.mouse.click(5, 5);
  await view("discover");
  await clickIf("[data-install-button]");
  await shot("09-install-menu");
  await page.keyboard.press("Escape");
  await page.mouse.click(5, 5);
  for (const name of ["skills", "plugins"]) {
    await kind(name);
    await view("discover");
    await shot(`10-discover-${name}`);
  }
  await view("installed");
  await page.click("[data-plugins-more-button]");
  await shot("11-more-menu");
  await page.keyboard.press("Escape");

  // opened from a bot's page: the same window, the title carries the bot's name
  await open("view=manage&role=member&bot=1&products=many");
  await kind("connectors");
  await view("installed");
  await shot("12-from-a-bot-connectors");
  await kind("plugins");
  await shot("13-from-a-bot-plugins");

  // type scale: every text size on screen in the window (before / after)
  const sizes = await page.evaluate(() => {
    const out = {};
    const root = document.querySelector("[data-plugins-main]");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent.trim()) continue;
      const size = getComputedStyle(node.parentElement).fontSize;
      out[size] = (out[size] ?? 0) + 1;
    }
    return out;
  });
  console.log("type sizes", tag, JSON.stringify(sizes));

  // the neighbour page that follows the reference, same window
  await page.goto(`${base}?view=settings-subpage&skin=${skin}&lang=${lang}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await shot("14-neighbour-settings-subpage");
} catch (error) {
  console.error(error);
  console.error(viteLog.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
