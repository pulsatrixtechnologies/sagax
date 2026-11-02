#!/usr/bin/env node
/**
 * Headless screenshots of the bot panel's Tasks section (Playwright, no
 * window, no focus taken), above the Routines section: the empty list,
 * the one list (Needs you first, then In progress), a task just done (green check), a task opened and a row
 * menu, in the dark and the light skin. Mocked API; no server.
 * Usage: node scripts/capture/bot-task-list.mjs [--out DIR] [--port N] [--lang en] [--states a,b] [--prefix p-]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "bot-task-list")));
const port = Number(arg("--port", "5297"));
const lang = arg("--lang", "en");
const states = arg("--states", "empty,tasks,done,detail,menu").split(",");
const prefix = arg("--prefix", "");

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Vite gallery did not start at ${url}`);
}

const vite = spawn(
  process.execPath,
  [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" } },
);
let viteLog = "";
vite.stdout?.on("data", (c) => { viteLog += c; });
vite.stderr?.on("data", (c) => { viteLog += c; });

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/bot-task-list.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM, headless: true } : { headless: true });
  const errors = [];
  for (const skin of ["pulsatrix", "daylight"]) {
    for (const state of states) {
      const page = await browser.newPage({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2, colorScheme: skin === "daylight" ? "light" : "dark" });
      page.on("pageerror", (error) => { errors.push(String(error)); console.error(String(error)); });
      page.on("console", (message) => { if (message.type() === "error") console.error(message.text()); });
      await page.goto(`${base}?skin=${skin}&lang=${lang}&state=${state === "empty" ? "empty" : "tasks"}`, { waitUntil: "networkidle" });
      const target = page.locator("[data-gallery-card]");
      await target.waitFor();
      // the bot comes from the store once it hydrates: Answer shows then
      if (state !== "empty") await page.locator("[data-bot-task-answer]").waitFor();
      await page.waitForTimeout(300);
      if (state === "done") {
        // the doing task is marked done from its menu: its row shows the green check for a moment
        await page.locator('[data-bot-task="doing"]').first().hover();
        await page.locator('[data-bot-task="doing"] [data-bot-task-menu]').first().click();
        await page.locator('[data-bot-task-action="complete"]').click();
        await page.locator('[data-bot-task="done"]').waitFor();
        await page.waitForTimeout(250);
      }
      if (state === "detail") {
        await page.locator('[data-bot-task="waiting"] [data-bot-task-open]').first().click();
        await page.locator("[data-bot-task-detail]").waitFor();
        await page.waitForTimeout(200);
      }
      if (state === "menu") {
        // from the keyboard: Shift+F10 on the row
        await page.locator('[data-bot-task="doing"] [data-bot-task-open]').first().focus();
        await page.keyboard.press("Shift+F10");
        await page.locator("[data-bot-task-menu-open]").waitFor();
        await page.waitForTimeout(200);
      }
      const file = join(outDir, `${prefix}${state}-${skin === "daylight" ? "light" : "dark"}.png`);
      // the row menu is a portal over the panel: clip the page to the panel
      if (state === "menu") await page.screenshot({ path: file, clip: await target.boundingBox() });
      else await target.screenshot({ path: file });
      console.log(file);
      await page.close();
    }
  }
  if (errors.length) throw new Error(`page errors:\n${errors.join("\n")}`);
} catch (error) {
  console.error(viteLog.slice(-2000));
  throw error;
} finally {
  await browser?.close().catch(() => {});
  vite.kill("SIGTERM");
}
