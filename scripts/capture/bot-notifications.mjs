#!/usr/bin/env node
/**
 * Headless screenshots for #5445 [M-20261127-070]: More notifications and
 * the bot page Notifications card. Playwright channel chrome, no window.
 * Usage: node scripts/capture/bot-notifications.mjs [--out DIR] [--port N] [--tag after|before]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const root = resolve(arg("--root") ?? resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."));
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "bot-notifications"));
const port = Number(arg("--port") ?? 5317);
const tag = arg("--tag") ?? "after";
const langs = ["fr", "en"];
const skins = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];
const views = ["settings", "bot"];

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const viteBin = join(root, "node_modules", "vite", "bin", "vite.js");
const vite = spawn(process.execPath, [viteBin, "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" },
  detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

try {
  const base = `http://127.0.0.1:${port}/src/gallery/proactive-receive.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    channel: process.env.SAGAX_VERIFY_BROWSER_CHROME ? undefined : "chrome",
    ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 900, height: 1100 }, deviceScaleFactor: 2 });
  // warm Vite's dependency optimizer once so later loads do not detach the DOM
  await page.goto(`${base}?skin=daylight&lang=en&view=settings`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  for (const lang of langs) {
    for (const { id, label } of skins) {
      for (const view of views) {
        await page.goto(`${base}?skin=${id}&lang=${lang}&view=${view}`, { waitUntil: "networkidle" });
        await page.waitForSelector("[data-gallery-panel]", { timeout: 30_000 });
        await page.waitForTimeout(500);
        const name = `${tag}-${view}-${lang}-${label}.png`;
        await page.screenshot({ path: join(outDir, name), fullPage: false });
      }
    }
  }
  await browser.close();
  console.log(`screenshots in ${outDir} (tag=${tag})`);
} catch (error) {
  console.error(error);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  try { process.kill(-vite.pid, "SIGTERM"); } catch { try { vite.kill("SIGTERM"); } catch { /* gone */ } }
}
