#!/usr/bin/env node
/**
 * Headless screenshots of My devices (Playwright, no window): Remote sessions
 * with the person's devices above the enrolled hosts, the access menu open on
 * a computer, dark and light skins. The gallery's mocked fetch feeds four
 * devices (this Mac, a Mac asked every time, a PC never lent, a phone).
 * Usage: node scripts/capture/my-devices.mjs [--out DIR] [--port N] [--lang fr]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "my-devices")));
const port = Number(arg("--port", "5191"));
const lang = arg("--lang", "fr");

async function waitForServer(url, ms = 180_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { const res = await fetch(url); if (res.status < 500) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Vite gallery did not start at ${url}`);
}

const vite = spawn(
  process.execPath,
  [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" } },
);
let viteLog = "";
vite.stdout?.on("data", (c) => { viteLog += c; });
vite.stderr?.on("data", (c) => { viteLog += c; });

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/remote-sessions-admin.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 1120, height: 1100 }, deviceScaleFactor: 2 });
  for (const [skin, label] of [["pulsatrix", "dark"], ["daylight", "light"]]) {
    await page.goto(`${base}?skin=${skin}&lang=${lang}&height=1000`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-my-device]", { timeout: 60_000 });
    await page.waitForTimeout(400);
    const list = page.locator('[data-gallery-sample="list"]');
    await list.screenshot({ path: join(outDir, `remote-sessions-${label}.png`) });
    await page.locator("[data-my-devices]").locator("xpath=..").screenshot({ path: join(outDir, `enrolled-hosts-${label}.png`) });
    await page.locator('[data-my-device="computer"]').nth(1).locator("[data-pill-select]").click();
    await page.waitForSelector('[role="option"]');
    await page.waitForTimeout(200);
    await page.locator("[data-my-devices]").locator("xpath=..").screenshot({ path: join(outDir, `access-menu-${label}.png`) });
    await page.keyboard.press("Escape");
    console.log(`wrote ${label}`);
  }
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
  if (vite.exitCode === null) await Promise.race([new Promise((r) => vite.once("exit", r)), new Promise((r) => setTimeout(r, 5_000))]);
  if (vite.exitCode === null) vite.kill("SIGKILL");
  if (vite.exitCode && vite.exitCode !== 0 && !viteLog.includes(String(port))) console.error(viteLog);
}
