#!/usr/bin/env node
/**
 * Headless frames of one live turn through the real ChatView (#3696, gallery
 * live-note, Playwright with Chrome, no window): where the bot's text is
 * drawn while it works. Three scripts (a short note, two steps, then an
 * answer; a long answer alone; a one-line answer alone), English and French,
 * light and dark, at 1280 and 390 px. Each frame is moved on in place, and
 * for each one the script writes which texts are bubbles, what the working
 * line says and where the list sits, 60 ms after the change and once it
 * settled, so a bubble that goes away or a jump shows as data.
 * Usage: node scripts/capture/live-note.mjs [--out DIR] [--port N] [--mode before|after]
 *        node scripts/capture/live-note.mjs --compose --out DIR   (before|after side by side, one image per script)
 * Files: <mode>/<script>-<lang>-<theme>-<width>-<frame>.png, <mode>-measures.json,
 *        <script>-<lang>-<theme>-<width>.png when composed.
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "live-note")));
const port = Number(arg("--port", "5347"));
const mode = arg("--mode", "after");
const compose = process.argv.includes("--compose");

const THEMES = [["light", "daylight"], ["dark", "pulsatrix"]];
const WIDTHS = [1280, 390];
const SCRIPTS = ["steps", "long", "short"];
const LANGS = ["en", "fr"];

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

/** What the frame shows: the bubbles' texts, the working line, the list's place. */
async function measure(page) {
  return page.evaluate(() => {
    const scroller = [...document.querySelectorAll("*")].find((el) => el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(el).overflowY));
    const bubbles = [...document.querySelectorAll("[data-chat-bubble]")].map((el) => {
      const r = el.getBoundingClientRect();
      return { text: (el.textContent ?? "").trim().slice(0, 48), top: Math.round(r.top), bottom: Math.round(r.bottom) };
    });
    const line = document.querySelector("[data-presence-phrase]");
    const run = [...document.querySelectorAll("[data-testid=activity-run]")].at(-1);
    return {
      bubbles,
      line: line ? (line.textContent ?? "").trim() : null,
      run: run ? (run.querySelector("[data-step-label]")?.textContent ?? "") : null,
      scrollTop: scroller ? Math.round(scroller.scrollTop) : null,
      scrollGap: scroller ? Math.round(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight) : null,
    };
  });
}

async function capture() {
  const vite = spawn(
    process.execPath,
    [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" } },
  );
  let browser;
  try {
    const base = `http://127.0.0.1:${port}/src/gallery/live-note.html`;
    await waitForServer(base);
    const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
    const dir = join(outDir, mode);
    await mkdir(dir, { recursive: true });
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const measures = {};
    for (const lang of LANGS) {
      for (const [theme, skin] of THEMES) {
        for (const width of WIDTHS) {
          const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 820 }, deviceScaleFactor: 2 });
          for (const script of SCRIPTS) {
            await page.goto(`${base}?lang=${lang}&skin=${skin}&script=${script}`, { waitUntil: "networkidle" });
            await page.waitForTimeout(600);
            const frames = await page.evaluate(() => window.__frames ?? []);
            for (let index = 0; index < frames.length; index += 1) {
              await page.evaluate((next) => window.__frame?.(next), index);
              await page.waitForTimeout(60);
              const early = await measure(page);
              await page.waitForTimeout(700);
              const name = `${script}-${lang}-${theme}-${width}-${String(index).padStart(2, "0")}-${frames[index]}`;
              measures[name] = { early, settled: await measure(page) };
              await page.screenshot({ path: join(dir, `${name}.png`), fullPage: false });
              console.log(name);
            }
          }
          await page.close();
        }
      }
    }
    await writeFile(join(outDir, `${mode}-measures.json`), JSON.stringify(measures, null, 1));
  } finally {
    await browser?.close();
    vite.kill("SIGTERM");
  }
}

/** One image per script, language, theme and width: a row per frame, before
 * on the left and after on the right. */
async function composeAll() {
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const after = JSON.parse(await readFile(join(outDir, "after-measures.json"), "utf8"));
  try {
    for (const script of SCRIPTS) {
      for (const lang of LANGS) {
        for (const [theme] of THEMES) {
          for (const width of WIDTHS) {
            const prefix = `${script}-${lang}-${theme}-${width}-`;
            const names = Object.keys(after).filter((name) => name.startsWith(prefix)).sort();
            const cell = width === 390 ? 300 : 620;
            const rows = names.map((name) => `<tr><th>${name.slice(prefix.length)}</th>${["before", "after"].map((side) =>
              `<td><img src="${side}/${name}.png" style="width:${cell}px"></td>`).join("")}</tr>`).join("");
            const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#888;font:13px system-ui}table{border-spacing:8px}th{writing-mode:vertical-rl;transform:rotate(180deg);color:#fff;font-weight:600}td{vertical-align:top}thead th{writing-mode:horizontal-tb;transform:none;text-align:left}</style><table><thead><tr><th></th><th>before</th><th>after</th></tr></thead>${rows}</table>`;
            const file = join(outDir, `${prefix.slice(0, -1)}.html`);
            await writeFile(file, html);
            const page = await browser.newPage({ viewport: { width: cell * 2 + 80, height: 400 } });
            await page.goto(`file://${file}`);
            await page.waitForTimeout(300);
            await page.screenshot({ path: join(outDir, `${prefix.slice(0, -1)}.png`), fullPage: true });
            await page.close();
            console.log(`${prefix.slice(0, -1)}.png`);
          }
        }
      }
    }
  } finally {
    await browser.close();
  }
}

if (compose) await composeAll();
else await capture();
