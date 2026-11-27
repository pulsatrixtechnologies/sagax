#!/usr/bin/env node
/**
 * Captures for the menu-bar usage cumul + per-place pill shapes
 * (M-20261126-104, M-20261126-108, D-20261127-014): drawn tray icons
 * (two bars, week + 5 h) and Settings > Appearance shape rows, light and
 * dark, fr and en. Headless Chrome only. The native icon was never seen on
 * a real Mac or Windows machine.
 *
 *   node scripts/capture/menubar-cumul.mjs [--out DIR] [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const here = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { drawUsageIcon } = await import(join(here, "electron/usage-tray.mjs"));

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = resolve(arg("--out", join(here, "docs", "screenshots", "menubar-cumul")));
const port = Number(arg("--port", "5371"));

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`gallery did not start at ${url}`);
}

async function writeIconPngs() {
  const samples = [
    { name: "44-20", values: { week: 44, session: 20, text: "44%" } },
    { name: "80-100", values: { week: 80, session: 100, text: "80%" } },
    { name: "empty", values: { week: null, session: null, text: "" } },
  ];
  for (const platform of ["darwin", "win32"]) {
    const label = platform === "darwin" ? "mac" : "windows";
    for (const sample of samples) {
      for (const scale of [1, 2, 8]) {
        const [drawn] = drawUsageIcon(sample.values, platform, [scale]);
        await writeFile(join(outDir, `icon-${label}-${sample.name}@${scale}x.png`), drawn.png);
      }
    }
  }
}

const vite = spawn(
  process.execPath,
  [join(here, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: here, stdio: "ignore", env: { ...process.env, NODE_ENV: "development" } },
);
let browser;
const notes = [];
try {
  const origin = `http://127.0.0.1:${port}`;
  const gallery = `${origin}/src/gallery/panel-visibility.html`;
  await waitForServer(gallery);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  await writeIconPngs();
  notes.push({ icons: "drawn by electron/usage-tray.mjs drawUsageIcon; two bars (week + 5 h); never seen on a real Mac or Windows" });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM } : { channel: "chrome" }) });
  for (const lang of ["fr", "en"]) {
    for (const [scheme, skin] of [["light", "daylight"], ["dark", "pulsatrix"]]) {
      const page = await browser.newPage({ viewport: { width: 1338, height: 1400 }, deviceScaleFactor: 2 });
      page.setDefaultTimeout(120_000);
      await page.route((url) => url.pathname.startsWith("/api/"), (route) => route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"not found"}' }));
      await page.goto(`${gallery}?skin=${skin}&lang=${lang}`, { waitUntil: "networkidle", timeout: 180_000 });
      const group = page.locator('[data-settings-group="conversation"]');
      await group.waitFor();
      await group.scrollIntoViewIfNeeded();
      const file = `settings-${lang}-${scheme}.png`;
      await group.screenshot({ path: join(outDir, file) });
      notes.push({
        file,
        rows: await Promise.all(
          ["usagePillInBar", "usagePillShape.messageBar", "usagePillShape.accountMenu", "usagePillShape.menuBar", "contextIndicator"].map(async (id) =>
            (await page.locator(`[data-settings-row="${id}"]`).innerText()).replace(/\s+/g, " ").trim(),
          ),
        ),
      });
      await page.close();
    }
  }
  // simulated menu-bar / notification-area previews (not the native chrome)
  for (const [scheme, skin] of [["light", "daylight"], ["dark", "pulsatrix"]]) {
    for (const [lang, platform] of [["fr", "mac"], ["en", "mac"], ["fr", "windows"], ["en", "windows"]]) {
      const page = await browser.newPage({ viewport: { width: 720, height: 120 }, deviceScaleFactor: 2 });
      const isMac = platform === "mac";
      const figure = lang === "fr" ? "44 %" : "44%";
      const tip = lang === "fr" ? "Sagax · semaine 37 %, 5 h 16 %" : "Sagax · week 37%, 5 h 16%";
      const html = `<!doctype html><html data-skin="${skin}"><head><style>
        body{margin:0;font:13px -apple-system,system-ui,sans-serif;background:${scheme === "dark" ? "#1c1c1e" : "#f5f5f7"};color:${scheme === "dark" ? "#f5f5f7" : "#1c1c1e"}}
        .bar{display:flex;align-items:center;justify-content:flex-end;gap:10px;height:28px;padding:0 12px;background:${scheme === "dark" ? "#2c2c2e" : "#e8e8ed"}}
        .tray{display:inline-flex;align-items:center;gap:4px}
        .tip{position:absolute;right:12px;top:36px;padding:6px 8px;border-radius:6px;background:${scheme === "dark" ? "#3a3a3c" : "#fff"};box-shadow:0 2px 8px rgba(0,0,0,.2);font-size:12px;white-space:pre-line}
      </style></head><body>
        <div class="bar"><span class="tray" data-preview-tray="${platform}">
          <img src="file://${join(outDir, `icon-${platform === "mac" ? "mac" : "windows"}-44-20@2x.png`)}" height="16" alt=""/>
          ${isMac ? `<span>${figure}</span>` : ""}
        </span><span>${isMac ? (lang === "fr" ? "jeu. 27 nov." : "Thu 27 Nov") : "14:35"}</span></div>
        ${isMac ? "" : `<div class="tip">${tip}</div>`}
      </body></html>`;
      await page.setContent(html);
      const file = `preview-${platform}-${lang}-${scheme}.png`;
      await page.screenshot({ path: join(outDir, file) });
      notes.push({ file, note: "simulated OS chrome; native icon never seen on a real machine" });
      await page.close();
    }
  }
  await writeFile(join(outDir, "notes.json"), `${JSON.stringify(notes, null, 2)}\n`);
  console.log(JSON.stringify(notes, null, 2));
} finally {
  await browser?.close().catch(() => {});
  try { process.kill(vite.pid, "SIGTERM"); } catch { /* already gone */ }
}
