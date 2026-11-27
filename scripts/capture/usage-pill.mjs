#!/usr/bin/env node
/**
 * Captures of the usage pill (#5406): every shape in six situations, and the
 * pill's detail under a message box for 1, 3 and 10 accounts, a week that
 * Extra Usage still serves and a local model left free (#5421) (gallery
 * src/gallery/usage-pill.html), then the rows of Settings > Appearance >
 * Conversation (gallery src/gallery/panel-visibility.html), light and dark.
 * Headless Chrome only.
 *
 *   node scripts/capture/usage-pill.mjs [--out DIR] [--port N] [--lang fr|en]
 *
 * SAGAX_CHROMIUM overrides the Chrome binary. Writes notes.json beside the
 * PNGs with what the DOM says (each pill's text, the detail's rows and height).
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = resolve(arg("--out", join(here, "docs", "screenshots", "usage-pill-5406")));
const port = Number(arg("--port", "5361"));
const lang = arg("--lang", "fr");

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`gallery did not start at ${url}`);
}

// vite itself, not through pnpm: a SIGTERM must reach the process that listens
const vite = spawn(
  process.execPath,
  [join(here, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: here, stdio: "ignore", env: { ...process.env, NODE_ENV: "development" } },
);
let browser;
const notes = [];
try {
  const origin = `http://127.0.0.1:${port}`;
  const gallery = `${origin}/src/gallery/usage-pill.html`;
  await waitForServer(gallery);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM } : { channel: "chrome" }) });
  const details = [
    ["1", "accounts=1"],
    ["1-blocked", "accounts=1&state=blocked"],
    ["3", "accounts=3"],
    ["3-blocked", "accounts=3&state=blocked"],
    ["10", "accounts=10"],
    ["10-folds-open", "accounts=10&folds=open"],
    ["1-extra", "accounts=1&state=extra"],
    ["3-local", "accounts=3&state=local"],
  ];
  for (const [scheme, skin] of [["light", "daylight"], ["dark", "pulsatrix"]]) {
    const open = async (query, viewport) => {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
      page.setDefaultTimeout(120_000);
      await page.goto(`${gallery}?skin=${skin}&lang=${lang}&${query}`, { waitUntil: "networkidle", timeout: 180_000 });
      return page;
    };
    const shapes = await open("view=shapes", { width: 1280, height: 420 });
    await shapes.waitForSelector("[data-gallery-shape='text'] [data-usage-pill]");
    await shapes.waitForTimeout(300);
    const shapesFile = `shapes-${lang}-${scheme}.png`;
    await shapes.locator('[data-gallery-sample="shapes"]').screenshot({ path: join(outDir, shapesFile) });
    notes.push({
      file: shapesFile,
      pills: await shapes.$$eval("[data-gallery-shape]", (rows) => rows.map((row) => ({
        shape: row.getAttribute("data-gallery-shape"),
        texts: [...row.querySelectorAll("[data-usage-pill]")].map((pill) => `${pill.textContent} [${pill.getAttribute("data-tone")}]`),
      }))),
    });
    await shapes.close();
    for (const [name, query] of details) {
      const page = await open(`view=detail&${query}`, { width: 820, height: 520 });
      await page.waitForSelector('[data-composer-meter-detail="usage"] [data-usage-account]');
      await page.waitForTimeout(300);
      const file = `detail-${name}-${lang}-${scheme}.png`;
      await page.locator('[data-gallery-sample="detail"]').screenshot({ path: join(outDir, file) });
      notes.push({
        file,
        ...(await page.evaluate(() => {
          const detail = document.querySelector('[data-composer-meter-detail="usage"]');
          const table = detail?.querySelector("[data-usage-detail]");
          return {
            pill: document.querySelector('[data-composer-meter-half="usage"]')?.textContent,
            header: detail?.querySelector("[data-usage-free]")?.textContent,
            rows: [...(detail?.querySelectorAll("[data-usage-account]") ?? [])].map((row) => `${row.hasAttribute("data-serving") ? "> " : ""}${[...row.children].map((cell) => cell.textContent).join(" | ")}`),
            folds: [...(detail?.querySelectorAll("[data-usage-fold]") ?? [])].map((fold) => `${fold.textContent} [${fold.getAttribute("aria-expanded")}]`),
            tableHeight: table ? Math.round(table.getBoundingClientRect().height) : null,
            tableScrolls: table ? table.scrollHeight > table.clientHeight : null,
            actions: [...(detail?.querySelectorAll('[role="menuitem"]') ?? [])].map((node) => node.textContent),
          };
        })),
      });
      await page.close();
    }
    // The rows on the Appearance page (no server behind the gallery: /api answers 404).
    const page = await browser.newPage({ viewport: { width: 1338, height: 1200 }, deviceScaleFactor: 2 });
    page.setDefaultTimeout(120_000);
    await page.route((url) => url.pathname.startsWith("/api/"), (route) => route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"not found"}' }));
    await page.goto(`${origin}/src/gallery/panel-visibility.html?skin=${skin}&lang=${lang}`, { waitUntil: "networkidle", timeout: 180_000 });
    const row = page.locator('[data-settings-row="usagePillShape"]');
    await row.waitFor();
    const group = page.locator('[data-settings-group="conversation"]');
    const target = (await group.count()) ? group : row;
    await target.scrollIntoViewIfNeeded();
    await target.screenshot({ path: join(outDir, `settings-${lang}-${scheme}.png`) });
    notes.push({
      file: `settings-${lang}-${scheme}.png`,
      rows: await Promise.all(["usagePillInBar", "usagePillShape", "contextIndicator"].map(async (id) => (await page.locator(`[data-settings-row="${id}"]`).innerText()).replace(/\s+/g, " ").trim())),
    });
    await page.close();
  }
  await writeFile(join(outDir, "notes.json"), `${JSON.stringify(notes, null, 2)}\n`);
  console.log(JSON.stringify(notes, null, 2));
} finally {
  await browser?.close().catch(() => {});
  vite.kill("SIGTERM");
}
