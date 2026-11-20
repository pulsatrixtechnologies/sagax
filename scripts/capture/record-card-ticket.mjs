#!/usr/bin/env node
/**
 * Headless screenshots of the opened ticket card (M-20261119-084), dark and
 * light: a note written in the product's Markdown with its inline images and
 * a signature, the Attachments tab, the title being changed in place, the
 * Owner menu, and the trail after a step to the ticket's company (the window
 * keeping its size). Synthetic data only (src/gallery/record-card.html, scene
 * `related`). `--phase before` asks the gallery's console to answer as the
 * console did before M-20261119-084 (`console=old`), for a build without the
 * change. Headless Chrome: no window opens, never the owner's port 5173.
 * Usage: node scripts/capture/record-card-ticket.mjs [--out DIR] [--phase before|after] [--lang en|fr]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "record-card-ticket"));
const phase = arg("--phase") === "before" ? "before" : "after";
const lang = arg("--lang") ?? "en";
const skins = [{ id: "pulsatrix", label: "dark" }, { id: "daylight", label: "light" }];

async function freePort() {
  for (let candidate = 5176; candidate <= 5206; candidate += 1) {
    const free = await new Promise((done) => {
      const probe = createServer().once("error", () => done(false)).once("listening", () => probe.close(() => done(true)));
      probe.listen(candidate, "127.0.0.1");
    });
    if (free) return candidate;
  }
  throw new Error("no free port between 5176 and 5206");
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

const vite = spawn("pnpm", ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#2563eb"/></svg>`;
const CARD = "[data-record-card] [data-record-card-body]";

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/record-card.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  for (const { id, label } of skins) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.route("https://desk.example/mark.svg", (route) => route.fulfill({ contentType: "image/svg+xml", body: MARK }));
    page.on("pageerror", (error) => console.error("page error:", String(error).slice(0, 400)));
    const shot = async (name) => {
      const path = join(outDir, `${phase}-${name}-${label}.png`);
      try { await page.screenshot({ path }); } catch { await page.waitForTimeout(1_000); await page.screenshot({ path }); }
      console.log(path);
    };
    const query = new URLSearchParams({ skin: id, lang, scene: "related", ...(phase === "before" ? { console: "old" } : {}) });
    const open = async () => {
      await page.goto(`${base}?${query}`);
      await page.waitForSelector("[data-gallery-chat] [data-record-link]", { timeout: 60_000 });
      await page.locator('[data-record-link="ticket"]').first().click();
      await page.waitForSelector(CARD, { timeout: 15_000 });
      await page.waitForSelector("[data-record-card] [role=tabpanel] li", { timeout: 15_000 });
      await page.waitForTimeout(800);
    };
    // the card's one scroller, brought to a part of the card
    const scrollTo = async (selector) => {
      await page.evaluate((target) => {
        const scroller = document.querySelector("[data-record-card] [data-record-scroll]");
        const node = document.querySelector(`[data-record-card] ${target}`);
        if (scroller && node) scroller.scrollTop += node.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 8;
      }, selector);
      await page.waitForTimeout(300);
    };

    // 1. a note with its images and its signature
    await open();
    await scrollTo("[data-record-related]");
    if (phase === "after") await page.waitForSelector('[data-record-note-image="shown"]', { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(400);
    await shot("note");

    // 2. the Attachments tab
    await page.locator("[data-record-card] [role=tab]", { hasText: /Attachments|Pièces jointes/ }).first().click();
    await page.waitForTimeout(1_000);
    if (await page.locator("[data-record-card] [data-record-related]").count()) await scrollTo("[data-record-related]");
    await shot("attachments");

    // 3. the title, changed in place (a build before the change has no field: its title as it is)
    await open();
    if (await page.locator("[data-record-card] [data-record-title]").count()) {
      await page.locator("[data-record-card] [data-record-title]").click();
      await page.locator("[data-record-card] [data-record-title-input]").fill(lang === "fr" ? "Courriel suspect : vérifier le lien avant midi" : "Suspicious email: check the link before noon");
      await page.waitForTimeout(300);
    }
    await shot("title");

    // 4. the Owner menu
    await open();
    const owner = page.locator('[data-record-card] [aria-label="Owner"], [data-record-card] [aria-label="Responsable"]').first();
    await owner.scrollIntoViewIfNeeded();
    await owner.click();
    await page.waitForSelector('[role="option"]', { timeout: 15_000 });
    await page.waitForTimeout(500);
    await shot("owner");

    // 5. a step to the ticket's company: the trail, and the same window
    await open();
    const ticketBox = await page.locator(CARD).boundingBox();
    await page.locator("[data-record-card] [data-record-company-link]").first().click();
    await page.waitForTimeout(1_200);
    const companyBox = await page.locator(CARD).boundingBox();
    console.log(`${label}: ticket ${Math.round(ticketBox.width)} x ${Math.round(ticketBox.height)}, company ${Math.round(companyBox.width)} x ${Math.round(companyBox.height)}`);
    await shot("trail");
    await context.close();
  }
  console.log(`captures in ${outDir}`);
} finally {
  await browser?.close();
  try { process.kill(-vite.pid); } catch { /* already gone */ }
  if (process.exitCode) console.error(log.slice(-2000));
}
