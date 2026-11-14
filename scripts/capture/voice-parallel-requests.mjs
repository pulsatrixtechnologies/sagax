#!/usr/bin/env node
/**
 * Headless captures of requests said on a call while the bot works (#4216):
 * src/gallery/voice-parallel-requests.html (the call card, then each request
 * that runs beside it as its own row, task card and result) next to the
 * conforming neighbour src/gallery/parallel-question.html, dark and light,
 * English and French. Headless Chrome only: no window opens. Its own Vite
 * port (never 5173).
 * Usage: node scripts/capture/voice-parallel-requests.mjs [--out DIR] [--port N] [--tag before|after]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "voice-parallel-requests"));
const port = Number(arg("--port") ?? 5352);
const tag = arg("--tag") ?? "after";

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
  const base = `http://127.0.0.1:${port}/src/gallery`;
  await waitForServer(`${base}/voice-parallel-requests.html`);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const executablePath = process.env.SAGAX_VERIFY_BROWSER_CHROME;
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : { channel: "chrome" }) });
  for (const skin of ["pulsatrix", "pulsatrix-light"]) {
    for (const lang of ["en", "fr"]) {
      const page = await browser.newPage({ viewport: { width: 2200, height: 800 }, deviceScaleFactor: 2 });
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error?.stack ?? error).slice(0, 800)));
      const query = new URLSearchParams({ skin, lang }).toString();
      // the two pages side by side in one frame
      await page.setContent(`<body style="margin:0;display:flex;gap:8px;background:#888">
        <iframe id="call" src="${base}/voice-parallel-requests.html?${query}&width=760&height=760" style="width:760px;height:760px;border:0"></iframe>
        <iframe id="neighbour" src="${base}/parallel-question.html?${query}&width=1400&height=760" style="width:1400px;height:760px;border:0"></iframe>
      </body>`, { waitUntil: "load" });
      const call = page.frameLocator("#call");
      await call.locator("[data-gallery-sample='voice-parallel-requests']").waitFor();
      await page.frameLocator("#neighbour").locator("[data-parallel-card]").first().waitFor();
      await page.waitForTimeout(1500);
      const file = join(outDir, `voice-parallel-requests-${tag}-${skin === "pulsatrix" ? "dark" : "light"}-${lang}.png`);
      await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 2168, height: 760 } });
      const ownRows = await call.locator("[data-row='u2'], [data-row='r2'], [data-row='u3']").count();
      const cards = await call.locator("[data-parallel-card]").count();
      console.log(`${file} (request and result rows outside the call card: ${ownRows}, task cards: ${cards})${errors.length ? ` ERRORS: ${errors.join(" | ")}` : ""}`);
      if (errors.length) failed = true;
      await page.close();
    }
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
