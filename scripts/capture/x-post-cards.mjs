#!/usr/bin/env node
/**
 * Headless screenshots of the two X cards (src/gallery/x-post-cards.html, #4638):
 * the draft, edited near the limit (the counter), over it, sending, failed,
 * posted, one post with a quote and a photo, a timeline of three, and the
 * draft beside the email draft card (the conforming neighbour). Dark and light,
 * French and English, a 1280 px window and a 390 px one. Synthetic data only.
 * Headless Chrome: no window opens.
 * Usage: node scripts/capture/x-post-cards.mjs [--out DIR] [--port N] [--attach N]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "x-post-cards"));
async function freePort() {
  for (let candidate = 5176; candidate <= 5189; candidate += 1) {
    if (candidate === 5185) continue;
    const free = await new Promise((done) => {
      const probe = createServer().once("error", () => done(false)).once("listening", () => probe.close(() => done(true)));
      probe.listen(candidate, "127.0.0.1");
    });
    if (free) return candidate;
  }
  throw new Error("no free port in 5176-5184 or 5186-5189");
}
const attach = arg("--attach");
const port = Number(attach ?? arg("--port") ?? await freePort());
const skins = [{ id: "pulsatrix", label: "dark" }, { id: "daylight", label: "light" }];
const langs = ["fr", "en"];
const widths = [1280, 390];
const scenes = ["draft", "near", "over", "sending", "failed", "posted", "single", "timeline", "neighbour"];

async function waitForServer(url, ms = 180_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const vite = attach ? null : spawn("pnpm", ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, detached: true,
});
if (vite) console.log(`vite pid ${vite.pid} port ${port}`);
let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/x-post-cards.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  // X serves its own pictures: the capture answers that host with a flat image
  const PHOTO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5eead4"/><stop offset="1" stop-color="#2563eb"/></linearGradient></defs><rect width="160" height="90" fill="url(#g)"/></svg>`;
  for (const width of widths) {
    const page = await browser.newPage({ viewport: { width, height: width > 600 ? 900 : 844 }, deviceScaleFactor: 2 });
    await page.route("https://pbs.twimg.com/**", (route) => route.fulfill({ contentType: "image/svg+xml", body: PHOTO }));
    page.on("pageerror", (error) => console.error("page error:", String(error).slice(0, 400)));
    page.on("console", (message) => { if (message.type() === "error") console.error("console:", message.text().slice(0, 300)); });
    for (const lang of langs) {
      for (const { id, label } of skins) {
        for (const scene of scenes) {
          await page.goto(`${base}?${new URLSearchParams({ skin: id, lang, scene })}`);
          await page.waitForSelector("[data-x-draft], [data-x-posts]", { timeout: 120_000 });
          await page.waitForTimeout(500);
          await page.screenshot({ path: join(outDir, `${scene}-${lang}-${label}-${width}.png`), fullPage: true });
        }
      }
    }
    await page.close();
  }
  console.log(`captures in ${outDir}`);
} finally {
  await browser?.close();
  if (vite?.pid) { try { process.kill(-vite.pid, "SIGTERM"); } catch { /* gone */ } }
}
