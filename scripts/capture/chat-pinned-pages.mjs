#!/usr/bin/env node
/**
 * Headless screenshots of pinned chat pages in the top bar:
 * src/gallery/chat-pinned-pages.html, light and dark, fr and en.
 * Real Chrome headless, DPR 2: no window opens on this Mac.
 * Usage: node scripts/capture/chat-pinned-pages.mjs [--out DIR] [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const outDir = resolve(
  arg("--out") ?? "/Users/Workspace/artifacts/sagax-artifacts-2026-11-27/chat",
);
const port = Number(arg("--port") ?? 5331);
const skins = [
  { id: "daylight", label: "light" },
  { id: "pulsatrix", label: "dark" },
];
const langs = ["fr", "en"];

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {
      /* retry */
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const vite = spawn(
  "pnpm",
  ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "development" },
    detached: true,
  },
);
let log = "";
vite.stdout?.on("data", (chunk) => {
  log += chunk;
});
vite.stderr?.on("data", (chunk) => {
  log += chunk;
});

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/chat-pinned-pages.html`;
  await waitForServer(base);
  // First hit warms the Vite dependency optimizer so later loads stay under the goto timeout.
  await fetch(`${base}?skin=daylight&lang=en&pinned=1`).catch(() => {});
  await new Promise((done) => setTimeout(done, 8_000));
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  page.setDefaultTimeout(90_000);
  for (const lang of langs) {
    for (const { id, label } of skins) {
      await page.goto(`${base}?skin=${id}&lang=${lang}&pinned=1`, { waitUntil: "networkidle", timeout: 90_000 });
      await page.waitForSelector("[data-gallery-sample]", { timeout: 60_000 });
      await page.waitForSelector("[data-chat-pinned-pages], [data-page-pin-bar]", { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(900);
      const name = `pin-${lang}-${label}.png`;
      await page.locator("[data-gallery-sample]").screenshot({ path: join(outDir, name) });
      console.log(name);
    }
  }
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (log) console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  try {
    process.kill(-vite.pid, "SIGTERM");
  } catch {
    /* already gone */
  }
}
