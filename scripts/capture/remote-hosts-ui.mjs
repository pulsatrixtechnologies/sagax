#!/usr/bin/env node
// Captures the Remote sessions device sections (#3134: unattended computers
// apart from the other devices, every card the same height) and the Add
// computer modal with a long bot list (scrolling body, fixed footer), light
// and dark, desktop and narrow widths. Headless: no window on the Mac.
//
//   node scripts/capture/remote-hosts-ui.mjs --out DIR [--tag after] [--port 5191] [--langs en,fr]
//   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; };
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(arg("--root", resolve(here, "../..")));
const out = resolve(arg("--out", resolve(root, "artifacts/captures/remote-hosts-ui")));
const tag = arg("--tag", "after");
const port = Number(arg("--port", "5191"));
const langs = arg("--langs", "en,fr").split(",");
mkdirSync(out, { recursive: true });

const base = `http://127.0.0.1:${port}`;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForServer(url, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try { const res = await fetch(url); if (res.ok || res.status === 404) return; } catch { /* not yet */ }
    await pause(250);
  }
  throw new Error(`gallery did not start on ${url}`);
}

const vite = spawn("pnpm", ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], detached: true });
const logs = [];
vite.stdout.on("data", (d) => logs.push(String(d)));
vite.stderr.on("data", (d) => logs.push(String(d)));

const SKINS = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];
const shots = [];
let browser;

try {
  await waitForServer(`${base}/src/gallery/remote-sessions-admin.html`);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  const url = ({ skin, lang, width, height, extra = "" }) => `${base}/src/gallery/remote-sessions-admin.html?skin=${skin}&lang=${lang}&width=${width}&height=${height}&bots=many${extra}`;
  const open = async (page, opts) => {
    await page.setViewportSize({ width: Math.max(opts.width, 390), height: opts.height });
    await page.goto(url(opts), { waitUntil: "networkidle" });
    await page.waitForSelector("[data-unattended-hosts]", { timeout: 20_000 });
    await pause(400);
  };
  const shootEl = async (page, selector, name) => {
    const path = resolve(out, `${name}-${tag}.png`);
    await page.locator(selector).first().screenshot({ path });
    shots.push(path);
  };
  const shootPage = async (page, name) => {
    const path = resolve(out, `${name}-${tag}.png`);
    await page.screenshot({ path });
    shots.push(path);
  };
  const click = async (page, selector) => { await page.locator(selector).first().click(); await pause(150); };

  {
    const warm = await browser.newPage();
    for (let i = 0; i < 6; i++) {
      const before = logs.length;
      await warm.goto(`${base}/src/gallery/remote-sessions-admin.html?lang=${langs[0]}`, { waitUntil: "networkidle" });
      await pause(2500);
      if (!logs.slice(before).join("").includes("reloading")) break;
    }
    await warm.close();
  }

  for (const skin of SKINS) for (const lang of langs) {
    const page = await browser.newPage({ deviceScaleFactor: 2 });
    const id = `${lang}-${skin.label}`;
    // The page: device sections, desktop and narrow.
    await open(page, { skin: skin.id, lang, width: 1100, height: 900 });
    await shootEl(page, "[data-gallery-sample=\"list\"]", `page-desktop-${id}`);
    await open(page, { skin: skin.id, lang, width: 390, height: 1100 });
    await shootEl(page, "[data-gallery-sample=\"list\"]", `page-narrow-${id}`);
    // The modal, walked with its own buttons, in a short window (the list must scroll).
    for (const [w, width, height] of [["desktop", 1100, 640], ["narrow", 390, 700]]) {
      await open(page, { skin: skin.id, lang, width, height, extra: "&connect=0" });
      await click(page, "[data-remote-admin-add], [data-unattended-hosts-add]");
      await page.waitForSelector("[role=\"dialog\"]", { timeout: 60_000 });
      await shootPage(page, `modal-1-os-${w}-${id}`);
      await click(page, "[data-add-computer-os=\"linux\"]");
      await click(page, "[data-add-computer-next]");
      await shootPage(page, `modal-2-access-${w}-${id}`);
      // Scrolled to the end of the body: the footer stays put, the list ends above it.
      await page.locator("[data-dialog-body]").first().evaluate((el) => { el.scrollTop = el.scrollHeight; }).catch(() => {});
      await page.locator("[role=\"dialog\"] [data-host-bots-picker]").first().evaluate((el) => {
        let box = el.parentElement;
        while (box && box.scrollHeight <= box.clientHeight) box = box.parentElement;
        if (box) box.scrollTop = box.scrollHeight;
      });
      await pause(200);
      await shootPage(page, `modal-2-access-scrolled-${w}-${id}`);
      // Pick two bots: "All bots" lets go, the list stays readable.
      // Unchecking "All bots" opens the list with every bot checked; uncheck two.
      await click(page, "[data-host-bots-all]");
      await click(page, "[data-host-bot=\"bot-nova\"]");
      await click(page, "[data-host-bot=\"bot-pixel\"]");
      await shootPage(page, `modal-2-access-picked-${w}-${id}`);
      await click(page, "[data-add-computer-generate]");
      await page.waitForSelector("[data-unattended-code]", { timeout: 10_000 });
      await pause(300);
      await shootPage(page, `modal-3-install-${w}-${id}`);
    }
    await page.close();
  }
  console.log(`${shots.length} shots in ${out}`);
} catch (error) {
  console.error(error);
  console.error(logs.join("").slice(-4000));
  process.exitCode = 1;
} finally {
  try { await browser?.close(); } catch { /* already gone */ }
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* already gone */ }
}
