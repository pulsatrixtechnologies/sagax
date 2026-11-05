#!/usr/bin/env node
/**
 * Headless screenshots of the bot panel's Library tab (src/gallery/library-tab.html),
 * light and dark: every row with its mini preview, and Older after "Show more".
 * The page's thumbnail requests (/api/threads/t1/files/<id>?thumb=1) are answered
 * here with the real server code (server/media/thumbnail.ts, resvg) from generated
 * pictures, so what shows is what the server route draws. Headless Chromium only.
 * Usage: node --experimental-strip-types scripts/capture/library-thumbs.mjs --out DIR [--prefix after] [--root CHECKOUT] [--port N]
 *   (--root: the checkout whose gallery to serve, e.g. a worktree of the old main for "before")
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const root = resolve(arg("--root") ?? here);
const outDir = resolve(arg("--out") ?? join(here, "docs", "screenshots", "library-thumbnails"));
const port = Number(arg("--port") ?? 5294);
const prefix = arg("--prefix") ?? "after";
const skins = [{ id: "pulsatrix-light", label: "light" }, { id: "midnight", label: "dark" }];

// A different gradient picture per file id: drawn by the real thumbnail code.
const { thumbnailFor } = await import(join(here, "server", "media", "thumbnail.ts"));
const { Resvg } = await import(join(here, "node_modules", "@resvg", "resvg-js", "index.js")).then((m) => m.default ?? m);
const palettes = ["#f97316 #db2777", "#0ea5e9 #1d4ed8", "#22c55e #0f766e", "#a855f7 #4338ca", "#eab308 #dc2626", "#14b8a6 #2563eb"];
const picture = (n, w, h) => {
  const [a, b] = palettes[n % palettes.length].split(" ");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${w * 0.7}" cy="${h * 0.35}" r="${h * 0.18}" fill="#fff" fill-opacity="0.85"/><rect x="${w * 0.1}" y="${h * 0.62}" width="${w * 0.8}" height="${h * 0.12}" rx="8" fill="#fff" fill-opacity="0.55"/></svg>`;
  return Buffer.from(new Resvg(svg, { fitTo: { mode: "original" } }).render().asPng());
};
const sources = { 6: ["image/png", picture(6, 1600, 1000)], 7: ["image/png", picture(7, 1200, 1800)], 8: ["image/png", picture(8, 1400, 900)], 9: ["image/png", picture(9, 900, 900)], 11: ["image/png", picture(11, 800, 600)], 13: ["image/png", picture(13, 1000, 700)], 15: ["image/png", picture(15, 1600, 1200)] };
let served = 0;

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
  const base = `http://127.0.0.1:${port}/src/gallery/library-tab.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  for (const { id, label } of skins) {
    const page = await browser.newPage({ viewport: { width: 420, height: 1000 }, deviceScaleFactor: 2 });
    page.on("pageerror", (error) => console.error("page error:", error.stack));
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const hit = /\/api\/threads\/t1\/files\/([0-9a-f]{24})$/.exec(url.pathname);
      if (hit && url.searchParams.get("thumb") === "1") {
        const source = sources[Number.parseInt(hit[1], 16)];
        const png = source ? await thumbnailFor(`gallery:${hit[1]}`, async () => source[1], source[0]) : null;
        if (png) { served += 1; return route.fulfill({ status: 200, contentType: "image/png", body: png }); }
        return route.fulfill({ status: 415, contentType: "application/json", body: JSON.stringify({ error: "no thumbnail" }) });
      }
      return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not in this gallery" }) });
    });
    await page.goto(`${base}?skin=${id}&lang=en`, { waitUntil: "load" });
    await page.waitForSelector("[data-library-group]");
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(outDir, `${prefix}-library-${label}.png`), fullPage: true });
    const more = page.locator("[data-library-show-more]");
    if (await more.count()) {
      await more.click();
      await page.mouse.move(410, 5);
      await page.waitForTimeout(600);
      await page.screenshot({ path: join(outDir, `${prefix}-library-show-more-${label}.png`), fullPage: true });
    }
    await page.close();
  }
  console.log(`screenshots in ${outDir}; thumbnails answered: ${served}`);
} catch (error) {
  console.error(error);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* gone */ }
}
