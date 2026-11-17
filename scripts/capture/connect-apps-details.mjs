#!/usr/bin/env node
/**
 * Headless screenshots of Connect Apps' detail pages (#4453, #4503, #4504,
 * 2026-11-16): a plugin's four tabs, a vendor bundle's tabs, a skill's page, a
 * connector's pages, the bundle card of Discover, the failure notice on its
 * row; each at 1280x800 and at one narrow width. The real panel in the gallery
 * (src/gallery/connect-apps.html), no window, no server.
 * Usage: node scripts/capture/connect-apps-details.mjs [--out DIR] [--port N]
 *   [--lang en|fr] [--scheme dark|light] [--widths 1280,700]
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
const widths = arg("--widths", "1280,700").split(",").map(Number);
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "connect-apps-details")));
const port = Number(arg("--port", "5192"));
const skin = scheme === "light" ? "pulsatrix-light" : "pulsatrix";

const vite = spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: root, stdio: "ignore", env: { ...process.env, NODE_ENV: "development" } });
let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/connect-apps.html`;
  for (let i = 0; i < 240; i++) { try { const res = await fetch(base); if (res.status < 500) break; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 500)); }
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM } : { channel: "chrome" }) });
  for (const width of widths) {
    const height = 800;
    const tag = `${width}x${height}-${scheme}-${lang}`;
    const page = await (await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: scheme })).newPage();
    page.on("pageerror", (error) => console.error("page error:", error.stack));
    const shot = async (name) => {
      await page.waitForTimeout(700);
      const file = join(outDir, `${name}-${tag}.png`);
      await page.screenshot({ path: file });
      // one name on screen, and every text size outside the scale
      const report = await page.evaluate(() => {
        const scale = new Set(["11px", "12px", "13px", "14px", "18px"]);
        const off = [];
        const walker = document.createTreeWalker(document.querySelector("[data-plugins-main]") ?? document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (!node.textContent.trim()) continue;
          const size = getComputedStyle(node.parentElement).fontSize;
          if (!scale.has(size)) off.push(`${size} "${node.textContent.trim().slice(0, 20)}"`);
        }
        return { names: document.querySelectorAll("[data-plugins-detail-name]").length, titles: document.querySelectorAll("[data-plugins-page-title]").length, off: off.slice(0, 5), overflow: document.documentElement.scrollWidth > window.innerWidth };
      });
      console.log("shot", file, JSON.stringify(report));
    };
    const open = async (query) => {
      await page.goto(`${base}?view=manage&products=many${query}&skin=${skin}&lang=${lang}`, { waitUntil: "networkidle" });
      await page.waitForSelector("[data-plugins-main]", { timeout: 30_000 });
    };
    const kind = async (name) => { await page.click(`[data-plugins-kind-tab="${name}"]`); await page.waitForTimeout(400); };
    const wide = width >= 1000;
    const only = arg("--only", "");
    const scene = (name) => !only || only === name;

    // the plugin page: four tabs (the administrator's scope shows what the plugin brought)
    if (scene("plugin")) {
    await open("&role=member&updates=1");
    await kind("plugins");
    await page.locator('[data-installed-entry="plugin:code-review@claude-plugins-official"] button[aria-label]').first().click();
    await page.waitForSelector("[data-plugins-detail]");
    await shot("50-plugin-overview");
    for (const [n, tab] of [["51", "contents"], ["52", "skills"], ["53", "connectors"]]) {
      await page.click(`[data-plugin-detail-tab="${tab}"]`);
      await shot(`${n}-plugin-${tab}`);
    }
    if (wide) {
      // a README rendered, then its source; a code file
      await page.click('[data-plugin-detail-tab="contents"]');
      await page.waitForSelector("[data-file-rendered]");
      await page.click('[data-file-switch] [role="radio"]:last-child');
      await shot("54-plugin-contents-source");
      await page.click('[data-file-row="scripts"]');
      await page.click('[data-file-row="scripts/run-checks.sh"]');
      await shot("55-plugin-contents-code");
    }
    }
    // the bundle: Overview, Skills (the console offers one), Connectors
    if (scene("bundle")) {
    await open("&role=member");
    await kind("plugins");
    await page.locator("[data-vendor-bundle] > button").first().click();
    await page.waitForSelector("[data-vendor-page]");
    await shot("60-bundle-overview");
    if (await page.locator('[data-vendor-tab="skills"]').count()) {
      await page.click('[data-vendor-tab="skills"]');
      await shot("61-bundle-skills");
    }
    await page.click('[data-vendor-tab="connectors"]');
    await shot("62-bundle-connectors");
    }
    // a skill's page: Overview with its update, then Contents
    if (scene("skill")) {
    await open("&role=member&updates=1");
    await kind("skills");
    await page.locator('[data-plugin-skill="weekly-summary"]').click();
    await page.waitForSelector("[data-plugins-skill]");
    await shot("70-skill-overview");
    await page.click('[data-skill-tab="contents"]');
    await page.waitForSelector("[data-file-explorer]");
    await shot("71-skill-contents");
    }
    // a connector's pages: a product of the console (Overview, Tools) and a connector with accounts
    if (scene("connector")) {
    await open("&role=member");
    await kind("connectors");
    await page.locator('[data-person-product="prod-psa"] > button').first().click({ position: { x: 24, y: 20 } });
    await page.waitForSelector("[data-person-product-page]");
    await shot("80-connector-product-overview");
    await page.click('[data-product-tab="tools"]');
    await shot("81-connector-product-tools");
    await open("&role=admin&solo=1");
    await kind("connectors");
    const own = page.locator('[data-installed-entry^="mcp:"] button[aria-label]').first();
    if (await own.count()) {
      await own.click();
      await page.waitForSelector("[data-plugins-detail]");
      await shot("82-connector-own");
    }
    }
    // Discover: the bundle card (a vendor the person has not turned on), beside the slide
    if (scene("discover")) {
    await open("&role=member&bundle=off");
    await kind("plugins");
    await page.click('[data-plugins-view="discover"]');
    await page.waitForSelector('[data-plugins-section="bundles"]', { timeout: 10_000 }).catch(() => {});
    await shot("90-discover-bundle-card");
    }
    // the failed update, said on its row
    if (scene("failure")) {
    await open("&role=member&updates=1");
    await kind("plugins");
    await page.click("[data-plugins-update-all]");
    await page.waitForSelector("[data-update-failure]", { timeout: 10_000 });
    await shot("91-update-failure-on-its-row");
    }
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
