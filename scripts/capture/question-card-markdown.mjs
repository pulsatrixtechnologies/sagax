#!/usr/bin/env node
/**
 * M-20261119-045: headless captures of a bot's long question on its card
 * (src/gallery/question-card-markdown.html), beside the same words in a chat
 * bubble: bold headings, bullets and record links must read on the card as
 * they do in the bubble. Each column is checked for raw Markdown (asterisks,
 * a record address) and its record chips are counted. Light (Daylight) and
 * dark (Midnight), folded and opened. Synthetic data only. Headless Chrome,
 * own Vite port (never 5173).
 * Usage: node scripts/capture/question-card-markdown.mjs [--out DIR] [--port N] [--tag before|after]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const tag = arg("--tag") ?? "after";
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "question-card-markdown"));
const port = Number(arg("--port") ?? 5347);
const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="4" fill="#3b82f6"/><path d="M4 8h8M8 4v8" stroke="#fff" stroke-width="2"/></svg>`;

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
  const base = `http://127.0.0.1:${port}/src/gallery/question-card-markdown.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  for (const skin of ["daylight", "midnight"]) {
    for (const state of ["folded", "open"]) {
      const page = await browser.newPage({ viewport: { width: 1376, height: 980 }, deviceScaleFactor: 2 });
      page.on("pageerror", (error) => { failed = true; console.log(`ERROR: ${String(error?.stack ?? error).slice(0, 600)}`); });
      await page.route("https://desk.example/**", (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: MARK }));
      await page.goto(`${base}?${new URLSearchParams({ skin, lang: "fr" })}`, { waitUntil: "load" });
      await page.waitForSelector("[data-pinned-waiting]");
      await page.waitForTimeout(500);
      if (state === "open") {
        // each opened text drops out of the list: open the first one left, until none is folded
        const folded = page.locator("[data-expandable-toggle][aria-expanded=false]");
        for (let left = 10; left > 0 && (await folded.count()) > 0; left--) await folded.first().click();
        await page.waitForTimeout(300);
      }
      const columns = await page.evaluate(() => [...document.querySelectorAll("[data-gallery-column]")].map((column) => {
        const text = column.textContent ?? "";
        return {
          column: column.getAttribute("data-gallery-column"),
          chips: column.querySelectorAll("[data-record-link]").length,
          bold: column.querySelectorAll("strong").length,
          bullets: column.querySelectorAll("li").length,
          rawAsterisks: text.includes("**"),
          rawRecordAddress: text.includes("sagax://"),
        };
      }));
      for (const entry of columns) console.log(`${tag} ${skin} ${state}: ${JSON.stringify(entry)}`);
      if (tag === "after" && columns.some((entry) => entry.rawAsterisks || entry.rawRecordAddress)) failed = true;
      await page.locator("[data-shot]").screenshot({ path: join(outDir, `${tag}-${skin}-${state}.png`) });
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
