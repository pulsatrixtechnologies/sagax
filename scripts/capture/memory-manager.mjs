#!/usr/bin/env node
/**
 * Headless screenshots of Tools > Memory page (2026-11-02, the Perspicax
 * console's shape): src/gallery/memory-manager.html, the views Notes, Map,
 * Tags, Quality and a note, light and dark, at 1440 x 900.
 * Headless Chromium only: no window opens.
 * Usage: node scripts/capture/memory-manager.mjs [--out DIR] [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "memory-manager"));
const port = Number(arg("--port") ?? 5341);
const skins = [{ id: "pulsatrix-light", label: "light" }, { id: "pulsatrix", label: "dark" }];
const shots = ["notes", "map", "tags", "quality", "note"].map((view) => ({ view, name: view }));
const prefix = arg("--prefix") ?? "memory";

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

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/memory-manager.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const chromePath = process.env.SAGAX_VERIFY_BROWSER_CHROME
    || (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined);
  browser = await chromium.launch({
    headless: true,
    ...(chromePath ? { executablePath: chromePath } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  for (const { id, label } of skins) {
    for (const shot of shots) {
      const query = new URLSearchParams({ skin: id, lang: arg("--lang") ?? "en", view: shot.view, width: "1440", height: "900" });
      await page.goto(`${base}?${query}`, { waitUntil: "load" });
      await page.waitForSelector("[data-memory-manager-page]");
      await page.waitForSelector('[data-gallery-ready="1"]', { timeout: 20_000 }).catch(() => {});
      await page.waitForTimeout(600);
      await page.screenshot({ path: join(outDir, `${prefix}-${shot.name}-${label}.png`), fullPage: false });
    }
  }
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (log) console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* already gone */ }
}
