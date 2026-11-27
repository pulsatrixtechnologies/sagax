#!/usr/bin/env node
/**
 * Headless screenshots of the artifact side panel beside a mock chat:
 * src/gallery/artifact-side-panel.html, light and dark, fr and en.
 * Real Chrome headless, DPR 2: no window opens on this Mac.
 * Usage: node scripts/capture/artifact-side-panel.mjs [--out DIR] [--port N]
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
  arg("--out") ?? "/Users/Workspace/artifacts/sagax-artifacts-2026-11-27/captures",
);
const port = Number(arg("--port") ?? 5327);
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
  const base = `http://127.0.0.1:${port}/src/gallery/artifact-side-panel.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  for (const lang of langs) {
    for (const { id, label } of skins) {
      await page.goto(`${base}?skin=${id}&lang=${lang}`, { waitUntil: "load" });
      await page.waitForSelector("[data-artifact-side-panel]");
      await page.waitForSelector("[data-artifact-frame]", { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(900);
      const name = `artifact-side-${lang}-${label}.png`;
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
