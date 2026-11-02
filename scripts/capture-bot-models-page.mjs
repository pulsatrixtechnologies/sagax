#!/usr/bin/env node
/**
 * Headless screenshots of Settings > Models > Bot models (#1675).
 * Playwright, no window: the real SettingsModal in the gallery
 * (src/gallery/settings-pages.html?section=engines, synthetic bots).
 * Shots: page overview, section select, bulk confirmation.
 * Also asserts list controls do not overlap at the requested width.
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
  // ConfirmDialog portals to body; the summary lives inside that portal.
  await page.waitForSelector("[data-bot-models-bulk-summary]", { timeout: 10_000 });
  await shot("3-bulk-confirm");
  const facts = await page.evaluate(() => {
    const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const boxOf = (node) => {
      const r = node.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const rows = [...document.querySelectorAll("[data-bot-models-row]")].map((node) => node.getAttribute("data-bot-models-row"));
    const sections = [...document.querySelectorAll("[data-bot-models-section]")].map((node) => node.getAttribute("data-bot-models-section"));
    const lines = [...document.querySelectorAll("[data-bot-models-bulk-line]")].map((node) => node.getAttribute("data-bot-models-bulk-line"));
    const tables = document.querySelectorAll("[data-bot-models-table]").length;
    const lists = document.querySelectorAll("[data-bot-models-list]").length;
    const cols = [...document.querySelectorAll("[data-bot-models-col]")].map((node) => node.getAttribute("data-bot-models-col"));
    const nativeSelects = document.querySelectorAll("[data-bot-models-effort] select").length;
    const overlapHits = [];
    const unreachable = [];
    for (const row of document.querySelectorAll("[data-bot-models-row]")) {
      const id = row.getAttribute("data-bot-models-row") || "";
      const cells = [
        row.querySelector("[data-bot-models-model]"),
        row.querySelector("[data-bot-models-effort]"),
        row.querySelector("[data-bot-models-payer]"),
        row.querySelector("[data-bot-models-backup]"),
      ].filter(Boolean);
      const boxes = cells.map((cell) => ({ id, kind: cell.getAttributeNames().find((name) => name.startsWith("data-bot-models-")) || "cell", ...boxOf(cell) }));
      for (let i = 0; i < boxes.length; i += 1) {
        if (boxes[i].width < 4 || boxes[i].height < 4) unreachable.push({ id, kind: boxes[i].kind, box: boxes[i] });
        for (let j = i + 1; j < boxes.length; j += 1) {
          if (overlaps(boxes[i], boxes[j])) overlapHits.push({ id, a: boxes[i].kind, b: boxes[j].kind, aBox: boxes[i], bBox: boxes[j] });
        }
      }
      const focusable = row.querySelectorAll("button, [data-pill-select], [data-control], input[type=checkbox]");
      if (focusable.length < 2) unreachable.push({ id, kind: "row-controls", count: focusable.length });
    }
    return {
      rows,
      sections,
      lines,
      tables,
      lists,
      cols,
      nativeSelects,
      overlapHits,
      unreachable,
      hasDefaults: Boolean(document.querySelector("[data-bot-models-page]")?.textContent?.includes("Defaults")
        || document.querySelector("[data-bot-models-page]")?.textContent?.includes("Défauts")),
      selected: [...document.querySelectorAll("[data-bot-models-select]:checked")].map((node) => node.getAttribute("data-bot-models-select")),
      bulkEffort: Boolean(document.querySelector("[data-bot-models-bulk-effort]")),
      bulkBackup: Boolean(document.querySelector("[data-bot-models-bulk-backup]")),
    };
  });
  await writeFile(join(outDir, `${prefix}-capture.json`), JSON.stringify({ lang, scheme, skin, width, facts }, null, 2) + "\n");
  console.log(JSON.stringify(facts));
  if (facts.rows.length < 2) throw new Error(`expected at least 2 bot rows, got ${facts.rows.length}`);
  if (!facts.sections.includes("Clients")) throw new Error("Clients section missing");
  if (facts.lines.length < 1) throw new Error("bulk confirm had no lines");
  if (!facts.hasDefaults) throw new Error("Defaults for new bots missing on solo gallery");
  if (facts.tables !== 1) throw new Error(`expected one shared bot-models list marker, got ${facts.tables}`);
  if (facts.lists !== 1) throw new Error(`expected one bot-models list, got ${facts.lists}`);
  if (facts.cols.length !== 6) throw new Error(`expected 6 column labels, got ${facts.cols.length}`);
  if (facts.nativeSelects !== 0) throw new Error(`expected no native effort selects, got ${facts.nativeSelects}`);
  if (facts.overlapHits.length) throw new Error(`controls overlap at width ${width}: ${JSON.stringify(facts.overlapHits)}`);
  if (facts.unreachable.length) throw new Error(`unreachable controls at width ${width}: ${JSON.stringify(facts.unreachable)}`);
  if (!facts.bulkEffort || !facts.bulkBackup) throw new Error("bulk bar missing effort or backup action");
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
