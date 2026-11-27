#!/usr/bin/env node
/**
 * Headless captures of the page-cite gallery (#5464): light/dark x fr/en as
 * cite-*.png under the artifacts chat folder (or --out).
 * Usage: node scripts/capture/page-cite.mjs [--out DIR] [--port N]
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
const outDir = resolve(arg("--out", "/Users/Workspace/artifacts/sagax-artifacts-2026-11-27/chat"));
const port = Number(arg("--port", "5311"));
const shots = [
  { skin: "pulsatrix-light", lang: "en", file: "cite-en-light.png" },
  { skin: "pulsatrix", lang: "en", file: "cite-en-dark.png" },
  { skin: "pulsatrix-light", lang: "fr", file: "cite-fr-light.png" },
  { skin: "pulsatrix", lang: "fr", file: "cite-fr-dark.png" },
];

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
  const base = `http://127.0.0.1:${port}/src/gallery/page-cite.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 900, height: 760 }, deviceScaleFactor: 1 });
  for (const shot of shots) {
    await page.goto(`${base}?skin=${shot.skin}&lang=${shot.lang}`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-gallery=\"page-cite\"]");
    const file = join(outDir, shot.file);
    await page.locator("[data-gallery=\"page-cite\"]").screenshot({ path: file });
    console.log(file);
  }
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
