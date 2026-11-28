#!/usr/bin/env node
/**
 * Captures of whole-app customize mode PR1 (D-20261127-004, #5443).
 * Headless Chrome only (channel: chrome). Ports 5300-5399.
 *
 *   node scripts/capture/ui-customize.mjs [--out DIR] [--port N]
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
const outDir = resolve(arg("--out", "/Users/Workspace/artifacts/sagax-ui-customize-2026-11-27/captures"));
const port = Number(arg("--port", "5371"));

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
  const gallery = `${origin}/src/gallery/ui-customize.html`;
  await waitForServer(gallery);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM } : { channel: "chrome" }),
  });

  const shots = [];
  for (const lang of ["fr", "en"]) {
    for (const [scheme, skin] of [["light", "daylight"], ["dark", "pulsatrix"]]) {
      shots.push({ lang, scheme, skin, zone: "composerBar", customize: true, hidden: "", name: "composer-customize" });
      shots.push({ lang, scheme, skin, zone: "composerBar", customize: true, hidden: "usage", name: "composer-hidden" });
      shots.push({ lang, scheme, skin, zone: "sidebar", customize: true, hidden: "", name: "sidebar-customize" });
      shots.push({ lang, scheme, skin, zone: "sidebar", customize: true, hidden: "search", name: "sidebar-hidden" });
      shots.push({ lang, scheme, skin, zone: "composerBar", customize: false, hidden: "", name: "composer-saved" });
    }
  }

  for (const shot of shots) {
    const page = await browser.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 2 });
    page.setDefaultTimeout(120_000);
    const query = new URLSearchParams({
      skin: shot.skin,
      lang: shot.lang,
      zone: shot.zone,
      ...(shot.customize ? { customize: "1", jiggleFrame: "1", chrome: "1" } : { chrome: "0" }),
      ...(shot.hidden ? { hidden: shot.hidden } : {}),
    });
    await page.goto(`${gallery}?${query}`, { waitUntil: "networkidle", timeout: 180_000 });
    await page.waitForSelector("[data-gallery-ui-customize]");
    if (shot.customize) {
      await page.waitForSelector("[data-ui-customize-toolbar], [data-ui-movable], [data-composer-movable]", { timeout: 60_000 });
    }
    await page.waitForTimeout(400);
    if (shot.customize && shot.hidden) {
      const hiddenPanel = await page.locator("[data-ui-customize-hidden]").count();
      if (hiddenPanel < 1) {
        throw new Error(`expected Hidden panel for ${shot.name} (${shot.lang}/${shot.scheme})`);
      }
    }
    const file = `${shot.name}-${shot.lang}-${shot.scheme}.png`;
    await page.locator("body").screenshot({ path: join(outDir, file) });
    notes.push({
      file,
      zone: shot.zone,
      customize: shot.customize,
      hidden: shot.hidden || null,
      lang: shot.lang,
      scheme: shot.scheme,
      toolbar: await page.locator("[data-ui-customize-toolbar]").count(),
      hiddenPanel: await page.locator("[data-ui-customize-hidden]").count(),
      movables: await page.locator("[data-ui-movable], [data-composer-movable]").count(),
    });
    await page.close();
  }
  await writeFile(join(outDir, "notes.json"), JSON.stringify(notes, null, 2));
  console.log(`wrote ${notes.length} captures to ${outDir}`);
} finally {
  await browser?.close().catch(() => undefined);
  try {
    process.kill(vite.pid, "SIGTERM");
  } catch { /* already gone */ }
}
