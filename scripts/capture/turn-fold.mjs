#!/usr/bin/env node
/**
 * Headless screenshots of a turn that folds its notes (#3581) through the real
 * ChatView (gallery turn-fold, Playwright with Chrome, no window): English and
 * French, light and dark, at 1280, 700 and 390 px; a long settled turn closed
 * and opened, a running turn at three moments, a heavy chat; Tool calls off
 * and on; the neighbour beside them (a room's "Worked" row, pane=room). It also moves one live turn through its moments in
 * place and writes, for each, where the turn's row, the newest bubble and the
 * bottom of the list sit, so a jump when a note folds shows as numbers.
 * Usage: node scripts/capture/turn-fold.mjs [--out DIR] [--port N] [--mode before|after] [--quick]
 * Files: <mode>-<lang>-<theme>-<width>-<moment>-tools-<off|on>[-open].png,
 *        room-<lang>-<theme>-<width>.png, <mode>-measures.json
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "turn-fold")));
const port = Number(arg("--port", "5343"));
const mode = arg("--mode", "after");
const quick = process.argv.includes("--quick");

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Vite gallery did not start at ${url}`);
}

const THEMES = [["light", "daylight"], ["dark", "pulsatrix"]];
const WIDTHS = [1280, 700, 390];
const MOMENTS = ["settled", "run1", "run2", "run3", "heavy"];

/** Rows of the open chat, in page coordinates. */
async function measure(page) {
  return page.evaluate(() => {
    const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) }; };
    const run = [...document.querySelectorAll("[data-testid=activity-run]")].at(-1);
    const label = run?.querySelector("[data-step-label]");
    const style = label ? getComputedStyle(label) : null;
    const bubbles = [...document.querySelectorAll("[data-mid]")].filter((el) => el.querySelector("p, [data-markdown], .prose"));
    const scroller = document.querySelector("[data-chat-scroll], [data-transcript-scroll]") ?? [...document.querySelectorAll("*")].find((el) => el.scrollHeight > el.clientHeight + 4 && getComputedStyle(el).overflowY !== "visible");
    return {
      run: box(run),
      runLabel: label?.textContent ?? null,
      runLive: run?.getAttribute("data-live") ?? null,
      runFont: style ? { size: style.fontSize, weight: style.fontWeight, line: style.lineHeight, color: style.color } : null,
      runs: document.querySelectorAll("[data-testid=activity-run]").length,
      newestBubble: box(bubbles.at(-1)),
      scrollGap: scroller ? Math.round(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight) : null,
    };
  });
}

const vite = spawn(
  process.execPath,
  [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" } },
);
let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/turn-fold.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const measures = {};
  const langs = ["en", "fr"];
  for (const lang of langs) {
    for (const [theme, skin] of THEMES) {
      for (const width of WIDTHS) {
        const height = width === 390 ? 844 : 900;
        const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
        const go = async (query) => {
          await page.goto(`${base}?lang=${lang}&skin=${skin}&${query}`, { waitUntil: "networkidle" });
          await page.waitForTimeout(500);
        };
        const room = join(outDir, `room-${lang}-${theme}-${width}.png`);
        if (mode === "after") {
          await go("pane=room");
          await page.screenshot({ path: room, fullPage: false });
          measures[`room-${lang}-${theme}-${width}`] = await measure(page);
        }
        const moments = quick && width !== 1280 ? ["settled", "run2"] : MOMENTS;
        for (const moment of moments) {
          for (const tools of [false, true]) {
            const name = `${mode}-${lang}-${theme}-${width}-${moment}-tools-${tools ? "on" : "off"}`;
            await go(`moment=${moment}${tools ? "&tools=1" : ""}`);
            const file = join(outDir, `${name}.png`);
            await page.screenshot({ path: file, fullPage: false });
            measures[name] = await measure(page);
            if (moment === "settled" || moment === "heavy") {
              const row = page.locator("[data-testid=activity-run] button").last();
              if (await row.count()) {
                await row.click();
                await page.waitForTimeout(300);
                await page.screenshot({ path: join(outDir, `${name}-open.png`), fullPage: false });
              }
            }
            console.log(file);
          }
        }
        // one live turn moved on in place: run1, run2, run3, then its answer
        for (const tools of [false, true]) {
          await go(`moment=run1${tools ? "&tools=1" : ""}`);
          for (const step of ["run1", "run2", "run3", "settled"]) {
            await page.evaluate((next) => window.__moment?.(next), step);
            await page.waitForTimeout(600);
            const name = `${mode}-${lang}-${theme}-${width}-live-${step}-tools-${tools ? "on" : "off"}`;
            measures[name] = await measure(page);
            await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: false });
          }
        }
        await page.close();
      }
    }
  }
  await writeFile(join(outDir, `${mode}-measures.json`), JSON.stringify(measures, null, 1));
  console.log(`screenshots in ${outDir}`);
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
