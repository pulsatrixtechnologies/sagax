#!/usr/bin/env node
/**
 * Headless screenshots of listening to a conversation (#4100) in a bot's
 * chat, every state, on the real ChatView (src/gallery/listening-chat.html):
 * how it starts (the composer menu), listening with lines arriving, a message
 * sent while listening, stopped with the transcript, the computer sound
 * refused, no speech to text provider, the microphone refused. French dark and
 * English light at 1280, and the phone layout at 390. Headless Chromium only.
 * Usage: node scripts/capture/listening-chat.mjs [--out DIR] [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "listening-chat"));
const port = Number(arg("--port") ?? 5199);
const looks = [{ skin: "pulsatrix", lang: "fr", label: "fr-dark" }, { skin: "daylight", lang: "en", label: "en-light" }];
const sizes = [{ id: "1280", width: 1280, height: 800 }, { id: "phone", width: 390, height: 844 }];
const states = ["start", "listening", "sent", "stopped", "computer", "nostt", "micdenied"];

async function waitForServer(url, ms = 120_000) {
  const begin = Date.now();
  while (Date.now() - begin < ms) {
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
  const base = `http://127.0.0.1:${port}/src/gallery/listening-chat.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : { channel: "chrome" }) });
  for (const size of sizes) {
    const page = await browser.newPage({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2 });
    page.setDefaultTimeout(60_000);
    page.on("pageerror", (error) => console.error("pageerror", error.message));
    for (const look of looks) {
      for (const state of states) {
        await page.goto(`${base}?skin=${look.skin}&lang=${look.lang}&state=${state}`, { waitUntil: "load" });
        await page.waitForSelector("body[data-gallery-ready]");
        await page.waitForTimeout(500);
        if (state === "start" || state === "nostt") {
          await page.locator("[data-composer-plus]").first().click();
          await page.waitForTimeout(300);
          if (state === "nostt") {
            await page.getByText(/Listen to a conversation|Écouter une conversation/).first().click();
            await page.waitForTimeout(900);
          }
        }
        if (state === "stopped") {
          await page.locator("[data-listening-open-transcript]").first().click();
          await page.waitForTimeout(400);
        }
        await page.screenshot({ path: join(outDir, `${state}-${size.id}-${look.label}.png`) });
      }
    }
    await page.close();
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
