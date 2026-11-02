#!/usr/bin/env node
/**
 * Headless screenshots of the skill list and person-UI skill editor gallery
 * (src/gallery/skill-editor.html). Synthetic fixture data only.
 * Usage: node scripts/capture-skill-editor.mjs --out DIR [--port N] [--lang en]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "skill-editor"));
const port = Number(arg("--port") ?? 5291);
const lang = arg("--lang") ?? "en";
const skins = [
  { id: "daylight", label: "light" },
  { id: "pulsatrix", label: "dark" },
];
const views = [
  { view: "list", width: 420, height: 640 },
  { view: "editor", width: 720, height: 780 },
  { view: "edit", width: 720, height: 780 },
  { view: "review", width: 960, height: 780 },
];

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

await mkdir(outDir, { recursive: true });

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
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

let browser;
try {
  const page = `http://127.0.0.1:${port}/src/gallery/skill-editor.html`;
  try {
    await waitForServer(page);
  } catch (error) {
    console.error(log.slice(-4_000));
    throw error;
  }
  const chromePath = process.env.SAGAX_VERIFY_BROWSER_CHROME;
  browser = await chromium.launch({
    headless: true,
    ...(chromePath
      ? { executablePath: chromePath }
      : { channel: "chrome" }),
  });
  for (const skin of skins) {
    for (const shot of views) {
      await waitForServer(page, 30_000);
      const tab = await browser.newPage({
        viewport: { width: shot.width, height: shot.height },
        deviceScaleFactor: 2,
      });
      try {
        await tab.goto(
          `${page}?skin=${skin.id}&lang=${lang}&view=${shot.view}&width=${shot.width}&height=${shot.height}`,
          { waitUntil: "domcontentloaded", timeout: 60_000 },
        );
        await tab.waitForSelector("[data-gallery-ready]", { timeout: 30_000 });
        if (shot.view === "review") {
          await tab.waitForSelector("[data-skill-review-diff]", { timeout: 8_000 });
        }
        if (shot.view === "editor" || shot.view === "edit") {
          await tab.waitForSelector("[data-skill-editor-page]", { timeout: 8_000 });
        }
        await tab.waitForTimeout(800);
        await tab.screenshot({
          path: join(outDir, `skill-editor-${shot.view}-${skin.label}.png`),
        });
      } finally {
        await tab.close();
      }
    }
  }
  console.log(`screenshots in ${outDir}`);
} finally {
  await browser?.close();
  if (vite.pid) {
    try {
      process.kill(-vite.pid, "SIGTERM");
    } catch {
      /* gone */
    }
  }
}
