#!/usr/bin/env node
/**
 * Headless screenshots for Sagax UX lot 5 (Connect apps, bot catalog tab,
 * data-center popover, archived bots). Gallery data only; no visible window.
 * Usage: node scripts/capture/lot5-ux.mjs [--out DIR] [--port N] [--prefix before|after]
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
  arg("--out") ??
    "/private/tmp/claude-501/-Users-jencryzthers/34ab7233-17d7-4f08-bd9d-b814b29fdefd/scratchpad/ux-shots/lot5",
);
const port = Number(arg("--port") ?? 5345);
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
  const base = `http://127.0.0.1:${port}/src/gallery/connect-apps.html`;
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

  const shots = [
    { name: "connect-apps", view: "manage", wait: "[data-plugins-main], [data-plugins-manage], [data-tour='apps-panel']" },
    { name: "bots-tab", view: "bots-in-apps", wait: "[data-catalog-list], [data-plugins-manage='bots']" },
    { name: "plugin-detail", view: "manage", wait: "[data-plugins-main], [data-plugins-manage]", after: async (page) => {
      const row = page.locator("[data-plugin-row]").first();
      if (await row.count()) {
        await row.locator("button").first().click().catch(() => {});
        await page.waitForSelector("[data-plugins-back], [data-plugins-subpage]", { timeout: 5_000 }).catch(() => {});
      }
    } },
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
        const url = `${base}?view=${shot.view}&width=${size.width}&height=${size.height}&skin=${skin.id}&lang=en`;
        await page.goto(url, { waitUntil: "load" });
        await page.waitForSelector(shot.wait, { timeout: 30_000 });
        if (shot.after) await shot.after(page);
        await page.waitForTimeout(700);
        const target = page.locator("[data-gallery-frame], [data-tour='apps-panel'], [role='dialog'], main").first();
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
