#!/usr/bin/env node
/**
 * Captures of usage pill placement and customize mode (D-20261127-001,
 * D-20261126-014). Headless Chrome only.
 *
 *   node scripts/capture/chatbar-placement.mjs [--out DIR] [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = resolve(arg("--out", join(here, "docs", "screenshots", "chatbar-placement")));
const port = Number(arg("--port", "5368"));

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const vite = spawn(
  process.execPath,
  [join(here, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: here, stdio: "ignore", env: { ...process.env, NODE_ENV: "development" } },
);
let browser;
const notes = [];
try {
  const origin = `http://127.0.0.1:${port}`;
  const gallery = `${origin}/src/gallery/chatbar-placement.html`;
  await waitForServer(gallery);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM } : { channel: "chrome" }) });
  const shots = [];
  for (const lang of ["fr", "en"]) {
    for (const [scheme, skin] of [["light", "daylight"], ["dark", "pulsatrix"]]) {
      for (const place of ["inBar", "above", "below"]) {
        shots.push({ lang, scheme, skin, place, customize: false });
      }
      shots.push({ lang, scheme, skin, place: "inBar", customize: true });
    }
  }
  for (const shot of shots) {
    const page = await browser.newPage({ viewport: { width: 900, height: 320 }, deviceScaleFactor: 2 });
    page.setDefaultTimeout(120_000);
    const query = `skin=${shot.skin}&lang=${shot.lang}&place=${shot.place}${shot.customize ? "&customize=1" : ""}`;
    await page.goto(`${gallery}?${query}`, { waitUntil: "networkidle", timeout: 180_000 });
    await page.waitForSelector('[data-gallery-sample="bar"]');
    await page.waitForTimeout(300);
    const file = shot.customize
      ? `customize-${shot.lang}-${shot.scheme}.png`
      : `place-${shot.place}-${shot.lang}-${shot.scheme}.png`;
    await page.locator('[data-gallery-sample="bar"]').screenshot({ path: join(outDir, file) });
    notes.push({
      file,
      place: shot.place,
      customize: shot.customize,
      lang: shot.lang,
      scheme: shot.scheme,
      placementAttr: await page.getAttribute("[data-gallery-placement]", "data-gallery-placement"),
      hasAbove: await page.locator("[data-composer-above-row]").count(),
      hasBelow: await page.locator("[data-composer-under-row]").count(),
      hasMeterInActions: await page.locator("[data-composer-actions] [data-composer-meter-half], [data-composer-actions] [data-usage-pill]").count(),
      customizeToolbar: await page.locator("[data-composer-customize-toolbar]").count(),
    });
    await page.close();
  }
  await writeFile(join(outDir, "notes.json"), JSON.stringify(notes, null, 2));
  console.log(`wrote ${notes.length} captures to ${outDir}`);
} finally {
  await browser?.close().catch(() => undefined);
  vite.kill("SIGTERM");
}
