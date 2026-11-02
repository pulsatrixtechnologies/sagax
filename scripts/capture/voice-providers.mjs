#!/usr/bin/env node
/**
 * Headless screenshots of who speaks and who listens (2026-10-29):
 * src/gallery/voice-providers.html, light and dark, before (Edit bot >
 * Voice without the new group) and after (the bot's group and Settings >
 * Voice's). The script answers /api itself: xAI, OpenAI and ElevenLabs
 * keys are served, no provider is reached. Headless Chromium only.
 * Usage: node scripts/capture/voice-providers.mjs [--out DIR] [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "voice-providers"));
const port = Number(arg("--port") ?? 5293);
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

const status = { provider: "xai", available: true, organization: true, via: "speaker-key", key: { source: "voice-key", last4: "8Qq1", provider: "elevenlabs" }, keys: [], providers: { tts: ["xai", "openai", "elevenlabs"], stt: ["xai", "openai"] }, tts: "elevenlabs", stt: "xai" };
const voices = {
  xai: [{ id: "eve", label: "Eve" }, { id: "ara", label: "Ara" }],
  openai: [{ id: "marin", label: "Marin" }, { id: "cedar", label: "Cedar" }],
  elevenlabs: [{ id: "myClonedVoice01", label: "Ma voix", own: true }, { id: "premadeVoice001", label: "Rachel", description: "american" }],
};

try {
  const base = `http://127.0.0.1:${port}/src/gallery/voice-providers.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 2 });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const reply = (body, code = 200) => route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname.endsWith("/voice/status")) return reply(status);
    if (url.pathname.endsWith("/voice/voices")) return reply({ voices: voices[url.searchParams.get("provider") ?? "xai"] ?? [] });
    return reply({ error: "not in this gallery" }, 404);
  });
  for (const { id, label } of skins) {
    for (const when of ["before", "after"]) {
      await page.goto(`${base}?skin=${id}&lang=fr${when === "before" ? "&before=1" : ""}`, { waitUntil: "load" });
      await page.waitForSelector("[data-voice-settings]");
      if (when === "after") await page.waitForSelector("[data-voice-provider-voice='elevenlabs']");
      await page.waitForTimeout(400);
      const file = join(outDir, `edit-bot-voice-${when}-${label}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log(file);
    }
  }
  await browser.close();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* already gone */ }
}
