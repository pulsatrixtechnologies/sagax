#!/usr/bin/env node
/**
 * Headless screenshots of the bot panel's Routines list with folders
 * (Playwright, no window, no focus taken), beside a sidebar section header
 * for the alignment: titles with [prefixes] and the Sort by prefix offer,
 * the list in folders, a folder collapsed, and the row menu's Move to
 * folder, in the dark and the light skin. Mocked API; no server.
 * The states old-sort and old-menu draw a 0.8.7 server (no folders): the
 * Sort by prefix click and the row menu (2026-10-28).
 * Usage: node scripts/capture/routine-folders.mjs [--out DIR] [--port N] [--lang en] [--states a,b]
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "routine-folders")));
const port = Number(arg("--port", "5293"));
const lang = arg("--lang", "en");
const states = arg("--states", "prefixed,filed,collapsed,menu").split(",");
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
  const base = `http://127.0.0.1:${port}/src/gallery/routine-folders.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM, headless: true } : { headless: true });
  const errors = [];
  for (const skin of ["pulsatrix", "daylight"]) {
    for (const state of states) {
      const page = await browser.newPage({ viewport: { width: 760, height: 1400 }, deviceScaleFactor: 2, colorScheme: skin === "daylight" ? "light" : "dark" });
      page.on("pageerror", (error) => { errors.push(String(error)); console.error(String(error)); });
      page.on("console", (message) => { if (message.type() === "error") console.error(message.text()); });
      const old = state.startsWith("old-");
      await page.goto(`${base}?skin=${skin}&lang=${lang}&state=${old ? "prefixed" : state === "menu" || state === "drag" || state === "running" ? "filed" : state}${old ? "&server=0.8.7" : ""}${state === "running" ? "&live=1" : ""}`, { waitUntil: "networkidle" });
      const target = page.locator("[data-gallery-card]");
      await target.waitFor();
      await page.waitForTimeout(300);
      if (state === "old-sort") {
        // The offer, where an app still shows it, meets the older server.
        const sort = page.locator("[data-routine-prefix-sort]");
        if (await sort.count()) { await sort.click(); await page.waitForTimeout(400); }
      }
      if (state === "old-menu") {
        await page.locator("[data-routine-row]").first().click({ button: "right", position: { x: 120, y: 20 } });
        await page.locator("[data-routine-folder-menu]").waitFor();
        await page.waitForTimeout(200);
      }
      if (state === "menu") {
        // A routine in a folder: the menu also offers Remove from folder.
        const row = page.locator('[data-routine-folder-section="Reports"] [data-routine-row]').first();
        await row.click({ button: "right", position: { x: 120, y: 20 } });
        await page.locator("[data-routine-folder-menu]").waitFor();
        await page.waitForTimeout(200);
      }
      if (state === "drag") {
        // A routine held and carried over a folder: the preview follows the
        // pointer and the folder under it lights up.
        const from = await page.locator('[data-routine-folder-section=""] [data-routine-row]').first().boundingBox();
        const over = await page.locator('[data-routine-folder-section="Reports"]').boundingBox();
        if (!from || !over) throw new Error("drag: nothing to drag");
        await page.mouse.move(from.x + 60, from.y + from.height / 2);
        await page.mouse.down();
        await page.mouse.move(from.x + 90, from.y + from.height / 2 + 12, { steps: 4 });
        await page.mouse.move(over.x + 120, over.y + over.height / 2, { steps: 8 });
        await page.locator("[data-routine-drag-preview]").waitFor();
        await page.waitForTimeout(150);
      }
      const file = join(outDir, `${prefix}${state}-${skin === "daylight" ? "light" : "dark"}.png`);
      await target.screenshot({ path: file });
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
