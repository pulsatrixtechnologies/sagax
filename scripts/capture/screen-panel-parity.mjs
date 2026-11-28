#!/usr/bin/env node
/**
 * Headless screenshots of the screen side panel's two modes (M-20261127-181):
 * src/gallery/screen-panel.html?vm=server, the browser and the VM (the real
 * noVNC client against the gallery's stand-in VNC server, no real VM), light
 * and dark. Writes the panel in Browser mode above the same panel in VM mode,
 * and the VM's screen at three panel widths side by side, with the measured
 * size of the screen in the panel. Real Chrome headless, DPR 2: no window opens.
 * Usage: node scripts/capture/screen-panel-parity.mjs [--out DIR] [--port N] [--prefix NAME] [--lang fr|en]
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "screen-panel"));
const port = Number(arg("--port") ?? 5313);
const prefix = arg("--prefix") ?? "screen-panel-parity";
const lang = arg("--lang") ?? "fr";
const skins = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];
const WIDTH_KEY = "sagax.screenPanel.width.v1";
const MODE_WIDTH = 480;
const FIT_WIDTHS = [360, 560, 900];

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const vite = spawn("pnpm", ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

/** One page per panel width: the width is the panel's own stored key. */
async function openPanel(browser, base, skin, width) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 880 }, deviceScaleFactor: 2 });
  await context.addInitScript(([key, value]) => { try { localStorage.setItem(key, value); } catch { /* none */ } }, [WIDTH_KEY, String(width)]);
  const page = await context.newPage();
  await page.goto(`${base}?skin=${skin}&lang=${lang}&vm=server&neighbour=0`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForSelector("[data-screen-panel]", { timeout: 120_000 });
  return { page, context };
}

async function showVm(page) {
  await page.click("[data-screen-tab=vm]");
  await page.waitForSelector("[data-screen-pane=vm] [data-sandbox-desktop=connected] canvas", { timeout: 20_000 });
  await page.waitForTimeout(900);
}

/** The panel's own picture and what the screen measures in it. */
async function shoot(page) {
  const panel = page.locator("[data-screen-panel]");
  const png = await panel.screenshot();
  const measure = await page.evaluate(() => {
    const aside = document.querySelector("[data-screen-panel]").getBoundingClientRect();
    const canvas = document.querySelector("[data-screen-pane=vm] canvas");
    const pane = document.querySelector("[data-screen-pane=vm]");
    const screen = canvas ? canvas.getBoundingClientRect() : null;
    const frame = pane ? pane.getBoundingClientRect() : null;
    const bar = document.querySelector("[data-screen-panel-bar], [data-screen-panel-tabs], [data-browser-tabs]");
    const buttons = bar ? [...document.querySelectorAll("[data-screen-panel] button")].filter((button) => button.offsetParent !== null).map((button) => {
      const box = button.getBoundingClientRect();
      const name = button.dataset.screenTab ? `place:${button.dataset.screenTab}` : button.hasAttribute("data-screen-control") || button.hasAttribute("data-browser-take") || button.hasAttribute("data-browser-give-back") ? "control"
        : button.hasAttribute("data-screen-panel-marks") ? "mark-up" : button.hasAttribute("data-screen-panel-detach") ? "detach"
        : button.hasAttribute("data-screen-panel-expand") ? "expand" : button.hasAttribute("data-screen-panel-close") ? "close" : null;
      return name ? { name, x: Math.round(box.left - aside.left), y: Math.round(box.top - aside.top) } : null;
    }).filter(Boolean) : [];
    return {
      panel: { width: Math.round(aside.width), height: Math.round(aside.height) },
      frame: frame && { left: Math.round(frame.left - aside.left), top: Math.round(frame.top - aside.top), width: Math.round(frame.width), height: Math.round(frame.height) },
      screen: screen && { left: Math.round(screen.left - aside.left), top: Math.round(screen.top - aside.top), width: Math.round(screen.width), height: Math.round(screen.height) },
      buttons,
    };
  });
  return { png, measure };
}

/** Lays pictures out on one sheet, in a column or in a row, with a caption each. */
async function sheet(browser, items, direction, file, dark) {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const cells = items.map(({ png, caption }) => `<figure><img src="data:image/png;base64,${png.toString("base64")}"><figcaption>${caption}</figcaption></figure>`).join("");
  await page.setContent(`<!doctype html><html><body style="margin:0;padding:24px;background:${dark ? "#101114" : "#e9eaee"};font:13px -apple-system,system-ui,sans-serif;color:${dark ? "#c9ccd3" : "#3b3f47"}">
    <div style="display:flex;flex-direction:${direction};gap:24px;align-items:flex-start">${cells}</div>
    <style>figure{margin:0;display:flex;flex-direction:column;gap:8px}img{width:${direction === "column" ? "auto" : "auto"};zoom:0.5;border:1px solid ${dark ? "#2a2d33" : "#c9ccd3"}}</style></body></html>`);
  await page.waitForTimeout(200);
  await page.screenshot({ path: file, fullPage: true });
  await context.close();
}

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/screen-panel.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  // A cold gallery bundles its dependencies and reloads once: warm it first.
  const warm = await openPanel(browser, base, skins[0].id, MODE_WIDTH);
  await warm.page.waitForTimeout(1500);
  await warm.context.close();
  const report = {};
  for (const { id, label } of skins) {
    // The two modes, one above the other, at the same panel width.
    const { page, context } = await openPanel(browser, base, id, MODE_WIDTH);
    await page.waitForSelector("img[data-browser-frame]", { timeout: 15_000 });
    await page.waitForTimeout(600);
    const browserShot = await shoot(page);
    await showVm(page);
    const vmShot = await shoot(page);
    await context.close();
    await writeFile(join(outDir, `${prefix}-browser-${label}.png`), browserShot.png);
    await writeFile(join(outDir, `${prefix}-vm-${label}.png`), vmShot.png);
    await sheet(browser, [{ png: browserShot.png, caption: "Browser" }, { png: vmShot.png, caption: "VM" }], "column", join(outDir, `${prefix}-modes-${label}.png`), label === "dark");
    report[`modes-${label}`] = { browser: browserShot.measure.buttons, vm: vmShot.measure.buttons };
    // The VM's screen at three panel widths.
    const fits = [];
    for (const width of FIT_WIDTHS) {
      const opened = await openPanel(browser, base, id, width);
      await showVm(opened.page);
      const shot = await shoot(opened.page);
      await opened.context.close();
      await writeFile(join(outDir, `${prefix}-vm-${width}-${label}.png`), shot.png);
      fits.push({ png: shot.png, caption: `${width} px: screen ${shot.measure.screen?.width}x${shot.measure.screen?.height} at top ${shot.measure.screen?.top}` });
      report[`vm-${width}-${label}`] = shot.measure;
    }
    await sheet(browser, fits, "row", join(outDir, `${prefix}-vm-widths-${label}.png`), label === "dark");
  }
  await writeFile(join(outDir, `${prefix}-measures.json`), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (log) console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* already gone */ }
}
