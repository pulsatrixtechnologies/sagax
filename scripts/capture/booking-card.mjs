#!/usr/bin/env node
/**
 * Headless screenshots of the Book a call card (shared/widget-booking.ts): the
 * card as offered, with another day picked, and booked, beside a neighbour
 * widget of the same gallery (the Book a call form), light and dark, English and
 * French, at 1280 and 390 wide. The clock is held at Monday 9 November 2026,
 * 14:50 in Toronto. Headless Chromium only.
 * Usage: node scripts/capture/booking-card.mjs [--out DIR] [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "booking-card"));
const port = Number(arg("--port") ?? 5186);
const skins = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];
const langs = ["en", "fr"];
const widths = [1280, 390];

const vite = spawn("pnpm", ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, detached: true,
});
let log = "";
vite.stdout?.on("data", (c) => { log += c; });
vite.stderr?.on("data", (c) => { log += c; });
let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/chat-widgets.html`;
  for (const start = Date.now(); ; await new Promise((d) => setTimeout(d, 500))) {
    try { if ((await fetch(base)).status < 500) break; } catch { /* retry */ }
    if (Date.now() - start > 180_000) throw new Error("gallery did not start");
  }
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  const png = async (file) => `data:image/png;base64,${(await readFile(file)).toString("base64")}`;
  for (const { id, label } of skins) for (const lang of langs) for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2, timezoneId: "America/Toronto", locale: lang === "fr" ? "fr-CA" : "en-CA" });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date("2026-11-09T19:50:00Z"));
    const tag = `${label}-${lang}-${width}`;
    const open = async (query) => {
      await page.goto(`${base}?skin=${id}&lang=${lang}&${query}${width < 600 ? "&narrow=1" : ""}`, { waitUntil: "load" });
      await page.waitForSelector("[data-widget]", { timeout: 30_000 });
      await page.waitForTimeout(500);
      return page.locator("[data-widget]").first();
    };
    const card = await open("only=bookingCard");
    const offered = join(outDir, `booking-offered-${tag}.png`);
    await card.screenshot({ path: offered });
    await page.locator('[role="radio"]').nth(1).click();
    await card.screenshot({ path: join(outDir, `booking-day-picked-${tag}.png`) });
    const pending = join(outDir, `booking-pending-${tag}.png`);
    await (await open("only=bookingCard&booked=2&bookstate=pending")).screenshot({ path: pending });
    const booked = join(outDir, `booking-booked-${tag}.png`);
    await (await open("only=bookingCard&booked=2")).screenshot({ path: booked });
    const failed = join(outDir, `booking-failed-${tag}.png`);
    await (await open("only=bookingCard&booked=2&bookstate=failed")).screenshot({ path: failed });
    const check = join(outDir, `booking-check-calendar-${tag}.png`);
    await (await open("only=bookingCard&booked=2&bookstate=check")).screenshot({ path: check });
    const neighbour = join(outDir, `neighbour-form-${tag}.png`);
    await (await open("only=bookCall")).screenshot({ path: neighbour });
    const [a, b, c, d] = await Promise.all([neighbour, pending, failed, check].map(png));
    const flex = width < 600 ? "column" : "row";
    const html = `<body style="margin:0;display:flex;flex-direction:${flex};flex-wrap:wrap;gap:16px;padding:16px;background:#888;align-items:flex-start"><img src="${a}" style="width:${width < 600 ? 358 : 400}px"><img src="${b}" style="width:${width < 600 ? 358 : 400}px"><img src="${c}" style="width:${width < 600 ? 358 : 400}px"><img src="${d}" style="width:${width < 600 ? 358 : 400}px"></body>`;
    const tmp = join(outDir, "_side.html");
    await writeFile(tmp, html);
    await page.setViewportSize({ width: width < 600 ? 390 : 1280, height: 600 });
    await page.goto(`file://${tmp}`);
    await page.screenshot({ path: join(outDir, `side-by-side-${tag}.png`), fullPage: true });
    await context.close();
    console.log(`${tag}: ok`);
  }
} catch (error) {
  console.error(String(error), log.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* gone */ }
}
