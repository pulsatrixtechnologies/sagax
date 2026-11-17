#!/usr/bin/env node
/**
 * Headless screenshots of the Routines page (2026-11-17): the Overview tab
 * (Runs figures, the routines table), its Filters popover and the grouped
 * view, in French dark and English light, at 1280 and 390 wide. Playwright,
 * no window, no focus taken; mocked API, no server.
 * Usage: node scripts/capture/routines-page.mjs [--out DIR] [--port N]
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "routines-page")));
const port = Number(arg("--port", "5180"));
const height = 1000;
const shots = [
  { name: "overview", query: "tab=overview" },
  { name: "filters", query: "tab=overview", filters: true },
  { name: "grouped-bot", query: "tab=overview&groupBy=bot" },
  { name: "grouped-folder", query: "tab=overview&groupBy=folder" },
  { name: "logs", query: "tab=logs" },
  { name: "empty", query: "tab=overview&empty=1" },
  { name: "all-good", query: "tab=overview&quiet=1" },
];
const looks = [
  { skin: "pulsatrix", scheme: "dark", lang: "fr", tag: "fr-dark" },
  { skin: "daylight", scheme: "light", lang: "en", tag: "en-light" },
];
// Every width gets the overview and the grouped table; 1280 and 390 the whole set.
// 764 is 1024 with the sidebar open; 320 to 600 are the phone widths.
const widths = [1920, 1460, 1280, 1024, 764, 600, 480, 390, 320];
const full = new Set([1280, 390]);

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch { /* retry */ }
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
  const base = `http://127.0.0.1:${port}/src/gallery/routines-overview.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM, headless: true } : { headless: true });
  const errors = [];
  for (const look of looks) {
    for (const width of widths) {
      for (const shot of shots) {
        if (!full.has(width) && !["overview", "grouped-bot"].includes(shot.name)) continue;
        const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: look.scheme });
        page.on("pageerror", (error) => { errors.push(String(error)); console.error(String(error)); });
        page.on("console", (message) => { if (message.type() === "error") console.error(message.text()); });
        await page.goto(`${base}?skin=${look.skin}&lang=${look.lang}&width=${width}&height=${height}&${shot.query}`, { waitUntil: "networkidle" });
        await page.locator("[data-gallery-sample]").waitFor();
        await page.locator("[data-routines-tabs]").waitFor();
        if (shot.filters) {
          await page.locator("[data-automations-filters] > summary").click();
          await page.locator('[data-routine-filter="status"]').waitFor();
        }
        await page.waitForTimeout(400);
        // The layout, at every width: nothing scrolls sideways; from 768 up the table has its five column
        // headers and one line per routine; the trend bars sit on the text's centre line; on the phone a row is
        // two lines at most.
        const layout = await page.evaluate(() => {
          const sample = document.querySelector("[data-gallery-sample]");
          const visible = (element) => element.getClientRects().length > 0;
          const rows = [...document.querySelectorAll("[data-routine-row]")];
          const headers = [...document.querySelectorAll('[role="columnheader"]')].filter((header) => visible(header) && header.textContent.trim()).length;
          const tallest = Math.max(0, ...rows.map((row) => row.getBoundingClientRect().height));
          const off = Math.max(0, ...rows.map((row) => {
            const bar = row.querySelector("[data-trend-mark]");
            const name = row.querySelector("[data-routine-title]");
            if (!bar || !name) return 0;
            const a = bar.getBoundingClientRect();
            const b = name.getBoundingClientRect();
            return Math.abs(a.top + a.height / 2 - (b.top + 9));
          }));
          // the narrow gutter: the header's muted line, the first tab and the content all start 16px from the edge
          const left = (selector) => { const element = document.querySelector(selector); return element ? Math.round(element.getBoundingClientRect().left - sample.getBoundingClientRect().left) : null; };
          const right = (selector) => { const element = document.querySelector(selector); return element ? Math.round(element.getBoundingClientRect().right - sample.getBoundingClientRect().left) : null; };
          const tops = ["[data-routines-search]", "[data-automations-filters] > summary", "[data-routines-table] [data-automations-create]"].map((selector) => { const element = document.querySelector(selector); return element ? Math.round(element.getBoundingClientRect().top + element.getBoundingClientRect().height / 2) : null; });
          const tabs = document.querySelector("[data-routines-tabs]");
          const first = document.querySelector('[data-page-tab="overview"]');
          return { rightEdges: { menu: right("[data-automations-actions]"), content: right("[data-routines-runs]") }, gutter: { icon: left("[data-page-title] svg"), subtitle: left("[data-page-subtitle]"), tab: left('[data-page-tab="overview"]'), content: left("[data-routines-runs]") }, controlsTops: tops, tabsClipped: Boolean(tabs && first && (tabs.scrollLeft > 0 || first.getBoundingClientRect().left < sample.getBoundingClientRect().left)),
            page: sample.scrollWidth - sample.clientWidth, wide: rows.filter((row) => row.scrollWidth > row.clientWidth + 1).length, headers, tallest, off };
        });
        const tag = `${shot.name} ${look.tag} ${width}`;
        if (shot.name === "overview" || shot.name.startsWith("grouped")) {
          // one left edge: the header's icon, muted line and tabs sit on the content's own column, at every width
          const { icon, subtitle, tab, content } = layout.gutter;
          if ([icon, subtitle, tab, content].some((value) => value === null || Math.abs(value - content) > 1)) errors.push(`${tag}: head and content are on different left edges ${JSON.stringify(layout.gutter)}`);
          if (width < 640 && Math.abs(content - 16) > 1) errors.push(`${tag}: the phone gutter is ${content}, not 16`);
          if (width >= 764 && Math.abs(layout.rightEdges.menu - layout.rightEdges.content) > 1) errors.push(`${tag}: the head's right edge ${layout.rightEdges.menu} is not the content's ${layout.rightEdges.content}`);
          if (layout.tabsClipped) errors.push(`${tag}: the first tab is clipped`);
          const tops = layout.controlsTops.filter((value) => value !== null);
          if (tops.length > 1 && Math.max(...tops) - Math.min(...tops) > 4) errors.push(`${tag}: the heading controls are on several rows ${JSON.stringify(layout.controlsTops)}`);
        }
        if (layout.page > 1 || layout.wide > 0) errors.push(`${tag}: overflow ${JSON.stringify(layout)}`);
        if (shot.name !== "empty" && shot.name !== "logs") {
          if (width >= 764 && layout.headers < 5) errors.push(`${tag}: ${layout.headers} column headers, the table needs 5 or more`);
          if (width >= 1024 && layout.tallest > 56) errors.push(`${tag}: a routine row is ${layout.tallest}px tall, more than one line`);
          if (width < 640 && layout.tallest > 80) errors.push(`${tag}: a phone row is ${layout.tallest}px tall, more than two lines`);
        }
        const file = join(outDir, `${shot.name}-${look.tag}-${width}.png`);
        await page.locator("[data-gallery-sample]").screenshot({ path: file });
        console.log(file);
        await page.close();
      }
    }
  }
  if (errors.length) throw new Error(`page errors:\n${errors.join("\n")}`);
} catch (error) {
  console.error(viteLog.slice(-2000));
  throw error;
} finally {
  await browser?.close().catch(() => {});
  vite.kill("SIGTERM");
}
