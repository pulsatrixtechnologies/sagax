#!/usr/bin/env node
/**
 * Headless screenshots of a turn's bot-to-bot traces through the real
 * ChatView (gallery ask-line, Playwright, no window): English and French; the
 * sender side with 2, 5 and 17 teammates (running, done, one stopped), the
 * full list opened and an exchange opened; the receiving side; Tool calls off
 * and on.
 * Usage: node scripts/capture/ask-line.mjs [--out DIR] [--port N] [--mode before|after]
 * Files: <mode>-<lang>-<side>-<n>-<state>-tools-<off|on>[-open|-sheet].png
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "ask-line")));
const port = Number(arg("--port", "5341"));
const mode = arg("--mode", "after");

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Vite gallery did not start at ${url}`);
}

const vite = spawn(
  process.execPath,
  [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" } },
);
let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/ask-line.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 2 });
  const shots = [];
  for (const lang of ["en", "fr"]) {
    for (const n of [2, 5, 17]) {
      for (const state of ["running", "done", "stopped"]) {
        for (const tools of [false, true]) shots.push({ lang, side: "sender", n, state, tools });
      }
    }
    shots.push({ lang, side: "sender", n: 17, state: "stopped", tools: false, open: true });
    shots.push({ lang, side: "sender", n: 5, state: "done", tools: false, sheet: true });
    for (const tools of [false, true]) shots.push({ lang, side: "receiver", n: 2, state: "done", tools });
  }
  for (const shot of shots) {
    const name = `${mode}-${shot.lang}-${shot.side}-${shot.n}-${shot.state}-tools-${shot.tools ? "on" : "off"}${shot.open ? "-open" : ""}${shot.sheet ? "-sheet" : ""}`;
    await page.goto(`${base}?lang=${shot.lang}&side=${shot.side}&n=${shot.n}&state=${shot.state}${shot.tools ? "&tools=1" : ""}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    if (shot.open) {
      const more = page.locator("[data-testid=ask-line-more]");
      if (await more.count()) await more.first().click();
      await page.waitForTimeout(200);
    }
    if (shot.sheet) {
      const who = page.locator("[data-testid=ask-line-recipient]");
      if (await who.count()) await who.first().click();
      await page.waitForTimeout(500);
    }
    const file = join(outDir, `${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(file);
  }
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
