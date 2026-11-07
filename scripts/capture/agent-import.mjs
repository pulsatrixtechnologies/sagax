#!/usr/bin/env node
/**
 * Headless screenshots of the Import an agent dialog
 * (src/gallery/agent-import.html): the Grok Bot and Claude Code tabs and
 * the Hermes tab beside them (#2611), light and dark.
 * Usage: node scripts/capture/agent-import.mjs --out DIR [--port N]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "agent-import"));
const port = Number(arg("--port") ?? 5299);
const skins = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];
const views = [
  { name: "grok", q: "source=grok" },
  { name: "claude", q: "source=claude" },
  { name: "hermes", q: "source=hermes" },
];

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
  const base = `http://127.0.0.1:${port}/src/gallery/agent-import.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  try {
    for (const { id, label } of skins) {
      for (const shot of views) {
        const page = await browser.newPage({ viewport: { width: 900, height: 720 }, deviceScaleFactor: 2 });
        await page.goto(`${base}?lang=fr&skin=${id}&${shot.q}`, { waitUntil: "load" });
        await page.waitForSelector("[data-agent-import-dialog] [data-agent-import]");
        await page.waitForTimeout(600);
        await page.screenshot({ path: join(outDir, `${shot.name}-${label}.png`) });
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(log);
  throw error;
} finally {
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* already gone */ }
}
