#!/usr/bin/env node
/**
 * Headless screenshots of src/gallery/desktop-pet-mascot.html: every built-in
 * mascot (and one custom mascot) as the bot list draws it beside the desktop
 * companion, light and dark. Fails when a pair does not draw the same outline.
 * Headless Chromium only, no visible window.
 * Usage: node scripts/capture/desktop-pet-mascot.mjs [--out DIR] [--port N] [--prefix NAME] [--chrome PATH]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "desktop-pet-mascot"));
const port = Number(arg("--port") ?? 5187);
const prefix = arg("--prefix") ?? "desktop-pet";
const SKINS = [{ name: "light", skin: "pulsatrix-light" }, { name: "dark", skin: "pulsatrix" }];

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
  const base = `http://127.0.0.1:${port}/src/gallery/desktop-pet-mascot.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const chrome = arg("--chrome") ?? process.env.SAGAX_VERIFY_BROWSER_CHROME;
  const browser = await chromium.launch({ headless: true, ...(chrome ? { executablePath: chrome } : {}) });
  const drift = [];
  for (const { name, skin } of SKINS) {
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto(`${base}?skin=${skin}`, { waitUntil: "load" });
    await page.waitForSelector("[data-pair] [data-side=desktop] svg", { timeout: 30_000 });
    await page.waitForTimeout(800);
    await page.locator("[data-shot]").screenshot({ path: join(outDir, `${prefix}-${name}.png`) });
    if (name === "light") {
      // the shape's outline: the first filled path of each side
      const pairs = await page.$$eval("[data-pair]", (figures) => figures.map((figure) => {
        const d = (side) => [...figure.querySelectorAll(`[data-side=${side}] svg path`)].map((path) => path.getAttribute("d")).find(Boolean) ?? "";
        return { label: figure.getAttribute("data-pair"), shape: figure.getAttribute("data-pair").startsWith("shape") || figure.getAttribute("data-pair") === "custom mascot", list: d("list"), desktop: d("desktop") };
      }));
      for (const pair of pairs) if (pair.shape && pair.list !== pair.desktop) drift.push(pair.label);
    }
    await context.close();
  }
  await browser.close();
  console.log(`screenshots in ${outDir}`);
  if (drift.length) { console.error(`companion differs from the list avatar: ${drift.join(", ")}`); process.exitCode = 1; }
} catch (error) {
  console.error(error);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  try { process.kill(-vite.pid, "SIGTERM"); } catch { vite.kill("SIGTERM"); }
}
