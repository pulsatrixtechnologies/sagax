#!/usr/bin/env node
/**
 * Unified chat (2026-11-05): thread mode with a busy bot's record, before and
 * after background threads left the list (shared/background-threads.ts).
 * Headless captures of src/gallery/sidebar.html?flood=1: the sidebar location
 * (Atlas's thread tree) and the chat header's All threads picker, light and
 * dark, then, after the fix, the same picker and tree with Show background on.
 * Counts the listed rows into rows.json. Headless Chromium only: no window
 * opens.
 * Usage: node scripts/capture/background-threads.mjs [--out DIR] [--port N] [--label before|after]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "background-threads"));
const port = Number(arg("--port") ?? 5294);
const label = arg("--label") ?? "after";
const skins = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];

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

const rows = [];
let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/sidebar.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  for (const { id, label: tone } of skins) {
    // sidebar location: Atlas's thread tree, "show all" open so every listed row counts
    {
      const context = await browser.newContext({ viewport: { width: 1000, height: 1015 }, deviceScaleFactor: 2 });
      const page = await context.newPage();
      await page.goto(`${base}?skin=${id}&lang=fr&threads=sidebar&density=comfortable&flood=1`, { waitUntil: "load" });
      await page.waitForSelector("[data-sidebar-bot-row]");
      await page.waitForTimeout(600);
      const all = page.locator("button", { hasText: /^Afficher les \d+ fils$/ }).first();
      if (await all.count()) await all.click();
      await page.waitForTimeout(300);
      await page.locator("[data-gallery]").screenshot({ path: join(outDir, `${label}-sidebar-${tone}.png`) });
      const listed = await page.locator("[data-sidebar-thread-row]").count();
      rows.push({ capture: `${label}-sidebar-${tone}`, listedRows: listed });
      if (label === "after") {
        // the list's "..." menu, Show background
        // the list's menu opens on a right click in the list (ThreadTree)
        const menu = page.locator("[data-sidebar-thread-list-actions]");
        await page.evaluate(() => {
          const list = [...document.querySelectorAll("[role=group]")].find((element) => /Atlas/.test(element.getAttribute("aria-label") ?? ""));
          list?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 320 }));
        });
        await page.waitForTimeout(300);
        {
          const item = page.locator("[data-menu-item=show-background-threads]");
          if (await item.count()) {
            await item.click();
            await page.waitForTimeout(300);
            await page.locator("[data-gallery]").screenshot({ path: join(outDir, `${label}-sidebar-background-${tone}.png`) });
            rows.push({ capture: `${label}-sidebar-background-${tone}`, listedRows: await page.locator("[data-sidebar-thread-row]").count() });
          } else if (await menu.count()) await page.keyboard.press("Escape");
        }
      }
      await context.close();
    }
    // header location: the All threads picker open
    {
      const context = await browser.newContext({ viewport: { width: 1000, height: 1015 }, deviceScaleFactor: 2 });
      const page = await context.newPage();
      await page.goto(`${base}?skin=${id}&lang=fr&threads=header&density=comfortable&flood=1`, { waitUntil: "load" });
      await page.waitForSelector("[data-gallery-header] button[aria-expanded]");
      await page.waitForTimeout(500);
      await page.locator("[data-gallery-header] button[aria-expanded]").first().click();
      await page.waitForSelector("[data-task-picker-menu]");
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(outDir, `${label}-header-${tone}.png`) });
      const listed = await page.locator("[data-task-picker-menu] [data-sidebar-thread-row]").count();
      rows.push({ capture: `${label}-header-${tone}`, listedRows: listed });
      const toggle = page.locator("[data-picker-background]");
      if (await toggle.count()) {
        await toggle.click();
        await page.waitForTimeout(300);
        await page.screenshot({ path: join(outDir, `${label}-header-background-${tone}.png`) });
        rows.push({ capture: `${label}-header-background-${tone}`, listedRows: await page.locator("[data-task-picker-menu] [data-sidebar-thread-row]").count() });
      }
      await context.close();
    }
  }
  await writeFile(join(outDir, `${label}-rows.json`), JSON.stringify(rows, null, 2));
  console.log(`screenshots in ${outDir}`);
  console.log(JSON.stringify(rows));
} catch (error) {
  console.error(error);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  try { await browser?.close(); } catch { /* closed */ }
  try { process.kill(-vite.pid, "SIGTERM"); } catch { vite.kill("SIGTERM"); }
}
