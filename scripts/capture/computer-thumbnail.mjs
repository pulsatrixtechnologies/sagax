#!/usr/bin/env node
/**
 * Headless screenshots of the bot panel's Computer row thumbnail (2026-11-06):
 * a fresh capture, an old one greyed out, no capture yet (unavailable, with
 * the reason), asleep (a stopped cloud computer, Off), the picture switching
 * with the computer, and the larger view. Then, as the desktop app with
 * Screen Recording not allowed (2026-11-07): the row's reason and the live
 * window that says it, with the System Settings button. The thumbnail
 * endpoint is answered here with synthetic desktops. Headless Chromium only.
 * Usage: node scripts/capture/computer-thumbnail.mjs [--out DIR] [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "computer-thumbnail"));
const port = Number(arg("--port") ?? 5334);
const skins = [{ id: "pulsatrix-light", label: "light" }, { id: "pulsatrix", label: "dark" }];

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

/** A synthetic desktop: a coloured wallpaper, a window and a dock. */
const desktop = (label, from, to) => `<html><body style="margin:0;width:1280px;height:800px;background:linear-gradient(135deg,${from},${to});font:28px -apple-system,sans-serif">
  <div style="position:absolute;left:160px;top:120px;width:760px;height:460px;background:#fff;border-radius:14px;box-shadow:0 20px 60px #0006">
    <div style="height:44px;background:#eee;border-radius:14px 14px 0 0"></div>
    <div style="padding:32px;color:#222">${label}</div></div>
  <div style="position:absolute;left:390px;bottom:18px;width:500px;height:70px;background:#fff8;border-radius:22px"></div></body></html>`;

const vite = spawn("pnpm", ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/computer-thumbnail.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}),
  });
  const shots = {};
  const maker = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  for (const [key, label, from, to] of [["cloud", "Cloud computer: Scout", "#2b6cb0", "#63b3ed"], ["vm", "Local VM: Echo", "#2f855a", "#9ae6b4"], ["local", "This Mac", "#9b2c2c", "#feb2b2"]]) {
    await maker.setContent(desktop(label, from, to));
    shots[key] = await maker.screenshot({ type: "png" });
  }
  await maker.close();
  const now = Date.now();
  // Scout's cloud: fresh, its Mac too. Echo's VM: an hour old. Pepper's Mac: none yet.
  const at = { "scout:cloud": now - 20_000, "scout:local": now - 5_000, "echo:vm": now - 60 * 60_000, "pepper:cloud": now - 8_000 };

  for (const skin of skins) {
    const page = await browser.newPage({ viewport: { width: 420, height: 860 }, deviceScaleFactor: 2 });
    page.on("pageerror", (error) => console.error("page error:", error.stack));
    // The newest route wins: the catch-all first, the thumbnail after.
    await page.route("**/api/**", (route) => route.fulfill({ status: 404, json: {} }));
    // The cloud computer's status: Luna's is stopped, the others run.
    await page.route("**/api/bots/*/computer", (route) => {
      const botId = new URL(route.request().url()).pathname.split("/")[3];
      return route.fulfill({ json: { configured: true, box: { state: botId === "luna" ? "stopped" : "running" } } });
    });
    await page.route("**/api/bots/*/computer/thumbnail?*", (route) => {
      const url = new URL(route.request().url());
      const botId = url.pathname.split("/")[3];
      const computer = url.searchParams.get("computer");
      const time = at[`${botId}:${computer}`] ?? null;
      if (url.searchParams.get("format") === "json") return route.fulfill({ json: { computer, at: time, mime: time ? "image/png" : null } });
      if (!time) return route.fulfill({ status: 404, json: { code: "no_thumbnail" } });
      return route.fulfill({ status: 200, contentType: "image/png", body: shots[computer], headers: { "x-captured-at": String(time) } });
    });
    await page.goto(`${base}?skin=${skin.id}&lang=en`, { waitUntil: "load" });
    await page.waitForSelector("[data-computer-thumb='screen']");
    await page.waitForTimeout(800);
    const save = async (name) => {
      const file = join(outDir, `${name}-${skin.label}.png`);
      await page.screenshot({ path: file });
      console.log(file);
    };
    await save("rows");
    // Scout moves from its cloud computer to this Mac: another picture.
    await page.locator("[data-gallery-row='fresh'] [data-computer-card]").click({ button: "right" });
    await page.locator("[data-computer-card-option='local']").click();
    await page.waitForTimeout(600);
    await save("switched");
    await page.locator("[data-gallery-row='fresh'] [data-computer-thumb]").click();
    await page.waitForSelector("[data-computer-thumb-full]");
    await page.setViewportSize({ width: 1100, height: 760 });
    await page.waitForFunction(() => {
      const img = document.querySelector("[data-computer-thumb-full]");
      return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0;
    });
    await page.waitForTimeout(1200);
    await save("preview");
    await page.close();

    // The desktop app on a Mac where Screen Recording is not allowed.
    const app = await browser.newPage({ viewport: { width: 420, height: 860 }, deviceScaleFactor: 2 });
    app.on("pageerror", (error) => console.error("page error:", error.stack));
    await app.addInitScript(() => {
      Object.defineProperty(navigator, "platform", { get: () => "MacIntel" });
      window.ogb = {
        platform: "darwin",
        screenFrame: async () => null,
        screenThumbnail: async () => null,
        permStatus: async () => ({ mic: "granted", screen: "denied", host: "Studio-Mac" }),
        permOpenSettings: async () => {},
      };
    });
    await app.route("**/api/**", (route) => route.fulfill({ status: 404, json: {} }));
    await app.goto(`${base}?skin=${skin.id}&lang=en`, { waitUntil: "load" });
    await app.waitForSelector("[data-gallery-row='none'] [data-computer-problem='permission']");
    await app.waitForTimeout(600);
    const file = join(outDir, `permission-${skin.label}.png`);
    await app.screenshot({ path: file });
    console.log(file);
    await app.locator("[data-gallery-row='none'] [data-computer-thumb]").click();
    await app.setViewportSize({ width: 1100, height: 760 });
    await app.waitForSelector("[data-local-live-error='permission']", { timeout: 15_000 });
    await app.waitForTimeout(800);
    const live = join(outDir, `live-permission-${skin.label}.png`);
    await app.screenshot({ path: live });
    console.log(live);
    await app.close();
  }
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (log) console.error(log.slice(-4000));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* gone */ }
}
