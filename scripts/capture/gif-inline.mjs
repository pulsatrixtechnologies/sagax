#!/usr/bin/env node
/**
 * Headless check of the inline GIF gallery (Playwright, Chrome channel, no
 * window): the person's GIF bubble must hug the media, and a bare GIF URL in
 * a bot line must render as an image (text kept above).
 * Usage: node scripts/capture/gif-inline.mjs [--out DIR] [--port N] [--mode before|after]
 * Exits 1 when an assertion fails (in "before" mode the failure is expected).
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "gif-inline")));
const port = Number(arg("--port", "5262"));
const mode = arg("--mode", "after");

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Vite gallery did not start at ${url}`);
}

const vite = spawn(
  process.execPath,
  [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" } },
);
let browser;
let failed = false;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/gif-inline.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 800, height: 700 }, deviceScaleFactor: 2 });
  // a synthetic 240x160 GIF for both the stored attachment and the giphy URL
  const big = Buffer.from("R0lGODdh8ACgAIEAAPrMFexImQAAAAAAACwAAAAA8ACgAEAI/wADCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFixgzatzIsaPHjyBDihxJsqTJkyhTqlzJsqVHADBjypxJs2ZMlzhz6iRos6fPn0B/7hxKVGLQo0iTKoVZtOnOpVCjShXqtCrJqVizagVgtSvHrWDDLvVKtqLYs2ipll37MK3bt2zjQnxLd6vcuxHr6k2Kt6/FvYD9CgYJeOrgw0PRIl7MuLHjx5AjS55MubLly5gza97MubPnzysL9wRtWfRZ0nhNi0btVLVrmqxdvp5tM3ZK2rhh2zaZuzfT3bx90wauUvhq4jmNn0beVblS5oxzQ59Ovbr169iza9/Ovbv37+DDi/8fT768+fPo0389qn7y8fZencPH6Rzo/Kv1x97fmD/rfrP9hfVfWwEqNmBCBdJ1oEEJ1rXgQA3q9WCEey1IoYQHXuhghhrCZWGHBk4IooAPQjiiViUyeGJUKSK4IlItNvTiaDHmNSNXNV7UYY4hyccjS+/9WBaMQhZp5JFIJqnkkkw26eSTUEYp5ZRUVmnllVhmqeWWXHbp5ZdghinmmGQ2hWKZGmGIpkOvrXmQcWsGKGaEXY6I5YxU3ngTlHrK5GSfNS0JaG1IDkpjkYb6hGiiivLIqH01PhpUjJKyl2Klk5aIqaUfbqrWgJ5y+l+omYJK6qf7nYrqfao2amqrgXJbCKtur87qZ6e24oirrZfm2mKuumo6a46w/qjqop4emWyhlQr66J+DRgloni/eCWKdDc7ZX5zCuamiat7KuGG4FJ1J7rnopqvuuuy26+678MYr77z01mvvvVcGBAA7", "base64");
  await page.route(/\/api\/attachments\/|giphy\.com/, (route) => route.fulfill({ status: 200, contentType: "image/gif", body: big }));
  await page.goto(`${base}?skin=pulsatrix&mode=${mode}`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-gallery] img", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(500);
  const file = join(outDir, `${mode}.png`);
  await page.locator("[data-gallery]").screenshot({ path: file });
  console.log(`wrote ${file}`);

  const mineBox = await page.locator("[data-row=mine] img").first().boundingBox();
  const mineRow = await page.locator("[data-row=mine]").boundingBox();
  const bubble = await page.locator("[data-row=mine] [data-chat-bubble], [data-row=mine] [data-who=user]").first().boundingBox();
  const botImgs = await page.locator("[data-row=bot] img").count();
  const botLink = await page.locator("[data-row=bot] a[href*='giphy.com']").count();
  const botText = await page.locator("[data-row=bot]").innerText();
  const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); if (!ok) failed = true; };
  check("user GIF renders", Boolean(mineBox));
  if (mineBox && bubble) {
    check("user bubble hugs the GIF", bubble.width <= mineBox.width + 24, `bubble ${Math.round(bubble.width)}px, gif ${Math.round(mineBox.width)}px`);
    check("user GIF flush right", mineRow.x + mineRow.width - (mineBox.x + mineBox.width) < 80, "");
  } else check("user bubble measured", false);
  check("bot bare URL renders as an image", botImgs >= 1);
  check("bot bare URL is not a plain link", botLink === 0);
  check("bot text above the GIF kept", botText.includes("little wave"));
} finally {
  await browser?.close().catch(() => {});
  vite.kill("SIGTERM");
}
process.exit(failed ? 1 : 0);
