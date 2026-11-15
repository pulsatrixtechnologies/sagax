#!/usr/bin/env node
/**
 * Headless screenshots of a routine's page in the side panel (#4357): its
 * three tabs (Overview, Runs, Settings) for a scheduled routine and a webhook
 * routine, English and French, light and dark, each side by side with the
 * bot profile page's tabs (the conforming neighbour, the same reference
 * tabs). Prints the tabs' measured boxes. Headless Chromium only: no window
 * opens, nothing is clicked on the real screen.
 * Usage: node scripts/capture/routine-page-tabs.mjs --out DIR [--port 5341]
 *   [--root DIR] (the repo whose gallery is served; default this one)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; };
const root = resolve(arg("--root", here));
const outDir = resolve(arg("--out", join(here, "docs", "screenshots", "routine-page-tabs")));
const port = Number(arg("--port", 5341));
const skins = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];
const langs = ["en", "fr"];
const kinds = (arg("--kinds", "schedule,webhook,webhook-missing,webhook-view")).split(",");
const runCount = arg("--runs", "9");
const tabs = ["overview", "runs", "settings"];

const vite = spawn("pnpm", ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });
let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery`;
  for (const start = Date.now(); ; await new Promise((done) => setTimeout(done, 500))) {
    try { if ((await fetch(`${base}/routine-page-tabs.html`)).status < 500) break; } catch { /* retry */ }
    if (Date.now() - start > 120_000) throw new Error("gallery did not start");
  }
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, channel: process.env.SAGAX_CAPTURE_CHANNEL || "chrome" });
  const page = await browser.newPage({ viewport: { width: 420, height: 780 }, deviceScaleFactor: 2 });
  const neighbour = await browser.newPage({ viewport: { width: 760, height: 780 }, deviceScaleFactor: 2 });
  const sheet = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  const measure = (selector) => page.$$eval(selector, (nodes) => nodes.map((node) => {
    const box = node.getBoundingClientRect(); const style = getComputedStyle(node);
    return { text: node.textContent?.trim(), w: Math.round(box.width), h: Math.round(box.height), font: style.fontSize, line: style.lineHeight, pad: style.padding, color: style.color, selected: node.getAttribute("aria-selected") };
  }));
  for (const { id: skin, label } of skins) for (const lang of langs) {
    await neighbour.goto(`${base}/bot-profile.html?skin=${skin}&lang=${lang}`, { waitUntil: "load" });
    await neighbour.waitForSelector("[data-bot-profile-tabs]");
    await neighbour.waitForTimeout(500);
    const neighbourShot = await neighbour.screenshot();
    const neighbourTabs = await neighbour.$$eval("[data-bot-profile-tab]", (nodes) => nodes.map((node) => { const box = node.getBoundingClientRect(); const style = getComputedStyle(node); return { text: node.textContent?.trim(), h: Math.round(box.height), font: style.fontSize, line: style.lineHeight, pad: style.padding }; }));
    console.log("neighbour", skin, lang, JSON.stringify(neighbourTabs.slice(0, 2)));
    for (const kind of kinds) for (const tab of tabs) {
      await page.goto(`${base}/routine-page-tabs.html?skin=${skin}&lang=${lang}&kind=${kind}&runs=${runCount}&width=400`, { waitUntil: "load" });
      await page.waitForSelector("[data-routine-page-tab]");
      await page.click(`[data-routine-page-tab="${tab}"]`);
      await page.waitForTimeout(450);
      if (tab === "overview") console.log(kind, skin, lang, JSON.stringify(await measure("[data-routine-page-tab]")));
      const name = `${kind}-${tab}-${lang}-${label}`;
      const shot = await page.screenshot({ path: join(outDir, `${name}.png`) });
      await sheet.setContent(`<body style="margin:0;display:flex;gap:16px;background:#888;align-items:flex-start">
        <figure style="margin:0"><img style="width:420px" src="data:image/png;base64,${shot.toString("base64")}"><figcaption style="font:12px sans-serif">${name}</figcaption></figure>
        <figure style="margin:0"><img style="width:760px" src="data:image/png;base64,${neighbourShot.toString("base64")}"><figcaption style="font:12px sans-serif">neighbour: bot profile tabs</figcaption></figure></body>`);
      await sheet.screenshot({ path: join(outDir, `${name}-side-by-side.png`), fullPage: true });
    }
  }
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(error); console.error(log.slice(-4000)); process.exitCode = 1;
} finally {
  await browser?.close();
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* gone */ }
}
