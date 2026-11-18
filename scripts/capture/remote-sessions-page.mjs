#!/usr/bin/env node
// Captures the Remote sessions page (Computers and Sessions tabs, the Logs
// modal) on the wide fixture: French dark and English light, 1440, 1024 and
// 390. Headless only: no window, no focus taken.
//
//   node scripts/capture/remote-sessions-page.mjs --out DIR [--tag after] [--port 5231]
//   (SAGAX_VERIFY_BROWSER_CHROME=<chrome binary> to use the installed Chrome)
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; };
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const out = resolve(arg("--out", resolve(root, "artifacts/captures/remote-sessions-page")));
const tag = arg("--tag", "after");
const port = Number(arg("--port", "5231"));
mkdirSync(out, { recursive: true });
const base = `http://127.0.0.1:${port}`;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const vite = spawn(process.execPath, [resolve(root, "node_modules/vite/bin/vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
vite.stdout.on("data", () => {});
vite.stderr.on("data", () => {});

const THEMES = [{ lang: "fr", skin: "pulsatrix", label: "fr-dark", scheme: "dark" }, { lang: "en", skin: "daylight", label: "en-light", scheme: "light" }];
const SIZES = [{ width: 1440, height: 1000 }, { width: 1024, height: 900 }, { width: 390, height: 1500 }];
const shots = [];
let browser;
try {
  for (let i = 0; i < 120; i++) { try { const r = await fetch(`${base}/src/gallery/remote-sessions-admin.html`); if (r.status < 500) break; } catch { /* not yet */ } await pause(400); }
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  const errors = [];
  for (const theme of THEMES) {
    for (const size of SIZES) {
      const page = await browser.newPage({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2, colorScheme: theme.scheme });
      page.on("pageerror", (e) => { errors.push(String(e)); console.error(String(e)); });
      await page.goto(`${base}/src/gallery/remote-sessions-admin.html?skin=${theme.skin}&lang=${theme.lang}&width=${size.width}&height=${size.height}&fixture=wide`, { waitUntil: "networkidle" });
      await page.waitForSelector("[data-remote-sessions-admin]", { timeout: 30_000 });
      await pause(900);
      const sample = page.locator('[data-gallery-sample="list"]');
      const shoot = async (name) => { const path = resolve(out, `${name}-${theme.label}-${size.width}-${tag}.png`); await sample.screenshot({ path }); shots.push(path); };
      const tabs = await page.locator("[data-remote-tab]").count();
      if (tabs === 0) { await shoot("page"); await page.close(); continue; }
      await shoot("computers");
      await page.locator('[data-remote-tab="sessions"]').click();
      await pause(500);
      await shoot("sessions");
      await page.locator("[data-remote-admin-logs-open]").first().click();
      await pause(500);
      await page.screenshot({ path: resolve(out, `logs-modal-${theme.label}-${size.width}-${tag}.png`) });
      shots.push(resolve(out, `logs-modal-${theme.label}-${size.width}-${tag}.png`));
      await page.close();
    }
  }
  if (errors.length) console.error(`${errors.length} page error(s)`);
  console.log(shots.join("\n"));
} finally {
  if (browser) await browser.close();
  vite.kill("SIGTERM");
}
