#!/usr/bin/env node
/**
 * Headless screenshots for Sagax UX lot 7 (composer, model menu, sidebar,
 * my-Chrome recorder / teach steps). Gallery data only; no visible window.
 * Usage: node scripts/capture-lot7-ux.mjs [--out DIR] [--port N] [--prefix before|after]
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
    "/private/tmp/claude-501/-Users-jencryzthers/34ab7233-17d7-4f08-bd9d-b814b29fdefd/scratchpad/ux-shots/lot7",
);
const port = Number(arg("--port") ?? 5347);
const prefix = arg("--prefix") ?? "after";
const skins = [
  { id: "pulsatrix-light", label: "light" },
  { id: "pulsatrix", label: "dark" },
];
const sizes = [
  { width: 1280, height: 800, label: "desktop" },
  { width: 700, height: 860, label: "narrow" },
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
  const health = `http://127.0.0.1:${port}/src/gallery/composer-grok.html`;
  await waitForServer(health);
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

  const shots = [
    {
      name: "composer",
      path: "composer-grok.html",
      query: "state=menu&lang=en",
      wait: "[data-composer-plus], [data-tour='composer'], form, textarea",
    },
    {
      name: "model-menu",
      path: "model-menu.html",
      query: "lang=en&favorites=1",
      wait: "[data-model-search-list], [data-model-menu], [role='listbox']",
    },
    {
      name: "sidebar",
      path: "sidebar.html",
      query: "lang=en&threads=sidebar",
      wait: "[data-sidebar], aside, [data-tour='sidebar']",
    },
    {
      name: "my-chrome-setup",
      path: "my-chrome-recorder.html",
      query: "view=setup&lang=en",
      wait: "[data-my-chrome-record], [role='dialog'], [data-panel-slot]",
    },
    {
      name: "teach-steps",
      path: "my-chrome-recorder.html",
      query: "view=steps&lang=en",
      wait: "[data-teach-steps], [data-detail-panel], [data-panel-slot], [role='dialog']",
    },
  ];

  for (const size of sizes) {
    const page = await browser.newPage({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: 2,
    });
    page.on("pageerror", (error) => console.error("page error:", error.stack));
    for (const skin of skins) {
      for (const shot of shots) {
        if (size.label === "narrow" && skin.label === "light") continue;
        const url = `http://127.0.0.1:${port}/src/gallery/${shot.path}?${shot.query}&width=${size.width}&height=${size.height}&skin=${skin.id}`;
        await page.goto(url, { waitUntil: "load" });
        await page.waitForSelector(shot.wait, { timeout: 30_000 }).catch(() => {});
        await page.waitForTimeout(700);
        const target = page.locator("[data-gallery-frame], [data-panel-slot], [data-model-search-list], [data-sidebar], main, body").first();
        const file = join(outDir, `${prefix}-${shot.name}-${size.label}-${skin.label}.png`);
        if (await target.count()) await target.screenshot({ path: file });
        else await page.screenshot({ path: file });
        console.log(file);
      }
    }
    await page.close();
  }
} catch (error) {
  console.error(error);
  console.error(log.slice(-4_000));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  stop();
}
