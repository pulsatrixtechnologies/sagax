#!/usr/bin/env node
/**
 * Headless screenshots of the coding chat (src/gallery/coding-chat.html),
 * running and finished, light and dark, wide (960), 700 and 390 px, with the
 * Changes list open and the follow-up composer open. Headless Chromium only:
 * no window opens.
 * Usage: node scripts/capture/coding-chat.mjs [--out DIR] [--port N]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "coding-chat"));
const port = Number(arg("--port") ?? 5191);
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
  // its own process group: pnpm starts vite as a grandchild, and stopping
  // the group stops them all
  detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

try {
  const base = `http://127.0.0.1:${port}/src/gallery`;
  await waitForServer(`${base}/coding-chat.html`);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  const page = await browser.newPage({ viewport: { width: 960, height: 900 }, deviceScaleFactor: 2 });
  page.setDefaultTimeout(20_000);
  // The gallery has no /api: the live store's own hydrate would resume into
  // no bots and blank the page, so its calls fail at once instead.
  await page.route("**/api/**", (route) => route.abort());
  page.on("pageerror", (error) => { console.error("pageerror", error.message); });
  const shot = async (name) => { await page.screenshot({ path: join(outDir, name) }); console.log(name); };
  const settle = async () => {
    await page.waitForSelector("[data-testid=coding-chat]");
    // the tool lines (#2099): diffs stay folded behind +N -M; wait for the rows
    await page.waitForSelector("[data-coding-row]");
    await page.waitForTimeout(300);
  };
  for (const { id, label } of skins) {
    for (const lang of ["en", "fr"]) {
      for (const status of ["running", "finished"]) {
        await page.setViewportSize({ width: 960, height: 900 });
        await page.goto(`${base}/coding-chat.html?skin=${id}&lang=${lang}&status=${status}`, { waitUntil: "load" });
        await settle();
        await shot(`coding-${status}-960-${label}-${lang}.png`);
        // the top of the transcript: the head, the first diff
        await page.evaluate(() => { const node = document.querySelector("[data-testid=coding-chat-scroll]"); if (node) node.scrollTop = 0; });
        await page.waitForTimeout(150);
        await shot(`coding-${status}-960-top-${label}-${lang}.png`);
      }
    }
    await page.goto(`${base}/coding-chat.html?skin=${id}&lang=en&status=finished`, { waitUntil: "load" });
    await settle();
    await page.click("[data-coding-changes-toggle]");
    await page.waitForSelector("[data-coding-changes-list]");
    await shot(`coding-finished-changes-${label}.png`);
    await page.click('[data-coding-changed-file="src/board/card.ts"]');
    await page.waitForTimeout(700);
    await shot(`coding-finished-jump-${label}.png`);
    // the bot panel's Coding section: agent rows (#2099)
    await page.goto(`${base}/bot-panel-coding.html?skin=${id}&lang=en`, { waitUntil: "load" });
    await page.waitForSelector("[data-agent-rows]");
    await page.waitForTimeout(300);
    await shot(`bot-panel-coding-${label}.png`);
    for (const width of [700, 390]) {
      await page.setViewportSize({ width, height: 860 });
      for (const status of ["running", "finished"]) {
        await page.goto(`${base}/coding-chat.html?skin=${id}&lang=fr&status=${status}`, { waitUntil: "load" });
        await settle();
        await shot(`coding-${status}-${width}-${label}.png`);
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
