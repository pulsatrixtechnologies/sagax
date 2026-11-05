#!/usr/bin/env node
/**
 * Headless screenshots of the page-target choice card (#2048) next to the
 * neighbouring question cards in src/gallery/question-cards.html.
 * Light and dark. Vite on an allowed gallery port; stop when done.
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const _here = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
// When run from /tmp, fall back to cwd / env.
const root = process.env.SAGAX_ROOT ? resolve(process.env.SAGAX_ROOT) : resolve(process.cwd());
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "page-target-choice"));
const port = Number(arg("--port") ?? 5188);
const skins = [{ id: "pulsatrix-light", label: "light" }, { id: "midnight", label: "dark" }];

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 400));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const vite = spawn("pnpm", ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/question-cards.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const chrome = process.env.SAGAX_VERIFY_BROWSER_CHROME || process.env.SAGAX_CHROMIUM;
  browser = await chromium.launch(chrome
    ? { headless: true, executablePath: chrome }
    : { headless: true, channel: "chrome" });
  for (const { id, label } of skins) {
    const page = await browser.newPage({ viewport: { width: 780, height: 1400 }, deviceScaleFactor: 2 });
    page.on("pageerror", (error) => console.error("page error:", error.stack));
    await page.route("**/api/**", async (route) => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "gallery" }) }));
    await page.goto(`${base}?skin=${id}&lang=en`, { waitUntil: "load" });
    await page.waitForSelector('[data-variant="page-target"]');
    await page.waitForTimeout(600);
    const target = page.locator('[data-variant="page-target"]');
    await target.screenshot({ path: join(outDir, `page-target-${label}.png`) });
    // Neighbouring ask-single for visual comparison
    const neighbour = page.locator('[data-variant="ask-single"]');
    await neighbour.screenshot({ path: join(outDir, `ask-single-${label}.png`) });
    // Full column with both for side-by-side review
    await page.screenshot({ path: join(outDir, `question-cards-${label}.png`), fullPage: true });
    await page.close();
    console.log(`wrote ${label}`);
  }
} catch (error) {
  console.error(error);
  console.error("vite log:\n", log.slice(-4000));
  process.exitCode = 1;
} finally {
  try { await browser?.close(); } catch { /* ignore */ }
  try { process.kill(-vite.pid, "SIGTERM"); } catch { try { vite.kill("SIGTERM"); } catch { /* ignore */ } }
}
