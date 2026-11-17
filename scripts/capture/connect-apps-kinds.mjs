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
  page.on("response", (res) => { if (res.status() >= 400 && !res.url().endsWith("/api/events")) console.log("api", res.status(), res.request().method(), new URL(res.url()).pathname); });
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
    const head = await page.evaluate(() => {
      const h = document.querySelector("[data-plugins-head]"); const k = document.querySelector("[data-plugins-kind-row]");
      const slot = document.querySelector("[data-plugins-kind-row] [data-plugins-search-slot]");
      if (!h) return null;
      return { headH: Math.round(h.getBoundingClientRect().height), tabsLineH: Math.round(k?.getBoundingClientRect().height ?? 0), searchW: Math.round(slot?.getBoundingClientRect().width ?? 0), iconSearch: Boolean(document.querySelector("[data-plugins-search-toggle]")), rowW: Math.round(k?.getBoundingClientRect().width ?? 0), kinds: Math.round(document.querySelector("[data-plugins-kinds]")?.getBoundingClientRect().width ?? 0), views: Math.round(document.querySelector("[data-plugins-views]")?.getBoundingClientRect().width ?? 0), actions: Math.round(document.querySelector("[data-plugins-actions]")?.getBoundingClientRect().width ?? 0), alert: document.querySelector("[role=alert]")?.textContent ?? null };
    });
    console.log("head", name, JSON.stringify(head));
    console.log("sizes", name, JSON.stringify(report.sizes), report.off.length ? `OFF ${JSON.stringify(report.off)}` : "");
  };
  const open = async (query) => {
    await page.goto(`${base}?${query}&skin=${skin}&lang=${lang}`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-plugins-main]", { timeout: 30_000 });
  };
  const kind = async (name) => { await page.click(`[data-plugins-kind-tab="${name}"]`); await page.waitForTimeout(300); };
  const view = async (name) => { await page.click(`[data-plugins-view="${name}"]`); await page.waitForTimeout(300); };


    const clickIf = async (selector) => { if (await page.locator(selector).count()) await page.click(selector); };

  // --only header: the three header captures (01, 21, 22), nothing else
  if (arg("--only", "") === "header") {
    await open("view=manage&role=member&products=many&updates=1");
    await kind("connectors");
    await view("installed");
    await shot("01-header-connectors-yours");
    await view("discover");
    await clickIf("[data-plugins-filter-button]");
    await clickIf('[data-plugins-chip="communication"]');
    await clickIf("[data-plugins-sort-button]");
    await clickIf('[data-plugins-sort-option="name"]');
    await shot("21-header-discover-filter-active");
    await view("installed");
    await shot("22-header-yours-sort-active");
    process.exitCode = 0;
    throw Object.assign(new Error("header only"), { headerOnly: true });
  }

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
    // one row height for every row of a section, whatever its second line holds
    const heights = await page.evaluate(() => [...new Set([...document.querySelectorAll("[data-plugins-console-section] [data-item-row], [data-plugins-console-section] [data-person-product]")].map((row) => Math.round(row.getBoundingClientRect().height)))]);
    console.log("row heights", name, JSON.stringify(heights));
  }

  // (a vendor is one bundle page now, not an unfolding row: see connect-apps-details.mjs)
  await kind("connectors");
  await view("installed");

  // the right-click menu on a vendor row, then "Choose the bots"
  const row = page.locator("[data-person-product] , [data-item-row]").first();
  await row.click({ button: "right", position: { x: 160, y: 24 } });
  await shot("04-right-click-menu");
  if (await page.locator('[data-entry-action="choose"]').count()) {
    await page.click('[data-entry-action="choose"]');
    await page.waitForTimeout(300);
    await shot("05-choose-the-bots");
  }
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
  // the Install menu (For all my bots, For one bot...): a plugin, which a person may put on one bot
  await kind("plugins");
  await view("discover");
  await clickIf('[data-install-button][aria-haspopup="menu"]');
  await shot("09-install-menu");
  await page.keyboard.press("Escape");
  await page.mouse.click(5, 5);
  for (const name of ["skills", "plugins"]) {
    await kind(name);
    await view("discover");
    await shot(`10-discover-${name}`);
  }
  await view("installed");
  await clickIf("[data-plugins-more-button]");
  await shot("11-more-menu");
  await page.keyboard.press("Escape");

  // a state icon's tooltip, open (hover on the first warning icon of Yours)
  await open("view=manage&role=member&products=many");
  await kind("connectors");
  await view("installed");
  const fixIcon = page.locator("[data-row-state-fix]").first();
  if (await fixIcon.count()) {
    await fixIcon.hover();
    await page.waitForTimeout(250);
    await shot("18-state-tooltip-open");
    await page.mouse.move(5, 5);
  }

  // the featured block on two slides: a curated pick and the organization's vendor, dots visible
  await view("discover");
  const dots = page.locator("[data-featured-dot]");
  const count = await dots.count();
  if (count > 0) {
    await dots.first().click();
    await page.locator("[data-featured-banner]").hover();
    await page.waitForTimeout(250);
    await shot("19-featured-curated-slide");
    await dots.nth(count - 1).click();
    await page.locator("[data-featured-banner]").hover();
    await page.waitForTimeout(250);
    await shot("20-featured-vendor-slide");
    await page.mouse.move(5, 5);
  }

  // the header with a filter active (Discover) and a sort that is not the default (Yours)
  await clickIf("[data-plugins-filter-button]");
  await clickIf('[data-plugins-chip="communication"]');
  await clickIf("[data-plugins-sort-button]");
  await clickIf('[data-plugins-sort-option="name"]');
  await shot("21-header-discover-filter-active");
  await view("installed");
  await shot("22-header-yours-sort-active");

  // Plugins: Yours with the console's section, Yours with none of their own (the first banner), Discover
  await kind("plugins");
  await view("installed");
  await shot("15-plugins-yours-organization-section");
  await open("view=manage&role=member&products=many&empty=plugins");
  await kind("plugins");
  await view("installed");
  await shot("16-plugins-yours-empty-banner");
  await view("discover");
  await shot("17-plugins-discover");

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

  // the narrowest window the control row is meant for: the search is an icon, the row holds
  const narrowCtx = await browser.newContext({ viewport: { width: 700, height: 800 }, deviceScaleFactor: 2, colorScheme: scheme });
  const narrowPage = await narrowCtx.newPage();
  await narrowPage.goto(`${base}?view=manage&role=member&products=many&skin=${skin}&lang=${lang}`, { waitUntil: "networkidle" });
  await narrowPage.waitForSelector("[data-plugins-main]", { timeout: 30_000 });
  await narrowPage.click('[data-plugins-kind-tab="connectors"]');
  await narrowPage.waitForTimeout(600);
  await narrowPage.screenshot({ path: join(outDir, `23-narrow-header-700x800-${scheme}-${lang}.png`) });
  console.log("shot narrow", scheme, lang);
  await narrowCtx.close();

  // the neighbour page that follows the reference, same window
  await page.goto(`${base}?view=settings-subpage&skin=${skin}&lang=${lang}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await shot("14-neighbour-settings-subpage");
} catch (error) {
  if (!error?.headerOnly) {
    console.error(error);
    console.error(viteLog.slice(-2000));
    process.exitCode = 1;
  }
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
