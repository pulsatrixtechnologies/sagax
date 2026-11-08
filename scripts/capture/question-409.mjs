#!/usr/bin/env node
/**
 * Headless captures of a question card settled elsewhere (409) and of the
 * offline chat line (#2895 follow-up): src/gallery/question-cards.html,
 * dark and light, French. Headless Chromium only, its own Vite port.
 * Usage: node scripts/capture/question-409.mjs [--out DIR] [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "question-409"));
const port = Number(arg("--port") ?? 5191);

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
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

let browser;
let failed = false;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/question-cards.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const executablePath = process.env.SAGAX_VERIFY_BROWSER_CHROME;
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  for (const skin of ["pulsatrix", "pulsatrix-light"]) {
    const theme = skin === "pulsatrix" ? "dark" : "light";
    const context = await browser.newContext({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error?.stack ?? error).slice(0, 800)));
    await page.goto(`${base}?${new URLSearchParams({ skin, lang: "fr" })}`, { waitUntil: "load" });
    await page.waitForSelector("[data-variant='ask-409-gone']");
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page.waitForSelector("[data-chat-stale]");
    await page.waitForTimeout(800);
    for (const variant of ["ask-409-allow", "ask-409-gone", "chat-offline"]) {
      const file = join(outDir, `${variant}-${theme}-fr.png`);
      await page.locator(`[data-variant='${variant}']`).screenshot({ path: file });
      const text = (await page.locator(`[data-variant='${variant}']`).innerText()).replace(/\s+/g, " ").slice(0, 220);
      console.log(`${file}: ${text}`);
    }
    if (errors.length) { failed = true; console.log(`ERRORS: ${errors.join(" | ")}`); }
    await context.close();
  }
} catch (error) {
  failed = true;
  console.error(error);
  console.error(log.slice(-2000));
} finally {
  await browser?.close();
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* gone */ }
}
process.exit(failed ? 1 : 0);
