#!/usr/bin/env node
/**
 * Headless screenshots of record cards (src/gallery/record-card.html): every
 * kind, every state, the stacked narrow layout, the left-pane-only card, the
 * link card beside it, and live chips (hover, pinned). Dark and light, French
 * and English, a 1280 px window and a 390 px one. Synthetic data only.
 * Headless Chrome: no window opens.
 * Usage: node scripts/capture/record-hover-card.mjs [--out DIR] [--port N] [--only fr-dark]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "record-hover-card"));
// the first free port of the gallery range (5176 to 5206; other work may hold some)
async function freePort() {
  for (let candidate = 5176; candidate <= 5206; candidate += 1) {
    if (candidate === 5173) continue;
    const free = await new Promise((done) => {
      const probe = createServer().once("error", () => done(false)).once("listening", () => probe.close(() => done(true)));
      probe.listen(candidate, "127.0.0.1");
    });
    if (free) return candidate;
  }
  throw new Error("no free port between 5176 and 5206");
}
const port = Number(arg("--port") ?? await freePort());
const only = arg("--only");
const skins = [{ id: "pulsatrix", label: "dark" }, { id: "daylight", label: "light" }];
const langs = ["fr", "en"];
const widths = [1280, 600, 544, 390];
const variantScenes = ["longtitle", "fields12", "nonotes", "longnames"];
const cardScenes = ["overview", "ticket", "company", "project", "guid", "pinned", "loading", "noaccess", "unknown", "notconnected", "signin", "busy", "down", "orgask", "orgrefused", "neighbour"];
const chatScenes = [{ name: "chat-hover", action: "hover" }, { name: "chat-pinned", action: "click" }, { name: "chat-nested", action: "nested" }];

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

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/record-card.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  // the invented product's mark: the console serves an https address, the capture answers it
  const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5eead4"/><stop offset="1" stop-color="#2563eb"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#g)"/><path d="M20 42a9 9 0 0 1 1-17.9A12 12 0 0 1 44 27a8 8 0 0 1 0 15z" fill="#fff"/></svg>`;
  for (const width of widths) {
    const page = await browser.newPage({ viewport: { width, height: width > 600 ? 900 : 844 }, deviceScaleFactor: 2 });
    await page.route("https://desk.example/mark.svg", (route) => route.fulfill({ contentType: "image/svg+xml", body: MARK }));
    page.on("pageerror", (error) => console.error("page error:", String(error).slice(0, 400)));
    page.on("console", (message) => { if (message.type() === "error") console.error("console:", message.text().slice(0, 300)); });
    page.on("response", (response) => { if (response.status() >= 400) console.error("http", response.status(), response.url().slice(0, 160)); });
    for (const lang of langs) {
      for (const { id, label } of skins) {
        if (only && only !== `${lang}-${label}`) continue;
        const open = async (scene) => {
          await page.goto(`${base}?${new URLSearchParams({ skin: id, lang, scene })}`);
          await page.waitForSelector("[data-gallery-card], [data-gallery-chat]", { timeout: 120_000 });
          await page.waitForTimeout(250);
        };
        for (const scene of cardScenes) {
          if (width !== 1280 && width !== 390) continue;
          if (width < 600 && !["overview", "ticket", "company", "pinned", "noaccess"].includes(scene)) continue;
          await open(scene);
          await page.screenshot({ path: join(outDir, `${scene}-${lang}-${label}-${width}.png`), fullPage: true });
        }
        // the gate's stress variants, hovered and pinned (a pinned card scrolls inside)
        for (const scene of variantScenes) {
          for (const pin of [false, true]) {
            await page.goto(`${base}?${new URLSearchParams({ skin: id, lang, scene, ...(pin ? { pinned: "1" } : {}) })}`);
            await page.waitForSelector("[data-gallery-card]", { timeout: 120_000 });
            await page.waitForTimeout(250);
            await page.screenshot({ path: join(outDir, `g-var-${scene}-${pin ? "pinned" : "hover"}-${lang}-${label}-${width}.png`), fullPage: true });
            if (pin && width <= 600) {
              // a pinned card scrolls inside: look at it a third of the way down and at its foot
              for (const [name, at] of [["scroll35", 0.35], ["scrollend", 1]]) {
                await page.evaluate((fraction) => {
                  for (const pane of document.querySelectorAll("[data-record-panes], [data-record-pane]")) {
                    if (pane.scrollHeight > pane.clientHeight + 2) pane.scrollTop = (pane.scrollHeight - pane.clientHeight) * fraction;
                  }
                }, at);
                await page.waitForTimeout(250);
                await page.screenshot({ path: join(outDir, `g-var-${scene}-pinned-${name}-${lang}-${label}-${width}.png`), fullPage: true });
              }
            }
          }
        }
        for (const { name, action } of chatScenes) {
          await open("chat");
          const chip = page.locator('[data-record-link="ticket"]').first();
          await chip.scrollIntoViewIfNeeded();
          if (action === "hover") await chip.hover();
          else await chip.click();
          if (action === "nested") {
            await page.waitForSelector("[data-record-company-link]", { timeout: 10_000 });
            await page.locator("[data-record-company-link]").hover();
            await page.waitForTimeout(900);
          }
          await page.waitForSelector("[data-record-card] [data-record-card-body]", { timeout: 10_000 });
          await page.waitForTimeout(700);
          await page.screenshot({ path: join(outDir, `${name}-${lang}-${label}-${width}.png`) });
        }
      }
    }
    await page.close();
  }
  console.log(`captures in ${outDir}`);
} finally {
  await browser?.close();
  try { process.kill(-vite.pid); } catch { /* already gone */ }
  if (process.exitCode) console.error(log.slice(-2000));
}
