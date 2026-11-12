#!/usr/bin/env node
/**
 * Headless screenshots of the "no access" notice in the chat's history
 * (#3656, src/gallery/chat-access-notice.html): the message that got no
 * answer with its notice, the same once the person connected again, and two
 * such messages; French and English, light and dark, 1280 and 390 px wide.
 * Headless Chrome only: no window opens.
 * Usage: node scripts/capture/chat-access-notice.mjs --out DIR [--tag before|after] [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "chat-access-notice"));
const tag = arg("--tag") ?? "after";
const port = Number(arg("--port") ?? 5331);
const skins = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];
const widths = [{ width: 1280, height: 800 }, { width: 390, height: 844 }];
const views = ["open", "reconnected", "two"];

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
  const base = `http://127.0.0.1:${port}/src/gallery/chat-access-notice.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  for (const size of widths) {
    const page = await browser.newPage({ viewport: size, deviceScaleFactor: 2 });
    await page.addInitScript(() => { try { localStorage.setItem("sagax.interfaceMode.v1", "advanced"); } catch { /* none */ } });
    for (const lang of ["fr", "en"]) {
      for (const { id, label } of skins) {
        for (const view of views) {
          await page.goto(`${base}?skin=${id}&lang=${lang}&view=${view}`, { waitUntil: "load" });
          await page.waitForSelector("[data-access-card]");
          await page.waitForTimeout(1200);
          await page.screenshot({ path: join(outDir, `${view}-${lang}-${label}-${size.width}-${tag}.png`) });
        }
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
