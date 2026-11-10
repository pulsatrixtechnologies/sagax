#!/usr/bin/env node
/**
 * Headless screenshots of a turn that messages several bots, through the
 * real ChatView (gallery messaged-line, Playwright, no window): English and
 * French, 2, 6 and 17 recipients, Tool calls off and on, plus the full list
 * opened and a failed send.
 * Usage: node scripts/capture/messaged-line.mjs [--out DIR] [--port N] [--mode before|after]
 * Files: <mode>-<lang>-<n>-tools-<off|on>.png
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "messaged-line")));
const port = Number(arg("--port", "5331"));
const mode = arg("--mode", "after");

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

const vite = spawn(
  process.execPath,
  [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" } },
);
let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/messaged-line.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 }, deviceScaleFactor: 2 });
  const shots = [];
  for (const lang of ["en", "fr"]) {
    for (const n of [2, 6, 17]) {
      for (const tools of [false, true]) shots.push({ lang, n, tools, name: `${mode}-${lang}-${n}-tools-${tools ? "on" : "off"}` });
    }
    shots.push({ lang, n: 17, tools: false, open: true, name: `${mode}-${lang}-17-open` });
    shots.push({ lang, n: 2, tools: false, fail: true, name: `${mode}-${lang}-2-failed` });
    shots.push({ lang, n: 2, tools: false, sheet: true, name: `${mode}-${lang}-2-sheet` });
  }
  for (const shot of shots) {
    await page.goto(`${base}?skin=pulsatrix&lang=${shot.lang}&n=${shot.n}${shot.tools ? "&tools=1" : ""}${shot.fail ? "&fail=1" : ""}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    if (shot.open) {
      const more = page.locator("[data-testid=messaged-line-more]");
      if (await more.count()) await more.first().click();
      await page.waitForTimeout(200);
    }
    if (shot.sheet) {
      const name = page.locator("[data-testid=messaged-line-recipient]");
      if (await name.count()) await name.first().click();
      await page.waitForTimeout(400);
    }
    const file = join(outDir, `${shot.name}.png`);
    await page.screenshot({ path: file });
    console.log(file);
  }
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
