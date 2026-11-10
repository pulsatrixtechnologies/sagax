#!/usr/bin/env node
/**
 * Headless screenshots of every card that waits for the person (#3471),
 * gallery waiting-cards (Playwright, channel chrome, no window): each kind
 * with its skip, folded as skipped and as expired, and the pinned card over
 * the composer, beside the conforming neighbour (the compact approval card).
 * French and English, light and dark.
 * Usage: node scripts/capture/waiting-cards.mjs [--out DIR] [--port N] [--mode before|after]
 * Files: <mode>-<lang>-<light|dark>-<kind>.png
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "waiting-cards")));
const port = Number(arg("--port", "5347"));
const mode = arg("--mode", "after");
const KINDS = ["approval", "approval-folded", "choice", "free-text", "question-folded", "handoff", "routine", "words-folded", "proposal", "proposal-choice", "proposal-folded", "pinned"];
const SKINS = { light: "pulsatrix-light", dark: "pulsatrix" };

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
  const base = `http://127.0.0.1:${port}/src/gallery/waiting-cards.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  for (const lang of ["en", "fr"]) {
    for (const [tone, skin] of Object.entries(SKINS)) {
      for (const kind of KINDS) {
        await page.goto(`${base}?lang=${lang}&skin=${skin}&kind=${kind}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(300);
        const row = page.locator(`[data-variant="${kind}"]`);
        if (!(await row.count())) continue;
        const file = join(outDir, `${mode}-${lang}-${tone}-${kind}.png`);
        await row.first().screenshot({ path: file });
        console.log(file);
      }
    }
  }
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
