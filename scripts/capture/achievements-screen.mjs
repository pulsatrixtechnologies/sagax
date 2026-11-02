#!/usr/bin/env node
/**
 * Headless screenshots of the Achievements page (src/gallery/achievements-screen.html)
 * light and dark, at desktop (1200x760, and 1200x1400 to see the grid's
 * density) and phone (390x844) widths: the page on All, on one category
 * (the toolbar's category filter), on its settings (the header's gear), and
 * Settings > Appearance and Connect apps > Discover for comparison. The page
 * is opened as from a pointer (a click lands first), then once more from the
 * keyboard to show the focus ring. The script answers /api itself. Headless
 * Chromium only: no window opens.
 * Usage: node scripts/capture/achievements-screen.mjs [--out DIR] [--port N] [--prefix after]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "achievements-screen"));
const port = Number(arg("--port") ?? 5293);
const prefix = arg("--prefix") ?? "after";
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
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" },
  // its own process group: stopping the group stops vite too
  detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/achievements-screen.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  const viewports = [
    { id: "desktop", width: 1200, height: 760 },
    { id: "desktop-tall", width: 1200, height: 1400 },
    { id: "phone", width: 390, height: 844 },
  ];
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 2 });
    page.on("pageerror", (error) => console.error("page error:", error.stack));
    await page.route("**/api/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not in this gallery" }) }));
    const shoot = async (query, name, ready, { keyboard = false, before } = {}) => {
      // opened as from the account menu: a click, or Tab then Enter
      await page.goto(`${base}?${query}`, { waitUntil: "load" });
      await page.waitForSelector("[data-gallery-open]");
      if (keyboard) {
        await page.keyboard.press("Tab");
        await page.keyboard.press("Enter");
      } else {
        await page.click("[data-gallery-open]");
      }
      await page.waitForSelector(ready);
      if (before) await before(page);
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(outDir, `${name}.png`) });
    };
    for (const { id, label } of skins) {
      const tag = `${viewport.id}-${label}`;
      await shoot(`skin=${id}&lang=en`, `${prefix}-achievements-${tag}`, "[data-achievement-grid]");
      if (viewport.id === "desktop-tall") continue;
      // one category picked from the toolbar (absent before the 2026-10-28 redesign)
      if (await page.locator("[data-achievement-category-filter]").count()) {
        await shoot(`skin=${id}&lang=en`, `${prefix}-achievements-category-${tag}`, "[data-achievement-grid]", {
          before: async (p) => {
            await p.click('[data-achievement-category-filter] [data-achievement-category="mastery"]');
          },
        });
      }
      await shoot(`skin=${id}&lang=en&category=settings`, `${prefix}-achievements-settings-${tag}`, "[data-achievements-settings-page]");
      if (viewport.id === "desktop") {
        await shoot(`skin=${id}&lang=en`, `${prefix}-achievements-keyboard-${tag}`, "[data-achievement-grid]", { keyboard: true });
        await shoot(`skin=${id}&lang=en&view=settings`, `${prefix}-settings-${tag}`, "[data-settings-pane]");
      }
      // Connect apps > Discover, the filters the toolbar follows
      await page.goto(`http://127.0.0.1:${port}/src/gallery/connect-apps.html?view=manage&skin=${id}&lang=en`, { waitUntil: "load" });
      await page.waitForSelector("[data-plugins-tab=\"discover\"]", { timeout: 30_000 });
      await page.click("[data-plugins-tab=\"discover\"]");
      await page.waitForSelector("[data-plugins-manage=\"discover\"]");
      await page.waitForTimeout(700);
      await page.screenshot({ path: join(outDir, `${prefix}-connect-apps-${tag}.png`) });
    }
    await page.close();
  }
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(error);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* gone */ }
}
