#!/usr/bin/env node
/**
 * Headless screenshots of the voice per bot: src/gallery/bot-voice-chat.html,
 * the voice bar's panel and the bot page's Voice chat card for two bots (one
 * with its own voice, one on the person's), light and dark. Real Chrome
 * headless, DPR 2, no window. Usage: node scripts/capture/bot-voice-chat.mjs [--out DIR] [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "bot-voice-chat"));
const port = Number(arg("--port") ?? 5391);
const skins = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];

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

const status = { provider: "xai", available: true, organization: false, via: "speaker-key", key: null, keys: [], providers: { tts: ["xai"], stt: ["xai"] }, tts: "xai", stt: "xai" };
const voices = [{ id: "eve", label: "Eve" }, { id: "ara", label: "Ara" }, { id: "rex", label: "Rex" }];
let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/bot-voice-chat.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : { channel: "chrome" }) });
  const page = await browser.newPage({ viewport: { width: 900, height: 620 }, deviceScaleFactor: 2 });
  page.on("pageerror", (error) => { console.error("pageerror", error.message); });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const reply = (body, code = 200) => route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname.endsWith("/voice/status")) return reply(status);
    if (url.pathname.endsWith("/voice/voices")) return reply({ voices });
    return reply({ error: "not in this gallery" }, 404);
  });
  for (const { id, label } of skins) {
    await page.goto(`${base}?skin=${id}&lang=en`, { waitUntil: "load" });
    await page.waitForSelector("[data-gallery-bot='marc'] [data-voice-settings]");
    await page.waitForTimeout(600);
    const names = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-gallery-bot]")].map((column) => [column.getAttribute("data-gallery-bot"), column.querySelector("[data-voice-settings]")?.textContent])));
    console.log(label, JSON.stringify(names));
    const file = join(outDir, `voice-per-bot-${label}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(file);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* already gone */ }
}
