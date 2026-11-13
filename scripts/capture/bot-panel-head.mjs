#!/usr/bin/env node
/**
 * Headless screenshots of the bot panel's head and its routine rows (#4151,
 * src/gallery/bot-panel-head.html): a short and a long name and title, the
 * Upcoming rows whose last run went fine, failed or ended with problems,
 * then the same rows with each clock's tooltip drawn beside it (a browser
 * draws a title tooltip outside the page, so the capture draws its words).
 * Light and dark, French and English, 1280 and 390 px. It also prints the
 * head's measures (gaps from the top bar to the painted mascot, the mascot to
 * the name, the name to the tabs). Headless Chrome only: no window opens.
 * Usage: node scripts/capture/bot-panel-head.mjs [--out DIR] [--port N] [--prefix before|after]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "bot-panel-head"));
const port = Number(arg("--port") ?? 5347);
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
  // its own process group: pnpm starts vite as a grandchild, and stopping
  // the group stops them all
  detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/bot-panel-head.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : { channel: "chrome" }) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  page.setDefaultTimeout(30_000);
  // a first run optimizes the dependencies before the page loads
  page.setDefaultNavigationTimeout(120_000);
  page.on("pageerror", (error) => { console.error("pageerror", error.message); });
  for (const { id, label } of skins) {
    for (const lang of ["fr", "en"]) {
      for (const width of widths) {
        for (const long of [false, true]) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(`${base}?skin=${id}&lang=${lang}&width=${width}${long ? "&long=1" : ""}`, { waitUntil: "load" });
          await page.waitForSelector("[data-panel-bot] [data-routine-row]");
          await page.evaluate(() => document.fonts.ready);
          await page.waitForTimeout(400);
          const panel = page.locator("[data-panel-bot]");
          const name = `${prefix}-${label}-${lang}-${width}-${long ? "long" : "short"}.png`;
          await panel.screenshot({ path: join(outDir, name) });
          console.log(name);
          if (!long && label === "light" && lang === "en" && width === 1280) {
            const measures = await page.evaluate(() => {
              const top = document.querySelector("[data-panel-bot] .content-topbar")?.getBoundingClientRect();
              const shapes = [...document.querySelectorAll("[data-panel-bot] [data-avatar-edit] svg :is(path,circle,ellipse,rect,polygon)")]
                .map((node) => node.getBoundingClientRect()).filter((rect) => rect.width > 0 && rect.height > 0);
              const painted = shapes.length ? { top: Math.min(...shapes.map((r) => r.top)), bottom: Math.max(...shapes.map((r) => r.bottom)), left: Math.min(...shapes.map((r) => r.left)), right: Math.max(...shapes.map((r) => r.right)) } : null;
              const box = document.querySelector("[data-panel-bot] [data-avatar-edit]")?.getBoundingClientRect();
              const nameLine = document.querySelector("[data-panel-bot] [data-bot-name-title]")?.getBoundingClientRect();
              const tabs = document.querySelector("[data-panel-bot] [data-bot-panel-tabs] [role=tablist]")?.getBoundingClientRect();
              const row = document.querySelector("[data-panel-bot] [data-routine-row]")?.getBoundingClientRect();
              return {
                box: box && { width: box.width, height: box.height },
                painted: painted && { width: Math.round(painted.right - painted.left), height: Math.round(painted.bottom - painted.top) },
                topBarToBox: top && box && Math.round(box.top - top.bottom),
                boxToName: box && nameLine && Math.round(nameLine.top - box.top - box.width),
                topBarToMascot: top && painted && Math.round(painted.top - top.bottom),
                mascotToName: painted && nameLine && Math.round(nameLine.top - painted.bottom),
                nameHeight: nameLine && Math.round(nameLine.height),
                nameToTabs: nameLine && tabs && Math.round(tabs.top - nameLine.bottom),
                rowHeight: row && Math.round(row.height),
              };
            });
            console.log("measures", JSON.stringify(measures));
          }
          if (!long) {
            // the clock's tooltip, drawn where the browser would show it
            const shown = await page.evaluate(() => {
              let count = 0;
              for (const clock of document.querySelectorAll("[data-panel-bot] [data-routine-clock][title]")) {
                const rect = clock.getBoundingClientRect();
                const tip = document.createElement("div");
                tip.setAttribute("data-capture-tooltip", "");
                tip.textContent = clock.getAttribute("title");
                Object.assign(tip.style, { position: "fixed", left: `${rect.left + 8}px`, top: `${rect.bottom + 2}px`, maxWidth: "300px", padding: "3px 6px", font: "12px/16px system-ui, sans-serif", color: "#111", background: "#f6f6f6", border: "1px solid #999", boxShadow: "0 1px 3px rgba(0,0,0,.3)", zIndex: "1000", whiteSpace: "normal" });
                document.body.append(tip);
                count += 1;
              }
              return count;
            });
            const card = page.locator("[data-panel-bot] [data-routine-upcoming-flat]");
            const tipName = `${prefix}-${label}-${lang}-${width}-rows-tooltips.png`;
            const box = await card.boundingBox();
            if (box) await page.screenshot({ path: join(outDir, tipName), clip: { x: Math.max(0, box.x - 4), y: Math.max(0, box.y - 4), width: Math.min(width - Math.max(0, box.x - 4), box.width + 8), height: box.height + 70 } });
            console.log(tipName, `tooltips ${shown}`);
          }
        }
      }
    }
  }
} catch (error) {
  console.error(error);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* already stopped */ }
}
