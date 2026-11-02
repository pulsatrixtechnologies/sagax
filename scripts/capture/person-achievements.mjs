#!/usr/bin/env node
/**
 * Headless screenshots of a person's right panel, Achievements tab
 * (src/gallery/person-achievements.html), at 400 px, light and dark: the
 * whole tab, a locked tile's popover, an unlocked tile's popover, and a card
 * without points. The script answers /api itself. Headless Chromium only:
 * no window opens.
 * Usage: node scripts/capture/person-achievements.mjs [--out DIR] [--port N]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "person-achievements"));
const port = Number(arg("--port") ?? 5291);
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

try {
  const base = `http://127.0.0.1:${port}/src/gallery/person-achievements.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  const page = await browser.newPage({ viewport: { width: 400, height: 2000 }, deviceScaleFactor: 2 });
  await page.route("**/api/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not in this gallery" }) }));
  for (const { id, label } of skins) {
    for (const lang of ["fr", "en"]) {
      if (lang === "en" && label === "light") continue;
      await page.goto(`${base}?skin=${id}&lang=${lang}`, { waitUntil: "load" });
      await page.click('[data-person-tab="achievements"]');
      await page.waitForSelector("[data-achievements-panel]");
      await page.waitForTimeout(300);
      const height = await page.evaluate(() => {
        const body = document.querySelector(".content-card-body");
        return Math.ceil((body?.scrollHeight ?? 1600) + 60);
      });
      await page.setViewportSize({ width: 400, height });
      await page.waitForTimeout(150);
      await page.screenshot({ path: join(outDir, `after-tab-${label}-${lang}.png`) });
      if (lang !== "fr") continue;
      // the top of the tab, as it opens in an 820 px tall window
      await page.setViewportSize({ width: 400, height: 820 });
      await page.waitForTimeout(150);
      await page.screenshot({ path: join(outDir, `after-top-${label}.png`) });
      await page.setViewportSize({ width: 400, height });
      // a locked tile's popover, then an unlocked one's
      const locked = page.locator(".achievement-panel-tile[data-locked]").nth(2);
      await locked.click();
      await page.waitForSelector("[data-achievement-detail]");
      await page.waitForTimeout(200);
      const box = await page.locator("[data-achievement-detail]").boundingBox();
      await page.screenshot({ path: join(outDir, `after-popover-locked-${label}.png`), clip: { x: 0, y: Math.max(0, (box?.y ?? 0) - 200), width: 400, height: 380 } });
      await page.keyboard.press("Escape");
      const open = page.locator(".achievement-panel-tile[data-unlocked]").nth(5);
      await open.click();
      await page.waitForSelector("[data-achievement-detail]");
      await page.waitForTimeout(200);
      const box2 = await page.locator("[data-achievement-detail]").boundingBox();
      await page.screenshot({ path: join(outDir, `after-popover-unlocked-${label}.png`), clip: { x: 0, y: Math.max(0, (box2?.y ?? 0) - 200), width: 400, height: 380 } });
      await page.keyboard.press("Escape");
    }
    // a person who turned "Show my points" off
    await page.setViewportSize({ width: 400, height: 820 });
    await page.goto(`${base}?skin=${id}&lang=fr&points=0`, { waitUntil: "load" });
    await page.click('[data-person-tab="achievements"]');
    await page.waitForSelector("[data-achievements-panel]");
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(outDir, `after-no-points-${label}.png`) });
    await page.setViewportSize({ width: 400, height: 2000 });
  }
  await browser.close();
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(error);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  try { process.kill(-vite.pid, "SIGTERM"); } catch { vite.kill("SIGTERM"); }
}
