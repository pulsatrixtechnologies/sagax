#!/usr/bin/env node
/**
 * Headless screenshots of the bot panel's Voice chat card (#4194,
 * src/gallery/bot-panel-head.html): the card with the rows above and below it
 * in the panel, light and dark, French and English, 1280 and 390 px. It also
 * prints, for each row, the label's drawn and full widths and the select's
 * width, so a label cut before its control shows as "cut". Headless Chrome
 * only: no window opens.
 * Usage: node scripts/capture/voice-chat-card.mjs [--out DIR] [--port N] [--prefix before|after]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "voice-chat-card"));
const port = Number(arg("--port") ?? 5348);
const prefix = arg("--prefix") ?? "after";
const skins = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];
const widths = [1280, 390];

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
  // its own process group: stopping the group stops pnpm and vite
  detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

let browser;
let cut = 0;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/bot-panel-head.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : { channel: "chrome" }) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(120_000);
  page.on("pageerror", (error) => { console.error("pageerror", error.message); });
  for (const { id, label } of skins) {
    for (const lang of ["fr", "en"]) {
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${base}?skin=${id}&lang=${lang}&width=${width}`, { waitUntil: "load" });
        const card = page.locator("[data-panel-bot] [data-bot-settings-section='voice-chat']");
        await card.waitFor();
        await page.evaluate(() => document.fonts.ready);
        await card.scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        const rows = await page.evaluate(() => [...document.querySelectorAll("[data-panel-bot] [data-bot-settings-section='voice-chat'] [role=group]")].map((row) => {
          const labelNode = row.firstElementChild;
          const select = row.querySelector("[data-pill-select]");
          const text = select?.querySelector("span");
          return {
            row: row.getAttribute("aria-label"),
            label: labelNode && { drawn: Math.round(labelNode.clientWidth), full: Math.round(labelNode.scrollWidth) },
            select: select && Math.round(select.getBoundingClientRect().width),
            selectText: text && { drawn: Math.round(text.clientWidth), full: Math.round(text.scrollWidth) },
            rowWidth: Math.round(row.getBoundingClientRect().width),
          };
        }));
        for (const row of rows) if (row.label && row.label.full > row.label.drawn) cut += 1;
        console.log(`${label} ${lang} ${width}`, JSON.stringify(rows.map((row) => ({ ...row, cut: !!row.label && row.label.full > row.label.drawn }))));
        // the card with its neighbours in the panel (the rows above and below)
        const box = await card.boundingBox();
        if (box) {
          const name = `${prefix}-${label}-${lang}-${width}.png`;
          const top = Math.max(0, box.y - 140);
          const panel = await page.locator("[data-panel-bot]").boundingBox();
          const x = panel ? panel.x : box.x;
          const w = panel ? panel.width : box.width;
          await page.screenshot({ path: join(outDir, name), clip: { x, y: top, width: w, height: Math.min(900 - top, box.height + 280) } });
          console.log(name);
        }
      }
    }
  }
  console.log(`labels cut: ${cut}`);
} catch (error) {
  console.error(error);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* already stopped */ }
}
