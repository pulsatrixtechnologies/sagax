#!/usr/bin/env node
/**
 * Headless screenshots of the customizable bot page banner (M-20261127-183).
 * Gallery: src/gallery/bot-profile.html with ?banner= and ?bannerEffect=.
 * Captures: default, image, each effect, the settings panel, light/dark, en/fr.
 * Headless Chromium only (channel: chrome when available). No visible window.
 *
 * Usage: node scripts/capture/bot-banner.mjs --out DIR [--port 5191]
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const root = resolve(arg("--root", scriptRoot));
const outDir = resolve(arg("--out", join(scriptRoot, "docs", "screenshots", "bot-banner")));
const port = Number(arg("--port", "5191"));
const skins = [
  { id: "pulsatrix-light", label: "light" },
  { id: "pulsatrix", label: "dark" },
];
const langs = ["en", "fr"];
const effects = ["blur", "darken", "grain", "animatedGradient", "parallax"];

async function waitForServer(url, ms = 180_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {
      /* retry */
    }
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

const galleryPath = "/src/gallery/bot-profile.html";
let browser;
const shots = [];
try {
  const base = `http://127.0.0.1:${port}${galleryPath}`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const launch = { headless: true, channel: "chrome" };
  try {
    browser = await chromium.launch(launch);
  } catch {
    browser = await chromium.launch({ headless: true });
  }

  const shoot = async (page, name) => {
    const file = join(outDir, name);
    await page.screenshot({ path: file });
    shots.push(name);
    console.log("shot", file);
  };

  const open = async (query, skin, lang) => {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 2,
      colorScheme: skin.label === "dark" ? "dark" : "light",
    });
    page.on("pageerror", (error) => console.error("page error:", error.message));
    const url = `${base}?skin=${skin.id}&lang=${lang}&${query}`;
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-bot-profile-banner]", { timeout: 60_000 });
    await page.waitForTimeout(600);
    return page;
  };

  for (const lang of langs) {
    for (const skin of skins) {
      // Default wash
      {
        const page = await open("section=overview", skin, lang);
        await shoot(page, `default-${lang}-${skin.label}.png`);
        await page.close();
      }
      // Custom image
      {
        const page = await open("section=overview&banner=image&bannerEffect=darken", skin, lang);
        await shoot(page, `image-${lang}-${skin.label}.png`);
        await page.close();
      }
      // Each effect on an image
      for (const effect of effects) {
        const page = await open(`section=overview&banner=image&bannerEffect=${effect}`, skin, lang);
        await shoot(page, `effect-${effect}-${lang}-${skin.label}.png`);
        await page.close();
      }
      // Settings panel open
      {
        const page = await open("section=overview&banner=mascot", skin, lang);
        const edit = page.locator("[data-bot-profile-banner-edit]");
        await edit.evaluate((el) => {
          el.style.opacity = "1";
        });
        await edit.click();
        await page.waitForSelector("[data-bot-banner-panel]", { timeout: 10_000 });
        await page.waitForTimeout(400);
        await shoot(page, `panel-${lang}-${skin.label}.png`);
        await page.close();
      }
    }
  }

  await writeFile(join(outDir, "shots.json"), `${JSON.stringify({ shots, at: new Date().toISOString() }, null, 2)}\n`);
} finally {
  await browser?.close();
  try {
    process.kill(vite.pid, "SIGTERM");
  } catch {
    /* already gone */
  }
}
