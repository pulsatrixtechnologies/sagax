#!/usr/bin/env node
/**
 * Headless screenshots of the soul editor (#5019), from
 * src/gallery/bot-profile.html?section=soul: the editor as it opens, then
 * with a rule pasted into it (where Sagax will file it), then once the
 * editor is left (what was filed). Wide, 700 px and 390 px; light and dark;
 * English and French. Headless Chromium only: no window opens, nothing is
 * clicked on the real screen.
 * Usage: node scripts/capture/soul-sort.mjs --out DIR [--port 5291]
 *   [--prefix before|after] [--root DIR]
 * --root: the repo whose gallery is served (default: the repo of this script).
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
const outDir = resolve(arg("--out", join(scriptRoot, "docs", "screenshots", "soul-sort")));
const port = Number(arg("--port", "5291"));
const prefix = arg("--prefix", "after");
const skins = [{ id: "pulsatrix-light", label: "light" }, { id: "pulsatrix", label: "dark" }];
const widths = [{ width: 1480, height: 900, label: "wide" }, { width: 700, height: 900, label: "700" }, { width: 390, height: 844, label: "390" }];
const RULE = { en: "Never send an email to a client without showing me the draft first.", fr: "N'envoie jamais un courriel à un client sans me montrer le brouillon." };

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

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/bot-profile.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  for (const lang of ["en", "fr"]) {
    for (const skin of skins) {
      for (const size of widths) {
        const page = await browser.newPage({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2, colorScheme: skin.label === "dark" ? "dark" : "light" });
        page.on("pageerror", (error) => console.error("page error:", error.message));
        await page.goto(`${base}?skin=${skin.id}&lang=${lang}&section=soul`, { waitUntil: "networkidle" });
        const editor = page.locator('[data-markdown-editor="soul"] textarea, [data-markdown-editor="soul"] [contenteditable="true"]').first();
        await editor.waitFor({ timeout: 60_000 });
        await page.waitForTimeout(800);
        const name = (state) => join(outDir, `${prefix}-${state}-${size.label}-${skin.label}-${lang}.png`);
        await page.screenshot({ path: name("open") });
        await editor.click();
        await page.keyboard.press("ControlOrMeta+End");
        await page.keyboard.type(`\n\n${RULE[lang]}`);
        await page.waitForSelector("[data-soul-sort-preview]", { timeout: 6_000 }).catch(() => console.log(`${prefix}: no preview (${lang}, ${skin.label}, ${size.label})`));
        await page.waitForTimeout(400);
        await page.locator("[data-soul-sort-preview], [data-markdown-editor='soul']").last().scrollIntoViewIfNeeded().catch(() => {});
        await page.screenshot({ path: name("typed") });
        // leave the editor: the draft is filed and the editor says where
        await page.keyboard.press("Tab");
        await page.waitForSelector("[data-soul-sorted]", { timeout: 6_000 }).catch(() => console.log(`${prefix}: no filed notice (${lang}, ${skin.label}, ${size.label})`));
        await page.waitForTimeout(400);
        await page.locator("[data-soul-sorted], [data-soul-open-rules], [data-markdown-editor='soul']").last().scrollIntoViewIfNeeded().catch(() => {});
        await page.screenshot({ path: name("left") });
        console.log("shot", name("*"));
        await page.close();
      }
    }
  }
} finally {
  await browser?.close();
  vite.kill();
}
