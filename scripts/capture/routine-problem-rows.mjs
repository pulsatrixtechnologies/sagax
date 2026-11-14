#!/usr/bin/env node
/**
 * Headless screenshots of a routine's problem row in the chat (#4161):
 * src/gallery/routine-runs-chat.html?case=problem-rows (a streak's summary
 * that failed and paused its routine, a streak's summary with problems, a
 * result that needs the person, beside the bot's bubbles and a result that
 * ran fine, the conforming neighbour) and case=row-kinds (#4275), English
 * and French, light and dark, wide and 390 px. A measures file reads, for
 * each problem row: its height, the width of its chip against the chat
 * column (as wide as its words, never the column), the glyph's state name
 * and colour, and whether a "Details" word or a state word alone on a line
 * is left. Headless Chrome only: no window opens.
 * Usage: node scripts/capture/routine-problem-rows.mjs [--out DIR] [--port N] [--tag before|after] [--cases a,b]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use another browser)
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "routine-problem-rows"));
const port = Number(arg("--port") ?? 5208);
const tag = arg("--tag") ?? "after";
const cases = (arg("--cases") ?? "problem-rows,row-kinds").split(",");
const skins = [{ id: "pulsatrix-light", label: "light" }, { id: "pulsatrix", label: "dark" }];
const langs = ["en", "fr"];
const widths = [{ px: 1100, label: "wide" }, { px: 390, label: "390" }];

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

/** Each routine row's measures, read in the page. */
function readRows() {
  return [...document.querySelectorAll("[data-routine-run-card]")].map((card) => {
    const form = card.querySelector("[data-routine-run-form]") ?? card;
    const chip = form.querySelector("button") ?? form;
    const glyph = form.querySelector('[role="img"][data-routine-run-status]');
    const words = (form.innerText ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
    const rect = form.getBoundingClientRect();
    return {
      form: form.getAttribute("data-routine-run-form"),
      state: form.getAttribute("data-routine-run-state"),
      height: Math.round(rect.height),
      column: Math.round(card.getBoundingClientRect().width),
      chip: Math.round(chip.getBoundingClientRect().width),
      glyph: glyph ? { name: glyph.getAttribute("aria-label"), color: getComputedStyle(glyph).color } : null,
      detailsWord: words.some((line) => /^(Details|Détails)\b/.test(line)),
      stateWordAlone: words.some((line) => /^(Failed|Échouée)\b/.test(line)),
    };
  });
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
  const base = `http://127.0.0.1:${port}/src/gallery/routine-runs-chat.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : { channel: "chrome" }) });
  const measures = {};
  for (const which of cases) {
    for (const lang of langs) {
      for (const { id, label } of skins) {
        for (const width of widths) {
          const page = await browser.newPage({ viewport: { width: width.px, height: 1000 }, deviceScaleFactor: 2 });
          await page.goto(`${base}?skin=${id}&lang=${lang}&case=${which}`, { waitUntil: "load" });
          // the gallery's first load can reload itself while vite optimizes its dependencies
          const drawn = await page.waitForSelector("[data-routine-run-card]", { timeout: 20_000 }).then(() => true, () => false);
          if (!drawn) {
            await page.reload({ waitUntil: "load" });
            await page.waitForSelector("[data-routine-run-card]", { timeout: 20_000 }).catch(() => {});
          }
          await page.waitForTimeout(500);
          await page.screenshot({ path: join(outDir, `${tag}-${which}-${lang}-${label}-${width.label}.png`), fullPage: true });
          measures[`${which}-${lang}-${label}-${width.label}`] = await page.evaluate(`(${readRows.toString()})()`);
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
