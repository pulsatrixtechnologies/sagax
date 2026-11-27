#!/usr/bin/env node
/**
 * Headless screenshots of the board and invoice windows (M-20261127-101,
 * M-20261127-140): the board's List (all, then the Urgent tile), the next
 * scheduling's hover, Columns, Data, a ticket opened from the board with its
 * way back; the invoice as a document, Record a payment, Payments, History,
 * and an invoice from a console that serves only its card; dark and light,
 * French and English. With `--mockup DIR`, each capture is also set beside
 * the mockup's capture of the same state (DIR/<name>.png), in
 * `side-<name>-<skin>-<lang>.png`. Synthetic data only
 * (src/gallery/record-window.html, src/lib/record-board-invoice-fixtures.ts). Headless
 * Chrome: no window opens, never the owner's port 5173.
 * Usage: node scripts/capture/record-window-board-invoice.mjs [--out DIR] [--mockup DIR] [--lang fr|en|both]
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "record-window-board-invoice"));
const mockupDir = arg("--mockup") ? resolve(arg("--mockup")) : undefined;
const langs = (arg("--lang") ?? "both") === "both" ? ["fr", "en"] : [arg("--lang")];
const skins = [{ id: "pulsatrix", label: "dark" }, { id: "daylight", label: "light" }];

async function freePort() {
  for (let candidate = 5300; candidate <= 5399; candidate += 1) {
    const free = await new Promise((done) => {
      const probe = createServer().once("error", () => done(false)).once("listening", () => probe.close(() => done(true)));
      probe.listen(candidate, "127.0.0.1");
    });
    if (free) return candidate;
  }
  throw new Error("no free port between 5300 and 5399");
}
const port = await freePort();

async function waitForServer(url, ms = 180_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const vite = spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#2563eb"/></svg>`;
const WINDOW = "[data-record-window]";

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/record-window.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const shots = [];
  for (const lang of langs) {
    for (const { id, label } of skins) {
      const context = await browser.newContext({ viewport: { width: 1320, height: 940 }, deviceScaleFactor: 2 });
      const page = await context.newPage();
      // the gallery's held time (2026-11-27 13:50 in Toronto): the ages and "today" read the same on every run
      await page.clock.setFixedTime(new Date("2026-11-27T13:50:00-05:00"));
      await page.route("https://desk.example/mark.svg", (route) => route.fulfill({ contentType: "image/svg+xml", body: MARK }));
      page.on("pageerror", (error) => console.error("page error:", String(error).slice(0, 400)));
      const shot = async (name, locator) => {
        const path = join(outDir, `${name}-${label}-${lang}.png`);
        await page.waitForTimeout(250);
        await (locator ?? page.locator(WINDOW).first()).screenshot({ path, animations: "disabled" });
        shots.push({ name, label, lang, path });
        console.log(path);
      };
      const open = async (kind, scene = "board", viewport) => {
        if (viewport) await page.setViewportSize(viewport);
        await page.goto(`${base}?${new URLSearchParams({ skin: id, lang, scene })}`);
        await page.waitForSelector(`[data-gallery-chat] [data-record-link="${kind}"]`, { timeout: 60_000 });
        await page.locator(`[data-record-link="${kind}"]`).first().click();
        await page.waitForSelector(`${WINDOW}[data-record-state="card"]`, { timeout: 15_000 });
      };
      const tab = async (name, panel) => {
        await page.locator(`[data-record-tab="${name}"]`).click();
        await page.waitForSelector(panel, { timeout: 10_000 });
      };
      await open("board");
      await page.waitForSelector("[data-ticket-row]", { timeout: 15_000 });
      await shot("board-list");
      await page.locator('[data-record-tile="urgent"]').click();
      await shot("board-list-urgent");
      await page.locator('[data-record-tile="all"]').click();
      await page.locator('[data-ticket-row="300124"] [data-ticket-next]').hover();
      await page.waitForSelector("[data-ticket-next-tip]", { timeout: 5_000 });
      await shot("board-list-hover");
      await page.mouse.move(5, 5);
      await page.locator("[data-board-owner-menu]").click();
      await shot("board-owner-menu");
      await page.locator("[data-board-owner-menu]").click();
      await tab("columns", '[data-board-tab="columns"] [data-board-columns]');
      await shot("board-columns");
      await tab("data", '[data-board-tab="data"] [data-board-data]');
      await shot("board-data");
      await tab("list", '[data-board-tab="list"] [data-ticket-row]');
      await page.locator('[data-ticket-row="300124"] [data-ticket-subject] > [data-record-ref-link]').click();
      await page.waitForSelector(`${WINDOW}[data-record-window="nimbus_desk/ticket"][data-record-state="card"]`, { timeout: 15_000 });
      await page.waitForSelector("[data-record-note]", { timeout: 15_000 });
      await shot("board-ticket");
      await open("invoice", "invoice");
      await page.waitForSelector("[data-invoice-document] [data-invoice-line]", { timeout: 15_000 });
      await shot("invoice-doc");
      await page.locator("[data-invoice-side] [data-invoice-pay]").click();
      await shot("invoice-pay");
      await page.locator("[data-invoice-payment-form] [data-record-form-submit]").locator("xpath=preceding-sibling::button").click();
      await tab("payments", '[data-invoice-tab="payments"] [data-invoice-payments]');
      await shot("invoice-payments");
      await tab("history", '[data-invoice-tab="history"] [data-invoice-event]');
      await shot("invoice-history");
      await open("invoice", "invoice-card");
      await page.waitForSelector("[data-invoice-document] [data-invoice-line]", { timeout: 15_000 });
      await shot("invoice-card");
      await open("board", "board", { width: 760, height: 900 });
      await page.waitForSelector("[data-ticket-row]", { timeout: 15_000 });
      await shot("board-narrow");
      await page.setViewportSize({ width: 1320, height: 940 });
      await context.close();
    }
  }
  // the mockup's capture beside each one, in one image
  if (mockupDir) {
    const context = await browser.newContext({ viewport: { width: 2700, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    for (const { name, label, lang, path } of shots) {
      const mock = join(mockupDir, `${name}.png`);
      if (!existsSync(mock)) continue;
      const data = async (file) => `data:image/png;base64,${(await readFile(file)).toString("base64")}`;
      await page.setContent(`<!doctype html><body style="margin:0;background:#111;display:flex;gap:24px;padding:24px;align-items:flex-start;font:14px system-ui;color:#ddd">
        <figure style="margin:0;width:1300px"><figcaption style="margin-bottom:8px">Maquette</figcaption><img style="width:1300px" src="${await data(mock)}"></figure>
        <figure style="margin:0;width:1300px"><figcaption style="margin-bottom:8px">Sagax (${label}, ${lang})</figcaption><img style="width:1300px" src="${await data(path)}"></figure></body>`);
      const side = join(outDir, `side-${name}-${label}-${lang}.png`);
      await page.screenshot({ path: side, fullPage: true });
      console.log(side);
    }
    await context.close();
  }
} catch (error) {
  console.error(String(error?.stack ?? error));
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* already gone */ }
}
