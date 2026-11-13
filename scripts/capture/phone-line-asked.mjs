#!/usr/bin/env node
/**
 * Headless screenshots of lines that came in on the person's phone line
 * (#4112) through the real ChatView (gallery phone-line-asked, Playwright with
 * Chrome, no window): English and French, light and dark, 1280 and 390 px;
 * in the live order (text, answer, text, answer): one text, three texts from
 * one number, texts from two numbers, a text between teammate requests, a
 * call request, the row opened; the conforming
 * neighbour beside them (teammate requests alone, pane=teammates).
 * Usage: node scripts/capture/phone-line-asked.mjs [--out DIR] [--port N] [--mode before|after]
 * Files: <mode>-<lang>-<theme>-<width>-<scene>[-open].png, neighbour-<lang>-<theme>-<width>.png
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "phone-line-asked")));
const port = Number(arg("--port", "5351"));
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

const THEMES = [["light", "daylight"], ["dark", "pulsatrix"]];
const WIDTHS = [1280, 390];
const SCENES = ["one", "three", "two", "between", "call"];

const vite = spawn(
  process.execPath,
  [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" } },
);
let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/phone-line-asked.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  for (const lang of ["en", "fr"]) {
    for (const [theme, skin] of THEMES) {
      for (const width of WIDTHS) {
        const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 }, deviceScaleFactor: 2 });
        const go = async (query) => {
          await page.goto(`${base}?lang=${lang}&skin=${skin}&${query}`, { waitUntil: "networkidle" });
          await page.waitForTimeout(600);
        };
        if (mode === "after") {
          await go("pane=teammates");
          await page.screenshot({ path: join(outDir, `neighbour-${lang}-${theme}-${width}.png`) });
        }
        for (const scene of SCENES) {
          const name = `${mode}-${lang}-${theme}-${width}-${scene}`;
          await go(`scene=${scene}`);
          await page.screenshot({ path: join(outDir, `${name}.png`) });
          console.log(name);
          const party = page.locator("[data-testid=incoming-line-recipient]").first();
          if ((scene === "three" || scene === "two") && (await party.count())) {
            await party.click();
            await page.waitForTimeout(500);
            await page.screenshot({ path: join(outDir, `${name}-open.png`) });
          }
        }
        await page.close();
      }
    }
  }
  console.log(`screenshots in ${outDir}`);
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
