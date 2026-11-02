#!/usr/bin/env node
/**
 * Headless screenshots of Show a task in my Chrome
 * (src/gallery/my-chrome-recorder.html): the chooser, the dialog before the
 * recording, the recording in progress and the path it produced, light and
 * dark. The script answers /api itself. Headless Chromium only: no window
 * opens, and the person's own Chrome is never used.
 * Usage: node scripts/capture/my-chrome-recorder.mjs [--out DIR] [--port N]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "my-chrome-recorder"));
const port = Number(arg("--port") ?? 5291);
const skins = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];
const site = "https://portail.example.com";
const RECORDING = {
  recording: true, startedAt: "2026-10-29T14:00:00.000Z", steps: 5, ended: null,
  recent: [
    { id: "1", kind: "open", url: `${site}/factures` },
    { id: "2", kind: "click", target: { role: "link", name: "Nouvelle demande", tag: "a" } },
    { id: "3", kind: "type", target: { role: "textbox", name: "Nom", tag: "input" }, text: "Atelier Nord" },
    { id: "4", kind: "type", target: { role: "textbox", name: "Mot de passe", tag: "input" }, secret: true },
    { id: "5", kind: "click", target: { role: "button", name: "Envoyer la demande", tag: "button" } },
  ],
};

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
  const base = `http://127.0.0.1:${port}/src/gallery/my-chrome-recorder.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  const page = await browser.newPage({ viewport: { width: 760, height: 1240 }, deviceScaleFactor: 2 });
  page.on("pageerror", (error) => console.error(`page error: ${error.message}`));
  page.setDefaultTimeout(20_000);
  let view = "setup";
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path.endsWith("/record/status")
      ? { recording: view === "recording" ? RECORDING : null, unavailable: null }
      : { ok: true };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  for (const { id, label } of skins) {
    for (const name of ["chooser", "setup", "recording", "steps"]) {
      view = name;
      await page.goto(`${base}?view=${name}&skin=${id}&lang=fr`, { waitUntil: "load" });
      const selector = { chooser: "[data-teach-my-chrome]", setup: "[data-my-chrome-record-start]", recording: "[data-my-chrome-recent]", steps: "[data-teach-replay]" }[name];
      await page.waitForSelector(selector);
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(outDir, `${name}-${label}.png`) });
    }
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
