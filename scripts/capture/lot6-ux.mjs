#!/usr/bin/env node
/**
 * Headless screenshots for Sagax UX lot 6 (team DetailPanel, remote sessions
 * admin with logs panel, Settings > provider keys). Gallery data only; no
 * visible window.
 * Usage: node scripts/capture/lot6-ux.mjs [--out DIR] [--port N] [--prefix before|after]
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
    "/private/tmp/claude-501/-Users-jencryzthers/34ab7233-17d7-4f08-bd9d-b814b29fdefd/scratchpad/ux-shots/lot6",
);
const port = Number(arg("--port") ?? 5346);
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

const viteBin = join(root, "node_modules", ".bin", "vite");
const vite = spawn(
  viteBin,
  ["--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
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

const shots = [
  { name: "team-panel", view: "team", wait: "[data-detail-panel], [data-team-memory-panel], [data-team-dialog]" },
  { name: "sessions-admin", view: "sessions", wait: "[data-remote-sessions-admin]", after: async (page) => {
    const open = page.locator("[data-remote-admin-logs-open]").first();
    if (await open.count()) {
      await open.click().catch(() => {});
      await page.waitForSelector("[data-remote-admin-logs], [data-detail-panel]", { timeout: 5_000 }).catch(() => {});
    }
  } },
  { name: "settings-keys", view: "keys", wait: "[data-settings-card], [data-provider-key-dialog], [data-provider-key-inline], [role=dialog]" },
];

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/lot6-ux.html`;
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

  for (const size of sizes) {
    const page = await browser.newPage({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: 2,
    });
    page.on("pageerror", (error) => console.error("page error:", error.message));
    for (const skin of skins) {
      for (const shot of shots) {
        if (size.label === "narrow" && skin.label === "light") continue;
        await page.goto(
          `${base}?view=${shot.view}&width=${size.width}&height=${size.height}&skin=${skin.id}&lang=en`,
          { waitUntil: "load" },
        );
        await page.waitForSelector(`[data-gallery-sample="${shot.view === "team" ? "team" : shot.view === "sessions" ? "sessions" : "keys"}"]`, {
          timeout: 30_000,
        });
        await page.waitForTimeout(1200);
        if (shot.after) await shot.after(page).catch(() => {});
        await page.waitForSelector(shot.wait, { timeout: 12_000 }).catch(() => {});
        await page.waitForTimeout(600);
        const path = join(outDir, `${prefix}-${shot.name}-${size.label}-${skin.label}.png`);
        await page.locator(`[data-gallery-sample]`).first().screenshot({ path }).catch(async () => {
          await page.screenshot({ path });
        });
        console.log(`wrote ${path}`);
      }
    }
    await page.close();
  }
} catch (error) {
  console.error(error);
  console.error(log.slice(-4000));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  stop();
}
