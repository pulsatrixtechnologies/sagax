#!/usr/bin/env node
/**
 * Headless screenshots of an orchestrator bot's work (#3462, #3575,
 * src/gallery/bot-panel-team-work.html): the Coding section of its panel,
 * its work rows above its own coding rows in one card, beside today's panel
 * of a bot without a team (folded, then one piece of work unfolded and Done
 * today open), and a step's coding chat beside
 * today's coding chat; light and dark, French and English, wide, 700 and
 * 390 px. Headless Chrome only: no window opens, nothing takes the focus.
 * Usage: node scripts/capture/team-work.mjs [--out DIR] [--port N]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "team-work"));
const port = Number(arg("--port") ?? 5341);
const skins = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];
const widths = [{ label: "wide", panel: 820, chat: 1280 }, { label: "700", panel: 700, chat: 700 }, { label: "390", panel: 390, chat: 390 }];

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
  // its own process group: pnpm starts vite as a grandchild, and stopping
  // the group stops them all
  detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

try {
  const base = `http://127.0.0.1:${port}/src/gallery/bot-panel-team-work.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : { channel: "chrome" }) });
  const page = await browser.newPage({ viewport: { width: 820, height: 1100 }, deviceScaleFactor: 2 });
  page.setDefaultTimeout(20_000);
  await page.route("**/api/**", (route) => route.abort());
  page.on("pageerror", (error) => { console.error("pageerror", error.message); });
  const shot = async (name, options = {}) => { await page.screenshot({ path: join(outDir, name), fullPage: true, ...options }); console.log(name); };
  for (const { id, label } of skins) {
    for (const lang of ["fr", "en"]) {
      for (const width of widths) {
        await page.setViewportSize({ width: width.panel, height: 1100 });
        await page.goto(`${base}?skin=${id}&lang=${lang}&view=panel`, { waitUntil: "load" });
        await page.waitForSelector("[data-team-work-item]");
        await page.waitForTimeout(300);
        await shot(`panel-${lang}-${label}-${width.label}.png`);
        if (width.label === "wide") {
          // one piece of work unfolded into its steps, and Done today open
          await page.locator('[data-gallery-panel="team"] [data-team-work-item] [data-coding-open]').first().click();
          await page.locator('[data-gallery-panel="team"] [data-team-done-today] [data-coding-open]').click();
          await page.waitForTimeout(250);
          await shot(`panel-open-${lang}-${label}-${width.label}.png`);
          // keyboard focus on a step
          await page.locator('[data-gallery-panel="team"] [data-team-step-open] [data-coding-open]').nth(2).focus();
          await page.waitForTimeout(150);
          await shot(`panel-focus-${lang}-${label}-${width.label}.png`, { fullPage: false });
        }
        for (const chatView of ["chat", "today-chat"]) {
          await page.setViewportSize({ width: width.chat, height: 900 });
          await page.goto(`${base}?skin=${id}&lang=${lang}&view=${chatView}`, { waitUntil: "load" });
          await page.waitForSelector("[data-testid=coding-chat]");
          await page.waitForSelector("[data-coding-row]", { state: "attached" });
          await page.waitForTimeout(300);
          await shot(`${chatView}-${lang}-${label}-${width.label}.png`, { fullPage: false });
        }
      }
    }
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
