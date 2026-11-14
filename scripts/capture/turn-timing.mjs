#!/usr/bin/env node
/**
 * Headless screenshots of a conversation's turn timing line (#4215) through
 * the real ChatView (gallery turn-timing, Playwright, no window): English and
 * French, a cold and a warm turn, each beside the same conversation with the
 * developer setting off (the conforming neighbour).
 * Usage: node scripts/capture/turn-timing.mjs [--out DIR] [--port N] [--mode before|after]
 * Files: <mode>-<lang>-<cold|warm>.png (side by side), and each half alone.
 */
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "turn-timing")));
const port = Number(arg("--port", "5342"));
const mode = arg("--mode", "after");

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Vite gallery did not start at ${url}`);
}

const vite = spawn(
  process.execPath,
  [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" } },
);
let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/turn-timing.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const shot = async (lang, turn, timing) => {
    const page = await browser.newPage({ viewport: { width: 820, height: 560 }, deviceScaleFactor: 2 });
    await page.goto(`${base}?lang=${lang}&turn=${turn}&timing=${timing}`);
    await page.waitForSelector("[data-gallery-turn-timing]", { timeout: 60_000 });
    if (timing === "1") await page.waitForSelector("[data-turn-timing]", { timeout: 20_000 });
    await page.waitForTimeout(400);
    const file = join(outDir, `${mode}-${lang}-${turn}-${timing === "1" ? "timing" : "neighbour"}.png`);
    await page.screenshot({ path: file });
    await page.close();
    return file;
  };
  for (const lang of ["en", "fr"]) {
    for (const turn of ["cold", "warm"]) {
      const shown = await shot(lang, turn, "1");
      const neighbour = await shot(lang, turn, "0");
      const page = await browser.newPage({ viewport: { width: 1660, height: 580 }, deviceScaleFactor: 1 });
      const img = async (file) => `data:image/png;base64,${(await readFile(file)).toString("base64")}`;
      await page.setContent(`<body style="margin:0;display:flex;gap:20px;background:#888"><img src="${await img(shown)}" width="820"><img src="${await img(neighbour)}" width="820"></body>`);
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(outDir, `${mode}-${lang}-${turn}.png`) });
      await page.close();
      console.log(join(outDir, `${mode}-${lang}-${turn}.png`));
    }
  }
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
