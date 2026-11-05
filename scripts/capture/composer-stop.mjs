#!/usr/bin/env node
/**
 * Headless screenshots of the composer with Stop while a turn runs (#2042),
 * compared to neighbouring rest and typed states. Gallery only; no window.
 * Usage: node scripts/capture/composer-stop.mjs [--out DIR] [--port N] [--prefix after]
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
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "composer-stop"));
const port = Number(arg("--port") ?? 5187);
const prefix = arg("--prefix") ?? "after";
if (port < 5176 || port > 5206) throw new Error("Use an allowed Vite port (5176 to 5206).");

const skins = [
  { id: "pulsatrix-light", label: "light" },
  { id: "pulsatrix", label: "dark" },
];
const states = [
  { name: "rest", query: "state=rest&lang=en" },
  { name: "busy", query: "state=busy&lang=en" },
  { name: "typed", query: "state=typed&lang=en" },
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

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/composer-grok.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.SAGAX_VERIFY_BROWSER_CHROME
      ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME }
      : {}),
  });
  // The gallery pads the composer to the bottom (pt-[260px]); keep the
  // viewport tall enough that the pill stays on screen.
  const page = await browser.newPage({ viewport: { width: 720, height: 420 }, deviceScaleFactor: 2 });
  page.on("pageerror", (error) => console.error("page error:", error.stack));
  for (const skin of skins) {
    for (const state of states) {
      await page.goto(`${base}?${state.query}&skin=${skin.id}`, { waitUntil: "load" });
      await page.waitForSelector("[data-gallery-composer], [data-composer-actions]", { timeout: 30_000 });
      if (state.name === "busy") {
        await page.waitForSelector("[data-composer-stop]", { timeout: 10_000 });
      }
      await page.waitForTimeout(400);
      const target = page.locator("[data-gallery-composer]").first();
      const file = join(outDir, `${prefix}-${state.name}-${skin.label}.png`);
      await target.scrollIntoViewIfNeeded();
      await target.screenshot({ path: file });
      console.log(file);
    }
  }
  await page.close();
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(error);
  console.error(log.slice(-4000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  try {
    process.kill(-vite.pid, "SIGTERM");
  } catch {
    /* gone */
  }
}
