#!/usr/bin/env node
/**
 * Headless screenshots of the bot profile page (PersonaEditorModal >
 * BotProfilePage), from src/gallery/bot-profile.html, in a light and a dark
 * skin. For each skin and each `[data-bot-profile-tab]` the page has: open
 * the tab, then scroll its scroll area from top to bottom in 800px steps and
 * take a viewport screenshot at each step.
 * With any prefix but "before": also the Share popover (`[data-bot-profile-share]`)
 * and, on a tab that has `[data-bot-analytics-days]` buttons, one shot per range.
 * Headless Chromium only: no window opens, nothing is clicked on the real screen.
 * Usage: node scripts/capture/bot-profile.mjs --out DIR [--port 5188]
 *   [--prefix before|after] [--root DIR]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 * --root: the repo whose gallery is served (default: the repo of this script);
 * run the script from a checkout that has `playwright` in its node_modules.
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const root = resolve(arg("--root", scriptRoot));
const outDir = resolve(arg("--out", join(scriptRoot, "docs", "screenshots", "bot-profile")));
const port = Number(arg("--port", "5188"));
const prefix = arg("--prefix", "after");
const withExtras = prefix !== "before";
const STEP = 800;
const MAX_STEPS = 40;
const skins = [{ id: "pulsatrix-light", label: "light" }, { id: "pulsatrix", label: "dark" }];

async function waitForServer(url, ms = 180_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const vite = spawn(
  process.execPath,
  [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" } },
);
vite.stdout.resume();
vite.stderr.on("data", (chunk) => {
  const text = String(chunk);
  if (/error/i.test(text)) console.error("vite:", text.slice(0, 400));
});

/** Scrolls the open panel's scroll area (runs in the page): to the top
 * (`step` 0), or one step down. Returns true once the bottom is reached.
 * The area is [data-bot-profile-scroll], else the scrollable box inside the
 * page or modal with the most to scroll, else the document. */
const SCROLL = (step) => {
  let target = document.querySelector("[data-bot-profile-scroll]");
  if (!target) {
    const scope = document.querySelector("[data-bot-profile-page]") ?? document.querySelector("[data-persona-modal]") ?? document.body;
    let best = 0;
    for (const el of [scope, ...scope.querySelectorAll("*")]) {
      const overflow = getComputedStyle(el).overflowY;
      const room = el.scrollHeight - el.clientHeight;
      if ((overflow === "auto" || overflow === "scroll") && room > best) { best = room; target = el; }
    }
  }
  if (!target) target = document.scrollingElement ?? document.documentElement;
  if (step === 0) { target.scrollTop = 0; return false; }
  const before = target.scrollTop;
  target.scrollTop = before + step;
  return target.scrollTop === before || target.scrollTop + target.clientHeight >= target.scrollHeight - 1;
};

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/bot-profile.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  const shoot = async (page, name) => {
    const file = join(outDir, name);
    await page.screenshot({ path: file });
    console.log("shot", file);
  };
  for (const skin of skins) {
    const page = await browser.newPage({ viewport: { width: 1480, height: 900 }, deviceScaleFactor: 2, colorScheme: skin.label === "dark" ? "dark" : "light" });
    page.on("pageerror", (error) => console.error("page error:", error.message));
    await page.goto(`${base}?skin=${skin.id}&lang=en`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-bot-profile-tab]", { timeout: 60_000 });
    await page.waitForTimeout(800);
    const tabs = await page.$$eval("[data-bot-profile-tab]", (els) => els.map((el) => el.getAttribute("data-bot-profile-tab")));
    console.log(`${skin.label}: tabs ${tabs.join(", ")}`);
    for (const tab of tabs) {
      await page.click(`[data-bot-profile-tab="${tab}"]`);
      await page.waitForSelector("[data-bot-profile-panel]:not([hidden])", { timeout: 10_000 }).catch(() => console.error(`no visible panel for ${tab}`));
      await page.waitForTimeout(900);
      await page.evaluate(SCROLL, 0);
      for (let index = 0; index < MAX_STEPS; index += 1) {
        await page.waitForTimeout(250);
        await shoot(page, `${prefix}-${tab}-${index}-${skin.label}.png`);
        if (await page.evaluate(SCROLL, STEP)) break;
      }
      await page.evaluate(SCROLL, 0);
      if (withExtras) {
        const ranges = await page.$$eval("[data-bot-analytics-days]", (els) => els.map((el) => el.getAttribute("data-bot-analytics-days")));
        for (const days of ranges) {
          await page.click(`[data-bot-analytics-days="${days}"]`);
          await page.waitForTimeout(700);
          await shoot(page, `${prefix}-analytics-${days}-${skin.label}.png`);
        }
      }
    }
    if (withExtras && await page.locator("[data-bot-profile-share]").count()) {
      await page.click("[data-bot-profile-share]");
      await page.waitForTimeout(700);
      await shoot(page, `${prefix}-share-${skin.label}.png`);
      await page.keyboard.press("Escape");
    }
    await page.close();
  }
} finally {
  await browser?.close();
  vite.kill();
}
