#!/usr/bin/env node
/**
 * Headless screenshots of dropdowns inside clipping containers
 * (src/gallery/dropdown-clip.html), light and dark: the "Discuter" level
 * menu in an overflow-hidden card, in a scroll area, a "..." menu opening
 * upward, and a pill in the window's bottom-right corner (flip + shift).
 * Headless Chromium only: no window opens.
 * Usage: node scripts/capture-dropdown-clip.mjs [--out DIR] [--port N]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "dropdown-clip"));
const port = Number(arg("--port") ?? 5291);
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
  const base = `http://127.0.0.1:${port}/src/gallery/dropdown-clip.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  for (const [name, viewport] of [["wide", { width: 760, height: 620 }], ["narrow", { width: 360, height: 640 }]]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
    for (const { id, label } of skins) {
      await page.goto(`${base}?skin=${id}&lang=fr`, { waitUntil: "load" });
      await page.waitForSelector("[data-pill-select]");
      const open = async (selector, shot) => {
        await page.click(selector);
        await page.waitForSelector("[data-anchored-popover]");
        await page.waitForTimeout(250);
        await page.screenshot({ path: join(outDir, `${name}-${shot}-${label}.png`) });
        await page.keyboard.press("Escape");
        await page.waitForSelector("[data-anchored-popover]", { state: "detached" });
      };
      await open('[data-case="clipped-card"] [data-pill-select]', "card");
      await open('[data-case="scroll-area"] > div:last-child [data-pill-select]', "scroll-bottom");
      await open('[data-case="more-menu"] [aria-haspopup="menu"]', "more");
      await open('[data-case="corner"] [data-pill-select]', "corner");
    }
    await page.close();
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
