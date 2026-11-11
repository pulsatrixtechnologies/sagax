#!/usr/bin/env node
/**
 * Headless screenshots of a routine's result in the chat (#3581): every
 * scene of src/gallery/routine-run-cards.html (states, reports, stack,
 * banner, room, window, window-gone), English and French, light and dark, at a wide
 * window, 700 px and 390 px. Each scene opens with the conforming neighbour,
 * the compact approval card (#3414); a measures file compares the result's
 * card and row with it (height, paddings, font size and weight, icon size,
 * colours). Headless Chrome only: no window opens.
 * Usage: node scripts/capture/routine-run-result.mjs [--out DIR] [--port N] [--tag before|after] [--scenes a,b]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use another browser)
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "routine-run-result"));
const port = Number(arg("--port") ?? 5207);
const tag = arg("--tag") ?? "after";
const scenes = (arg("--scenes") ?? "states,reports,stack,banner,room,window,window-gone").split(",");
const skins = [{ id: "pulsatrix-light", label: "light" }, { id: "pulsatrix", label: "dark" }];
const langs = ["en", "fr"];
const widths = [{ px: 1100, label: "wide" }, { px: 700, label: "700" }, { px: 390, label: "390" }];
/** What each scene waits for before its shot. */
const READY = {
  states: "[data-routine-run-card]",
  reports: "[data-routine-run-card]",
  stack: "[data-routine-run-card]",
  banner: "[data-gallery-banner] [data-routine-run-card]",
  room: "[data-routine-run-card]",
  window: '[data-testid="routine-run-window"] table',
  "window-gone": '[data-testid="routine-run-window"] table',
};

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

/** The measures of a box and its text, read in the page. */
function measure(selector) {
  const box = document.querySelector(selector);
  if (!box) return null;
  const style = getComputedStyle(box);
  const title = box.querySelector(".font-semibold, [data-routine-run-name]") ?? box;
  const titleStyle = getComputedStyle(title);
  const icon = box.querySelector("svg");
  const rect = box.getBoundingClientRect();
  return {
    height: Math.round(rect.height), width: Math.round(rect.width),
    padding: `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`,
    radius: style.borderTopLeftRadius, background: style.backgroundColor, ring: style.boxShadow,
    titleFont: `${titleStyle.fontSize} ${titleStyle.fontWeight}`, titleColor: titleStyle.color,
    icon: icon ? `${Math.round(icon.getBoundingClientRect().width)}px` : null,
  };
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
  const base = `http://127.0.0.1:${port}/src/gallery/routine-run-cards.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : { channel: "chrome" }) });
  const measures = {};
  for (const scene of scenes) {
    for (const lang of langs) {
      for (const { id, label } of skins) {
        for (const width of widths) {
          const page = await browser.newPage({ viewport: { width: width.px, height: 900 }, deviceScaleFactor: 2 });
          const height = scene.startsWith("window") ? 900 : "auto";
          await page.goto(`${base}?skin=${id}&lang=${lang}&scene=${scene}&width=${width.px}&height=${height}`, { waitUntil: "load" });
          await page.waitForSelector(READY[scene] ?? "[data-gallery-sample]", { timeout: 20_000 }).catch(() => {});
          await page.waitForTimeout(500);
          const name = `${tag}-${scene}-${lang}-${label}-${width.label}.png`;
          await page.screenshot({ path: join(outDir, name), fullPage: true });
          {
            measures[`${scene}-${lang}-${label}-${width.label}`] = await page.evaluate(({ m }) => {
              const read = new Function("selector", `return (${m})(selector)`);
              const forms = [...document.querySelectorAll("[data-routine-run-form]")].map((node) => node.getAttribute("data-routine-run-form"));
              const rows = [...document.querySelectorAll('[data-routine-run-form="row"]')].map((node) => Math.round(node.getBoundingClientRect().height));
              const cards = [...document.querySelectorAll('[data-routine-run-form="card"]')].map((node) => Math.round(node.getBoundingClientRect().height));
              const transcript = document.querySelector("[data-gallery-transcript]");
              return {
                neighbour: read("[data-gallery-neighbour] [data-ask-card], [data-gallery-neighbour] .rounded-3xl"),
                card: read('[data-ask-card="result"]'),
                row: read('[data-routine-run-form="row"] [data-ask-card="settled"]'),
                forms, rowHeights: rows, cardHeights: cards,
                transcriptHeight: transcript ? Math.round(transcript.scrollHeight) : null,
                monospace: [...document.querySelectorAll("[data-routine-run-card] *")].filter((node) => /mono|Menlo|Courier/i.test(getComputedStyle(node).fontFamily) && !node.closest("pre, code")).length,
                scrollX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
              };
            }, { m: measure.toString() });
          }
          await page.close();
        }
      }
    }
  }
  await writeFile(join(outDir, `${tag}-measures.json`), `${JSON.stringify(measures, null, 2)}\n`);
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(error);
  console.error(log.slice(-4000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* gone */ }
}
