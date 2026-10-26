#!/usr/bin/env node
/**
 * Headless screenshots of the admin Remote Sessions page gallery (Playwright,
 * no window): the active list, history and unattended column, plus the logs
 * view, in the dark and the light skin. No server and nothing opens; a mocked
 * fetch in the gallery feeds seeded rows.
 * Usage: node scripts/capture-remote-sessions.mjs [--out DIR] [--port N] [--lang fr]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "remote-sessions")));
const port = Number(arg("--port", "5291"));
const lang = arg("--lang", "fr");

const skins = [
  { id: "pulsatrix", label: "dark" },
  { id: "daylight", label: "light" },
];

async function waitForServer(url, ms = 120_000) {
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
  const page = await browser.newPage({ viewport: { width: 1120, height: 900 }, deviceScaleFactor: 2 });
  for (const { id, label } of skins) {
    await page.goto(`${base}?skin=${id}&lang=${lang}`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-gallery-sample]", { timeout: 30_000 });
    // the list sample fills once the mocked fetch resolves
    await page.waitForSelector("[data-remote-admin-row]", { timeout: 30_000 });
    await page.waitForTimeout(300);
    const names = await page.locator("[data-gallery-sample]").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-gallery-sample")));
    for (const name of names) {
      const path = join(outDir, `${name}-${label}.png`);
      await page.locator(`[data-gallery-sample="${name}"]`).screenshot({ path });
      console.log(`wrote ${path}`);
    }
  }
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
  if (vite.exitCode === null) await Promise.race([new Promise((r) => vite.once("exit", r)), new Promise((r) => setTimeout(r, 5_000))]);
  if (vite.exitCode === null) vite.kill("SIGKILL");
  if (vite.exitCode && vite.exitCode !== 0 && !viteLog.includes(String(port))) console.error(viteLog);
}
