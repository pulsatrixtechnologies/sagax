#!/usr/bin/env node
/**
 * Headless screenshots of the dev panel (src/gallery/dev-pods.html), light
 * and dark: the whole stack of pods beside the chat, a pod's "..." menu
 * opened on the last pod (it must not be cut by the rail), and the Context
 * pod at a high reading with its details open.
 * Headless Chromium only: no window opens.
 * Usage: node scripts/capture/dev-pods.mjs [--out DIR] [--port N]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "dev-pods"));
const port = Number(arg("--port") ?? 5293);
const skins = [{ id: "pulsatrix-light", label: "light" }, { id: "pulsatrix", label: "dark" }];

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const vite = spawn("pnpm", ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

try {
  const base = `http://127.0.0.1:${port}/src/gallery/dev-pods.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1180 }, deviceScaleFactor: 2 });
  const rail = async () => {
    await page.waitForSelector("[data-dev-pods][data-open='true']");
    await page.waitForTimeout(500);
    return page.locator("[data-dev-pods]").boundingBox();
  };
  const clipAround = (box, pad = 16) => ({ x: Math.max(0, box.x - pad), y: Math.max(0, box.y - 60), width: box.width + pad * 2, height: Math.min(1180 - Math.max(0, box.y - 60), box.height + 120) });
  for (const { id, label } of skins) {
    await page.goto(`${base}?skin=${id}&lang=fr`, { waitUntil: "load" });
    const box = await rail();
    await page.screenshot({ path: join(outDir, `rail-${label}.png`), clip: clipAround(box) });
    await page.screenshot({ path: join(outDir, `page-${label}.png`) });
    // the last pod's options: near the bottom of the scrolling rail
    const menuButton = page.locator("[data-dev-pod]").last().locator("> div").first().locator("button[aria-haspopup='menu']");
    await menuButton.click({ force: true });
    await page.waitForSelector("[role='menu']");
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(outDir, `menu-${label}.png`), clip: clipAround(box) });
    await page.keyboard.press("Escape");

    await page.goto(`${base}?skin=${id}&lang=fr&context=high`, { waitUntil: "load" });
    await rail();
    const details = page.locator("[data-dev-pod='context'] details");
    if (await details.count()) await details.locator("summary").click();
    await page.waitForTimeout(300);
    const context = await page.locator("[data-dev-pod='context']").boundingBox();
    await page.screenshot({ path: join(outDir, `context-high-${label}.png`), clip: { x: context.x - 12, y: context.y - 12, width: context.width + 24, height: context.height + 24 } });
  }
  await browser.close();
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(error);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  try { process.kill(-vite.pid, "SIGTERM"); } catch { vite.kill("SIGTERM"); }
}
