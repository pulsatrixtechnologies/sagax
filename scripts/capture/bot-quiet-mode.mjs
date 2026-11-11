#!/usr/bin/env node
/**
 * Headless screenshots of #3480 (quiet mode): Settings, Notifications,
 * « Ce que je reçois » with the switch for all bots, the bot page's
 * « Ce que ce bot suit pour toi » with the bot's switch, and the quiet mark
 * of the bot page's header, off and on, each next to the same surface as it
 * is without quiet mode (the conforming neighbour). French and English,
 * light and dark; side by side pairs under <out>/pairs. Real Chrome,
 * headless only: no window opens.
 * Usage: node scripts/capture/bot-quiet-mode.mjs --out DIR [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "bot-quiet-mode"));
const port = Number(arg("--port") ?? 5341);
const skins = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];
const langs = ["fr", "en"];
const shots = [
  { name: "settings-neighbour", page: "proactive-receive", query: "view=settings", ready: '[data-settings-group="receiveDomains"]' },
  { name: "settings-off", page: "proactive-receive", query: "view=settings&quiet=off", ready: '[data-settings-group="receiveQuietMode"]' },
  { name: "settings-on", page: "proactive-receive", query: "view=settings&quiet=all", ready: '[data-settings-group="receiveQuietMode"]' },
  { name: "bot-neighbour", page: "proactive-receive", query: "view=bot", ready: '[data-settings-group="botFollows"]' },
  { name: "bot-off", page: "proactive-receive", query: "view=bot&quiet=off", ready: '[data-settings-row="botQuietMode"]' },
  { name: "bot-on", page: "proactive-receive", query: "view=bot&quiet=on", ready: '[data-settings-row="botQuietMode"]' },
  { name: "bot-on-by-all", page: "proactive-receive", query: "view=bot&quiet=all", ready: '[data-quiet-mode-by-all]' },
  { name: "header-neighbour", page: "bot-profile", query: "section=overview", ready: "[data-bot-profile-header]" },
  { name: "header-on", page: "bot-profile", query: "section=overview&quiet=on", ready: "[data-bot-profile-quiet]" },
];
const pairs = [["settings-neighbour", "settings-off"], ["settings-neighbour", "settings-on"], ["bot-neighbour", "bot-off"], ["bot-neighbour", "bot-on"], ["bot-neighbour", "bot-on-by-all"], ["header-neighbour", "header-on"]];

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
  // side by side: the neighbour on the left, the quiet mode surface on the right
  await mkdir(join(outDir, "pairs"), { recursive: true });
  const sheet = await browser.newPage({ viewport: { width: 2240, height: 900 }, deviceScaleFactor: 1 });
  for (const [left, right] of pairs) {
    for (const lang of langs) {
      for (const { label } of skins) {
        const file = (name) => `file://${join(outDir, `${name}-${lang}-${label}-1100.png`)}`;
        const html = join(outDir, "pairs", "sheet.html");
        await writeFile(html, `<body style="margin:0;display:flex;gap:16px;background:#888;align-items:flex-start"><img src="${file(left)}" style="width:1100px"><img src="${file(right)}" style="width:1100px"></body>`);
        await sheet.goto(`file://${html}`, { waitUntil: "load" });
        await sheet.screenshot({ path: join(outDir, "pairs", `${right}-vs-${left}-${lang}-${label}.png`), fullPage: true });
      }
    }
  }
  await sheet.close();
  await rm(join(outDir, "pairs", "sheet.html"), { force: true });
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
