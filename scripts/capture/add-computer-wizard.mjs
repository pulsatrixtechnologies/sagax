#!/usr/bin/env node
// Captures the Add computer wizard (#2956) and the bot scope / sharing
// controls of the Enrolled hosts page (#2957) from the gallery, light and
// dark, fr and en, desktop and phone widths. Headless: no window on the Mac.
//
//   node scripts/capture/add-computer-wizard.mjs --out DIR [--tag after]
//        [--root /path/to/other/worktree] [--port 5190] [--langs fr,en]
//   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
//
// --root points the gallery at another checkout (origin/main for the
// "before" shots); the wizard is walked with its own buttons so the same
// script works on both sides. Install codes in the gallery are fake.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; };
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(arg("--root", resolve(here, "../..")));
const out = resolve(arg("--out", resolve(root, "artifacts/captures/add-computer")));
const tag = arg("--tag", "after");
const port = Number(arg("--port", "5190"));
const langs = arg("--langs", "fr,en").split(",");
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
const DIALOG = "[role=\"dialog\"]";
const shots = [];
let browser;

try {
  await waitForServer(`${base}/src/gallery/remote-sessions-admin.html`);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  const open = async (page, { skin, lang, width, height, extra = "" }) => {
    await page.setViewportSize({ width: Math.max(width, 390), height });
    await page.goto(`${base}/src/gallery/remote-sessions-admin.html?skin=${skin}&lang=${lang}&width=${width}&height=${height}${extra}`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-unattended-hosts]", { timeout: 20_000 });
    await pause(200);
  };
  const shoot = async (page, selector, name) => {
    const path = resolve(out, `${name}-${tag}.png`);
    await page.locator(selector).first().screenshot({ path });
    shots.push(path);
  };
  const click = async (page, selector) => { await page.locator(selector).first().click(); await pause(120); };

  // Warm-up: vite optimizes dependencies on the first visit and reloads the
  // page, which would pull the rug from under a shot. Visit until it is quiet.
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

    // The list with its rows (bots label, shared by, menu).
    await open(page, { skin: skin.id, lang, width: 1100, height: 640 });
    await shoot(page, "[data-gallery-sample=\"list\"]", `hosts-list-${id}`);
    if (await page.locator("[data-unattended-host-more]").count()) {
      await click(page, "[data-unattended-host-more]");
      await shoot(page, "[data-gallery-sample=\"list\"]", `hosts-menu-${id}`);
      if (await page.locator("[data-unattended-host-bots-edit]").count()) {
        await click(page, "[data-unattended-host-bots-edit]");
        await page.waitForSelector("[data-host-bots-dialog]");
        await shoot(page, DIALOG, `hosts-bots-dialog-${id}`);
        await page.keyboard.press("Escape"); await pause(150);
        await click(page, "[data-unattended-host-more]");
        await click(page, "[data-unattended-host-share]");
        await page.waitForSelector("[data-host-share-dialog]");
        await shoot(page, DIALOG, `hosts-share-dialog-${id}`);
        await page.locator("[data-host-share-search]").fill("ma"); await pause(250);
        await shoot(page, DIALOG, `hosts-share-search-${id}`);
        await page.keyboard.press("Escape"); await pause(150);
      } else {
        await page.keyboard.press("Escape"); await pause(150);
      }
    }

    // The wizard, walked with its own buttons: OS, mode, code.
    for (const width of [1100, 390]) {
      const w = width === 390 ? "phone" : "desktop";
      await open(page, { skin: skin.id, lang, width, height: width === 390 ? 844 : 720, extra: "&connect=0" });
      await click(page, "[data-remote-admin-add], [data-unattended-hosts-add]");
      await page.waitForSelector(DIALOG, { timeout: 60_000 });
      await shoot(page, DIALOG, `wizard-1-os-${w}-${id}`);
      await click(page, "[data-add-computer-os=\"macos\"]");
      await click(page, "[data-add-computer-next]");
      await shoot(page, DIALOG, `wizard-2-mode-${w}-${id}`);
      await click(page, "[data-add-computer-generate]");
      await page.waitForSelector("[data-unattended-value], [data-unattended-code]", { timeout: 10_000 });
      await pause(300);
      await shoot(page, DIALOG, `wizard-3-code-waiting-${w}-${id}`);
    }
    // The third step once the computer shows up in the list (poll).
    await open(page, { skin: skin.id, lang, width: 1100, height: 720 });
    await click(page, "[data-remote-admin-add], [data-unattended-hosts-add]");
    await click(page, "[data-add-computer-os=\"macos\"]");
    await click(page, "[data-add-computer-next]");
    await click(page, "[data-add-computer-generate]");
    const connected = await page.waitForSelector("[data-add-computer-connected]", { timeout: 15_000 }).then(() => true, () => false);
    if (connected) { await pause(200); await shoot(page, DIALOG, `wizard-3-code-connected-desktop-${id}`); }
    await page.close();
  }
  console.log(shots.join("\n"));
} catch (error) {
  console.error(error);
  console.error(logs.join("").slice(-4000));
  process.exitCode = 1;
} finally {
  try { await browser?.close(); } catch { /* already gone */ }
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* already gone */ }
}
