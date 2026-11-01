#!/usr/bin/env node
/**
 * Headless screenshots of Settings > Models > Bot models (#1675).
 * Playwright, no window: the real SettingsModal in the gallery
 * (src/gallery/settings-pages.html?section=engines, synthetic bots).
 * Shots: page overview, section select, bulk confirmation.
 * Usage: node scripts/capture-bot-models-page.mjs [--out DIR] [--port N]
 *   [--lang en] [--prefix after] [--width 1100] [--scheme dark|light]
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "bot-models-page")));
const port = Number(arg("--port", "5311"));
const lang = arg("--lang", "en");
const prefix = arg("--prefix", "after");
const width = Number(arg("--width", "1100"));
const scheme = arg("--scheme", "light");
const skin = arg("--skin", scheme === "light" ? "pulsatrix-light" : "pulsatrix");

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
  const base = `http://127.0.0.1:${port}/src/gallery/settings-pages.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.SAGAX_VERIFY_BROWSER_CHROME || process.env.SAGAX_CHROMIUM
      ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME || process.env.SAGAX_CHROMIUM }
      : {}),
  });
  const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme });
  page.on("pageerror", (error) => console.error("page error:", error.stack));
  // Solo gallery: Defaults for new bots show; bots still have sections and owners.
  await page.goto(`${base}?section=engines&skin=${skin}&lang=${lang}&providers=1`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-bot-models-page]", { timeout: 30_000 });
  await page.waitForSelector("[data-bot-models-row]", { timeout: 30_000 });
  const dialog = page.locator('[role="dialog"]').first();
  const shot = async (name) => {
    await page.waitForTimeout(500);
    const file = join(outDir, `${prefix}-${name}.png`);
    await dialog.screenshot({ path: file });
    console.log("shot", file);
  };
  await shot("1-page");
  // Prefer section select; fall back to checking each Clients row.
  const sectionBox = page.locator('[data-bot-models-section="Clients"] [data-bot-models-section-select]');
  await sectionBox.scrollIntoViewIfNeeded();
  await sectionBox.check({ force: true });
  if (!(await page.locator("[data-bot-models-bulk-bar]").count())) {
    for (const id of ["bot-0", "bot-1"]) {
      await page.locator(`[data-bot-models-select="${id}"]`).check({ force: true });
    }
  }
  await page.waitForSelector("[data-bot-models-bulk-bar]", { timeout: 10_000 });
  await page.locator("[data-bot-models-bulk-bar]").scrollIntoViewIfNeeded();
  await shot("2-section-selected");
  await page.locator("[data-bot-models-bulk-auto]").click({ force: true });
  await page.waitForSelector("[data-bot-models-bulk-confirm]", { timeout: 10_000 });
  await shot("3-bulk-confirm");
  const facts = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("[data-bot-models-row]")].map((node) => node.getAttribute("data-bot-models-row"));
    const sections = [...document.querySelectorAll("[data-bot-models-section]")].map((node) => node.getAttribute("data-bot-models-section"));
    const lines = [...document.querySelectorAll("[data-bot-models-bulk-line]")].map((node) => node.getAttribute("data-bot-models-bulk-line"));
    const tables = document.querySelectorAll("[data-bot-models-table]").length;
    const cols = [...document.querySelectorAll("[data-bot-models-col]")].map((node) => node.getAttribute("data-bot-models-col"));
    // Column left edges must match across the first bot row of every section.
    const bySection = new Map();
    for (const row of document.querySelectorAll("[data-bot-models-row]")) {
      const section = row.getAttribute("data-bot-models-section-of") || "";
      if (bySection.has(section)) continue;
      const cells = [...row.children].map((cell) => {
        const box = cell.getBoundingClientRect();
        return { left: Math.round(box.left), width: Math.round(box.width) };
      });
      bySection.set(section, cells);
    }
    const layouts = [...bySection.entries()].map(([section, cells]) => ({ section, cells }));
    const reference = layouts[0]?.cells ?? [];
    const aligned = layouts.every((layout) =>
      layout.cells.length === reference.length
      && layout.cells.every((cell, index) =>
        cell.left === reference[index].left && cell.width === reference[index].width));
    return {
      rows,
      sections,
      lines,
      tables,
      cols,
      columnLayouts: layouts,
      columnsAligned: aligned,
      hasDefaults: Boolean(document.querySelector("[data-bot-models-page]")?.textContent?.includes("Defaults")
        || document.querySelector("[data-bot-models-page]")?.textContent?.includes("Défauts")),
      selected: [...document.querySelectorAll("[data-bot-models-select]:checked")].map((node) => node.getAttribute("data-bot-models-select")),
    };
  });
  await writeFile(join(outDir, `${prefix}-capture.json`), JSON.stringify({ lang, scheme, skin, width, facts }, null, 2) + "\n");
  console.log(JSON.stringify(facts));
  if (facts.rows.length < 2) throw new Error(`expected at least 2 bot rows, got ${facts.rows.length}`);
  if (!facts.sections.includes("Clients")) throw new Error("Clients section missing");
  if (facts.lines.length < 1) throw new Error("bulk confirm had no lines");
  if (!facts.hasDefaults) throw new Error("Defaults for new bots missing on solo gallery");
  if (facts.tables !== 1) throw new Error(`expected one shared bot-models table, got ${facts.tables}`);
  if (facts.cols.length !== 6) throw new Error(`expected 6 colgroup cols, got ${facts.cols.length}`);
  if (!facts.columnsAligned) throw new Error(`columns not aligned across sections: ${JSON.stringify(facts.columnLayouts)}`);
} catch (error) {
  console.error(error);
  console.error(viteLog.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  vite.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => { vite.kill("SIGKILL"); resolve(); }, 3000);
    vite.on("exit", () => { clearTimeout(timer); resolve(); });
  });
}
