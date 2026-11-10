#!/usr/bin/env node
/**
 * Headless screenshots of #3432: Settings, Notifications, « Ce que je
 * reçois » and the bot page's « Ce que ce bot suit pour toi »
 * (src/gallery/proactive-receive.html), each next to its conforming
 * neighbour (src/gallery/settings-2e.html, src/gallery/bot-permissions-rows.html),
 * French and English, light and dark. Real Chrome, headless only: no window opens.
 * Usage: node scripts/capture/proactive-receive.mjs --out DIR [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "proactive-receive"));
const port = Number(arg("--port") ?? 5331);
const skins = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];
const langs = ["fr", "en"];
const shots = [
  { name: "settings-receive", page: "proactive-receive", query: "view=settings", ready: '[data-settings-group="receiveDomains"]' },
  { name: "settings-receive-empty", page: "proactive-receive", query: "view=empty", ready: '[data-settings-group="signals"]' },
  { name: "settings-neighbour", page: "settings-2e", query: "", ready: '[data-settings-group="signals"]' },
  { name: "bot-follows", page: "proactive-receive", query: "view=bot", ready: '[data-settings-group="botFollows"]' },
  { name: "bot-neighbour", page: "bot-permissions-rows", query: "direct=1&part=actsAlone", ready: '[data-settings-row="proactiveMode"]' },
];

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
let browser;
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

try {
  const base = `http://127.0.0.1:${port}/src/gallery`;
  await waitForServer(`${base}/proactive-receive.html`);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  for (const width of [1100, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
    await page.addInitScript(() => { try { localStorage.setItem("sagax.interfaceMode.v1", "advanced"); } catch { /* none */ } });
    for (const shot of shots) {
      for (const lang of langs) {
        for (const { id, label } of skins) {
          await page.goto(`${base}/${shot.page}.html?skin=${id}&lang=${lang}${shot.query ? `&${shot.query}` : ""}`, { waitUntil: "load" });
          await page.waitForSelector(shot.ready, { timeout: 30_000 });
          await page.waitForTimeout(400);
          // a late reload (dependency optimisation) can blank the page: wait for the group again
          await page.waitForLoadState("networkidle");
          await page.waitForSelector(shot.ready, { state: "visible", timeout: 30_000 });
          await page.screenshot({ path: join(outDir, `${shot.name}-${lang}-${label}-${width}.png`), fullPage: true });
        }
      }
    }
    await page.close();
  }
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(error);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  // a failed shot must not leave Chrome running
  await browser?.close().catch(() => {});
  try { process.kill(-vite.pid, "SIGTERM"); } catch { vite.kill("SIGTERM"); }
}
