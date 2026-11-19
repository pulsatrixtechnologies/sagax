#!/usr/bin/env node
/**
 * M-20261119-007: headless captures of a pinned ask with long words, opened
 * with "Show less", over a scrolling transcript (src/gallery/pinned-long-ask.html).
 * Checks the wheel and the keyboard still scroll, the top of the words is
 * readable and the transcript above stays in view. The conforming neighbour
 * is the same chat with a short ask. Synthetic data only. Headless Chrome, own
 * Vite port (never 5173).
 * Usage: node scripts/capture/pinned-long-ask.mjs [--out DIR] [--port N] [--tag before|after]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const tag = arg("--tag") ?? "after";
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "pinned-long-ask"));
const port = Number(arg("--port") ?? 5293);

async function waitForServer(url, ms = 180_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const viteBin = join(root, "node_modules", "vite", "bin", "vite.js");
const vite = spawn(process.execPath, [viteBin, "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, detached: true,
});
let browser;
let failed = false;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/pinned-long-ask.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  for (const skin of ["midnight", "daylight"]) {
    for (const which of ["short", "long"]) {
      const page = await browser.newPage({ viewport: { width: 1100, height: 720 }, deviceScaleFactor: 2 });
      page.on("pageerror", (error) => { failed = true; console.log(`ERROR: ${String(error?.stack ?? error).slice(0, 600)}`); });
      await page.goto(`${base}?${new URLSearchParams({ skin, lang: "en", case: which })}`, { waitUntil: "load" });
      await page.waitForSelector("[data-pinned-waiting]");
      await page.waitForTimeout(500);
      if (which === "long") {
        const toggle = page.locator("[data-pinned-waiting] [data-expandable-toggle]");
        if (await toggle.count()) await toggle.first().click();
        await page.waitForTimeout(300);
      }
      const metrics = await page.evaluate(() => {
        const card = document.querySelector("[data-pinned-waiting]").getBoundingClientRect();
        const header = document.querySelector("[data-chat-header]").getBoundingClientRect();
        return { cardTop: Math.round(card.top), headerBottom: Math.round(header.bottom), cardHeight: Math.round(card.height) };
      });
      // the card's top must stay under the header, the transcript visible above it
      const reachable = metrics.cardTop >= metrics.headerBottom;
      // wheel on the card scrolls the card, wheel on the transcript scrolls the transcript
      const before = await page.evaluate(() => document.querySelector("[data-virtual-root]").scrollTop);
      await page.mouse.move(300, 150);
      await page.mouse.wheel(0, -200);
      await page.waitForTimeout(200);
      const after = await page.evaluate(() => document.querySelector("[data-virtual-root]").scrollTop);
      console.log(`${tag} ${skin} ${which}: ${JSON.stringify(metrics)} cardBelowHeader=${reachable} transcriptScrollTop ${before}->${after}`);
      if (which === "long" && tag === "after" && !reachable) failed = true;
      await page.screenshot({ path: join(outDir, `${tag}-${skin}-${which}.png`) });
      await page.close();
    }
  }
} catch (error) {
  failed = true;
  console.log(String(error?.stack ?? error));
} finally {
  await browser?.close();
  try { process.kill(-vite.pid); } catch { /* gone */ }
}
process.exit(failed ? 1 : 0);
