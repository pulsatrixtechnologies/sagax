#!/usr/bin/env node
/**
 * Headless screenshots of restored centred windows (gallery data only):
 * Edit bot, bulk edit, team bot, New bot wizard, Org import, Archived bots,
 * Bot catalogue. Light and dark. Headless Chromium only: no window opens.
 * Usage: node scripts/capture-restore-windows.mjs [--out DIR] [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const outDir = resolve(
  arg("--out") ??
    "/private/tmp/claude-501/-Users-jencryzthers/34ab7233-17d7-4f08-bd9d-b814b29fdefd/scratchpad/restore-windows-shots",
);
const port = Number(arg("--port") ?? 5361);
const skins = [
  { id: "pulsatrix-light", label: "light" },
  { id: "pulsatrix", label: "dark" },
];
const views = [
  { id: "edit", wait: '[data-persona-modal][role="dialog"], [data-persona-editor][role="dialog"]' },
  { id: "bulk", wait: '[data-bulk-edit][role="dialog"]' },
  { id: "teambot", wait: '[data-teambot-from-thread][role="dialog"], [data-teambot-from-thread]' },
  { id: "quick", wait: '[data-bot-wizard][role="dialog"], [data-bot-wizard-screen]' },
  { id: "orgimport", wait: '[data-org-import][role="dialog"]' },
  { id: "archived", wait: '[data-archived-bots-panel][role="dialog"]' },
  { id: "catalog", wait: '[data-bot-catalog-modal][role="dialog"]' },
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

const stop = () => {
  try {
    if (vite.pid) process.kill(-vite.pid, "SIGTERM");
  } catch {
    /* already gone */
  }
};
process.on("exit", stop);
process.on("SIGINT", () => {
  stop();
  process.exit(130);
});

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/bot-create-edit.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.SAGAX_VERIFY_BROWSER_CHROME
      ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME }
      : process.env.SAGAX_CHROMIUM
        ? { executablePath: process.env.SAGAX_CHROMIUM }
        : {}),
  });

  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  });
  page.on("pageerror", (error) => console.error("page error:", error.message));

  for (const skin of skins) {
    for (const view of views) {
      const url = `${base}?view=${view.id}&skin=${skin.id}&lang=en&width=1280&height=800`;
      await page.goto(url, { waitUntil: "load" });
      await page.waitForSelector("[data-gallery-sample]", { timeout: 30_000 });
      await page.waitForSelector(view.wait, { timeout: 30_000 });
      await page.waitForTimeout(700);
      await page.evaluate(() => {
        document.querySelector("vite-error-overlay")?.remove();
      });
      const path = join(outDir, `${view.id}-${skin.label}.png`);
      await page.screenshot({ path });
      console.log(`wrote ${path}`);
    }
  }
  await page.close();
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(error);
  console.error(log.slice(-4000));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  stop();
}
