#!/usr/bin/env node
/**
 * #5289: the threads bots opened on a bot (hand-offs, start_thread), with
 * Settings > Appearance > Sidebar "Show Bot threads" off (the default: they
 * stay behind Show background) and on (rows of the bot's normal thread list).
 * Headless captures of src/gallery/sidebar.html?flood=1: the sidebar tree and
 * the chat header's picker, light and dark. Counts the listed rows into
 * rows.json. Headless Chrome only: no window opens.
 * Usage: node scripts/capture/bot-opened-threads.mjs [--out DIR] [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "bot-opened-threads"));
const port = Number(arg("--port") ?? 5296);
const skins = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];
const choices = ["off", "on"];

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
console.error(`vite pid ${vite.pid}`);
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

const rows = [];
let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/sidebar.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, channel: process.env.SAGAX_CAPTURE_CHANNEL ?? "chrome" });
  for (const { id, label: tone } of skins) for (const choice of choices) {
    const open = async (threads) => {
      const context = await browser.newContext({ viewport: { width: 1000, height: 1015 }, deviceScaleFactor: 2 });
      // the person's own choice, as Settings writes it; absent is the default (off)
      if (choice === "on") await context.addInitScript(() => { try { localStorage.setItem("sagax.sidebarBotThreads.v1", "on"); } catch { /* default */ } });
      const page = await context.newPage();
      await page.goto(`${base}?skin=${id}&lang=fr&threads=${threads}&density=comfortable&flood=1`, { waitUntil: "load" });
      return { context, page };
    };
    {
      const { context, page } = await open("sidebar");
      await page.waitForSelector("[data-sidebar-bot-row]");
      await page.waitForTimeout(600);
      await page.locator("[data-gallery]").screenshot({ path: join(outDir, `sidebar-${choice}-${tone}.png`) });
      const titles = await page.locator("[data-sidebar-thread-row]").allInnerTexts();
      rows.push({ capture: `sidebar-${choice}-${tone}`, listedRows: titles.length, titles: titles.map((text) => text.replace(/\s+/g, " ").trim()) });
      await context.close();
    }
    {
      const { context, page } = await open("header");
      await page.waitForSelector("[data-gallery-header] button[aria-expanded]");
      await page.waitForTimeout(500);
      await page.locator("[data-gallery-header] button[aria-expanded]").first().click();
      await page.waitForSelector("[data-task-picker-menu]");
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(outDir, `header-${choice}-${tone}.png`) });
      rows.push({ capture: `header-${choice}-${tone}`, listedRows: await page.locator("[data-task-picker-menu] [data-sidebar-thread-row]").count() });
      await context.close();
    }
  }
  await writeFile(join(outDir, "rows.json"), JSON.stringify(rows, null, 2));
  console.log(`screenshots in ${outDir}`);
  console.log(JSON.stringify(rows.map(({ capture, listedRows }) => ({ capture, listedRows }))));
} catch (error) {
  console.error(error);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  try { await browser?.close(); } catch { /* closed */ }
  try { process.kill(-vite.pid, "SIGTERM"); } catch { vite.kill("SIGTERM"); }
}
