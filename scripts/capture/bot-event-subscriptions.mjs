#!/usr/bin/env node
/**
 * #2700: captures Settings > Developer > Per bot > Event subscriptions
 * (src/gallery/bot-event-subscriptions.tsx) in light and dark, EN and FR, in
 * three states (list, add form, secret shown once), plus a side by side
 * composite: the bot's Webhooks section (the neighbouring reference) | Event
 * subscriptions.
 *
 * Usage: node scripts/capture/bot-event-subscriptions.mjs [--out DIR] [--port 5194]
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "bot-event-subscriptions")));
const port = Number(arg("--port", "5194"));
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
  const base = `http://127.0.0.1:${port}/src/gallery/bot-event-subscriptions.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  for (const skin of skins) {
    for (const lang of ["en", "fr"]) {
      const tag = `${skin.label}-${lang}`;
      const page = await browser.newPage({ viewport: { width: 900, height: 1000 }, deviceScaleFactor: 2, colorScheme: skin.label === "dark" ? "dark" : "light" });
      page.on("pageerror", (error) => console.error("page error:", error.message));
      await page.goto(`${base}?skin=${skin.id}&lang=${lang}`, { waitUntil: "networkidle" });
      const webhooks = page.locator("[data-bot-webhooks]").first();
      const subs = page.locator("[data-bot-event-subscriptions]").first();
      await page.waitForSelector("[data-bot-event-subscription]", { timeout: 60_000 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(outDir, `page-${tag}.png`), fullPage: true });
      await subs.screenshot({ path: join(outDir, `list-${tag}.png`) });
      const bg = await page.evaluate(() => getComputedStyle(document.body.querySelector("[data-gallery-bot-event-subscriptions]")).backgroundColor);
      const a = (await webhooks.screenshot()).toString("base64");
      const b = (await subs.screenshot()).toString("base64");
      // Add form, routine target chosen to show both pickers.
      await page.click("[data-bot-event-add]");
      await page.waitForSelector("[data-bot-event-form]");
      await page.waitForTimeout(200);
      await subs.screenshot({ path: join(outDir, `form-${tag}.png`) });
      // Secret shown once after a URL subscription.
      await page.fill("[data-bot-event-url]", "https://hooks.northwind.example/new");
      await page.click('[data-bot-event-form] button[type="submit"]');
      await page.waitForSelector("[data-bot-event-secret]");
      await page.waitForTimeout(200);
      await subs.screenshot({ path: join(outDir, `secret-${tag}.png`) });
      const composite = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 2 });
      await composite.setContent(`<body style="margin:0;background:${bg};font:13px system-ui;color:${skin.label === "dark" ? "#ddd" : "#333"}"><div style="display:flex;gap:24px;padding:24px;align-items:flex-start">
        <figure style="margin:0;flex:1"><figcaption style="margin-bottom:8px">Webhooks (reference)</figcaption><img style="width:100%" src="data:image/png;base64,${a}"></figure>
        <figure style="margin:0;flex:1"><figcaption style="margin-bottom:8px">Event subscriptions (#2700)</figcaption><img style="width:100%" src="data:image/png;base64,${b}"></figure></div></body>`);
      const box = await composite.locator("div").first().boundingBox();
      await composite.screenshot({ path: join(outDir, `side-by-side-${tag}.png`), clip: { x: 0, y: 0, width: 1500, height: Math.ceil(box?.height ?? 600) } });
      await composite.close();
      console.log("shot", tag);
      await page.close();
    }
  }
} finally {
  await browser?.close();
  vite.kill();
}
