#!/usr/bin/env node
/**
 * The Feedback bot in the sidebar (#2955). Real AppSidebar and ChatView on a
 * synthetic store (gallery src/gallery/feedback-bot.html), headless Chrome.
 * A fixture, not the live server: "before" is the member's bot list without
 * the Feedback bot (what the server sent before the fix), "after" lists it in
 * the bots section with its chat open on the kind card, while another bot
 * works on a long turn. Light and dark, en and fr. Writes capture.json with
 * what the DOM says (Feedback row present, selected, card shown).
 *
 *   node scripts/capture/feedback-bot.mjs [--out DIR] [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = resolve(arg("--out", join(here, "docs", "screenshots", "feedback-bot")));
const port = Number(arg("--port", "5188"));
const chrome = process.env.SAGAX_CHROMIUM || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const shots = [];
for (const state of ["before", "after"]) for (const lang of ["en", "fr"]) for (const [theme, skin] of [["dark", "pulsatrix"], ["light", "daylight"]]) shots.push({ state, lang, theme, skin });

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const vite = spawn(process.execPath, [join(here, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: here, stdio: "ignore", env: { ...process.env, NODE_ENV: "development" } });
let browser;
const notes = [];
try {
  const base = `http://127.0.0.1:${port}/src/gallery/feedback-bot.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  for (const shot of shots) {
    const context = await browser.newContext({ viewport: { width: 1338, height: 809 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error.message ?? error)));
    await page.goto(`${base}?skin=${shot.skin}&lang=${shot.lang}&state=${shot.state}`, { waitUntil: "networkidle" });
    await page.waitForSelector("aside[data-sidebar] [data-sidebar-bot-row]", { timeout: 90000 });
    await page.waitForTimeout(500);
    const dom = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("aside[data-sidebar] [data-sidebar-bot-row]")].map((n) => (n.getAttribute("aria-label") ?? n.textContent ?? "").trim().slice(0, 40));
      const text = document.body.innerText;
      return {
        rows,
        feedbackRow: rows.some((r) => /feedback/i.test(r)),
        cardShown: /What would you like to report\?|Qu'est-ce qu'on signale\?/.test(text),
        threadPanel: /Open thread|Ouvrir le fil/.test(text),
      };
    });
    const file = `${shot.state}-${shot.theme}-${shot.lang}.png`;
    await page.screenshot({ path: join(outDir, file) });
    notes.push({ file, ...shot, dom, errors });
    console.log(file, JSON.stringify({ ...dom, errors }));
    await context.close();
  }
  await writeFile(join(outDir, "capture.json"), JSON.stringify(notes, null, 2) + "\n");
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
