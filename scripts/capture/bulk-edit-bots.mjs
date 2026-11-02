#!/usr/bin/env node
/**
 * Headless screenshots of changing several bots at once
 * (src/gallery/sidebar.html?bulk=1): the sidebar's selection bar with three
 * bots checked, the bulk edit dialog with mixed values, its summary before
 * Apply and the result per bot. Headless Chromium only: no window opens.
 * Usage: node scripts/capture/bulk-edit-bots.mjs [--out DIR] [--port N] [--prefix NAME] [--lang fr]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "bulk-edit-bots"));
const port = Number(arg("--port") ?? 5323);
const prefix = arg("--prefix") ?? "bulk-edit-bots";
const lang = arg("--lang") ?? "fr";
const skins = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];

async function waitForServer(url, ms = 180_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const vite = spawn("pnpm", ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" },
  detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/sidebar.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  for (const { id, label } of skins) {
    const page = await browser.newPage({ viewport: { width: 1180, height: 1015 }, deviceScaleFactor: 2 });
    await page.goto(`${base}?skin=${id}&lang=${lang}&bulk=1&org=1`, { waitUntil: "load" });
    await page.waitForSelector("[data-sidebar-bot-row]");
    await page.waitForTimeout(1_000);
    // Cmd-click three bots: the selection bar opens
    for (const name of ["Atlas", "Iris", "Lina"]) {
      await page.locator("[data-sidebar-bot-row]", { hasText: name }).first().click({ modifiers: ["Meta"] });
    }
    await page.waitForSelector("[data-sidebar-select-bar]");
    await page.waitForTimeout(400);
    await page.locator("[data-gallery]").screenshot({ path: join(outDir, `${prefix}-${lang}-bar-${label}.png`) });
    const edit = page.locator("[data-sidebar-select-edit], [data-sidebar-select-model]").first();
    await edit.hover();
    await page.waitForTimeout(600);
    await page.locator("[data-gallery]").screenshot({ path: join(outDir, `${prefix}-${lang}-bar-hover-${label}.png`) });
    await edit.click();
    await page.waitForTimeout(1_200);
    await page.screenshot({ path: join(outDir, `${prefix}-${lang}-dialog-${label}.png`) });
    if (await page.locator("[data-bulk-edit]").count()) {
      // change the model and the voice, add a Perspicax profile, then review
      await page.locator("[data-bulk-section='worksOn'] [data-bulk-change]").click();
      await page.locator("[data-bulk-section='worksOn'] [data-works-on-choice='cloud']").click();
      await page.locator("[data-bulk-section='perspicax'] [data-bulk-change]").click();
      await page.locator("[data-bulk-section='perspicax'] [data-perspicax-profile='pf_bs'] input[type=checkbox]").check();
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(outDir, `${prefix}-${lang}-edited-${label}.png`) });
      await page.locator("[data-bulk-review]").click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(outDir, `${prefix}-${lang}-summary-${label}.png`) });
      await page.locator("[data-bulk-apply]").click();
      await page.waitForSelector("[data-bulk-results]");
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(outDir, `${prefix}-${lang}-results-${label}.png`) });
    }
    await page.close();
  }
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (log) console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* already gone */ }
}
