#!/usr/bin/env node
/**
 * #2698: captures the Proactivity group of the bot's Analytics tab
 * (src/gallery/bot-profile.tsx), in light and dark, with the Usage group
 * just above it in the same shot (the neighbouring reference), then a side by
 * side composite: Usage group | Proactivity group.
 *
 * Usage: node scripts/capture/proactive-metrics.mjs [--out DIR] [--port 5193]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "proactive-metrics")));
const port = Number(arg("--port", "5193"));
const skins = [{ id: "pulsatrix-light", label: "light" }, { id: "pulsatrix", label: "dark" }];

async function waitForServer(url, ms = 180_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const vite = spawn(
  process.execPath,
  [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" } },
);
vite.stdout.resume();
vite.stderr.resume();

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/bot-profile.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  for (const skin of skins) {
    for (const lang of ["en", "fr"]) {
      const page = await browser.newPage({ viewport: { width: 1480, height: 900 }, deviceScaleFactor: 2, colorScheme: skin.label === "dark" ? "dark" : "light" });
      page.on("pageerror", (error) => console.error("page error:", error.message));
      await page.goto(`${base}?skin=${skin.id}&lang=${lang}`, { waitUntil: "networkidle" });
      await page.waitForSelector("[data-bot-profile-tab]", { timeout: 60_000 });
      await page.click('[data-bot-profile-tab="stats"]');
      const usage = page.locator('[data-settings-group="botUsage"]').first();
      const proactive = page.locator('[data-settings-group="botProactiveMetrics"]').first();
      await proactive.waitFor({ timeout: 15_000 });
      await page.waitForTimeout(600);
      await usage.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const tag = `${skin.label}-${lang}`;
      await page.screenshot({ path: join(outDir, `page-${tag}.png`) });
      await usage.screenshot({ path: join(outDir, `usage-${tag}.png`) });
      await proactive.screenshot({ path: join(outDir, `proactive-${tag}.png`) });
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      const a = (await usage.screenshot()).toString("base64");
      const b = (await proactive.screenshot()).toString("base64");
      const composite = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
      await composite.setContent(`<body style="margin:0;background:${bg};font:13px system-ui;color:${skin.label === "dark" ? "#ddd" : "#333"}"><div style="display:flex;gap:24px;padding:24px;align-items:flex-start">
        <figure style="margin:0;flex:1"><figcaption style="margin-bottom:8px">Usage (reference)</figcaption><img style="width:100%" src="data:image/png;base64,${a}"></figure>
        <figure style="margin:0;flex:1"><figcaption style="margin-bottom:8px">Proactivity (#2698)</figcaption><img style="width:100%" src="data:image/png;base64,${b}"></figure></div></body>`);
      const box = await composite.locator("div").first().boundingBox();
      await composite.screenshot({ path: join(outDir, `side-by-side-${tag}.png`), clip: { x: 0, y: 0, width: 1400, height: Math.ceil((box?.height ?? 600)) } });
      await composite.close();
      console.log("shot", tag);
      await page.close();
    }
  }
} finally {
  await browser?.close();
  vite.kill();
}
