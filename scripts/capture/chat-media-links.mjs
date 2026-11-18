#!/usr/bin/env node
/**
 * Headless check and captures of media links in a bot reply (Playwright,
 * Chrome channel, no window): an HLS playback link, a video file and an audio
 * clip play inline, an expired signed link and a link the media server
 * refuses say so in words, next to a reply with a bare picture. The real 1:1
 * chat (src/gallery/chat-media-links.tsx) on the gallery's own Vite; the media
 * comes from a local HTTPS test server this script starts (self-signed).
 *
 * Usage: node scripts/capture/chat-media-links.mjs --media DIR [--out DIR] [--port N] [--media-port N] [--lang fr|en]
 * DIR holds clip.mp4, song.mp3, picture.png, hls/index.m3u8 and its segments,
 * cert.pem and key.pem (127.0.0.1). Exits 1 when an assertion fails.
 */
import { spawn } from "node:child_process";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:https";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const mediaDir = arg("--media");
if (!mediaDir) throw new Error("--media DIR is required (see the header of this script)");
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "chat-media-links")));
const port = Number(arg("--port", "5331"));
const mediaPort = Number(arg("--media-port", "5332"));
const lang = arg("--lang", "fr");

const TYPES = { ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".png": "image/png", ".m3u8": "application/vnd.apple.mpegurl", ".ts": "video/mp2t" };
const requests = [];
function fileFor(path) {
  if (path === "/picture.png") return "picture.png";
  if (path === "/demo-clip.mp4") return "clip.mp4";
  if (path === "/client-message.mp3") return "song.mp3";
  const hls = /^\/v1\/share\/recordings\/[^/]+\/([\w.-]+\.(?:m3u8|ts))$/.exec(path);
  return hls ? join("hls", hls[1]) : null;
}
const media = createServer({ cert: readFileSync(join(mediaDir, "cert.pem")), key: readFileSync(join(mediaDir, "key.pem")) }, (req, res) => {
  const url = new URL(req.url ?? "/", "https://local");
  requests.push({ path: url.pathname, cookie: req.headers.cookie ?? null });
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "range");
  res.setHeader("access-control-expose-headers", "content-range, content-length, accept-ranges");
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  if (url.pathname.startsWith("/denied/")) return res.writeHead(403).end("forbidden");
  const rel = fileFor(url.pathname);
  if (!rel) return res.writeHead(404).end();
  const file = join(mediaDir, rel);
  const size = statSync(file).size;
  const type = TYPES[extname(file)] ?? "application/octet-stream";
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(206, { "content-type": type, "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { "content-type": type, "accept-ranges": "bytes", "content-length": size });
  createReadStream(file).pipe(res);
});
await new Promise((ok) => media.listen(mediaPort, "127.0.0.1", ok));
const mediaOrigin = `https://127.0.0.1:${mediaPort}`;

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
console.log(`vite pid ${vite.pid}`);
let browser;
const failures = [];
try {
  const base = `http://127.0.0.1:${port}/src/gallery/chat-media-links.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1000, height: 2300 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
  // a Sagax-side cookie: it must never reach the media server
  await context.addCookies([{ name: "sagax-session", value: "gallery", domain: "127.0.0.1", path: "/", sameSite: "Lax" }]);
  const page = await context.newPage();
  for (const [skin, label] of [["midnight", "dark"], ["daylight", "light"]]) {
    requests.length = 0;
    await page.goto(`${base}?skin=${skin}&lang=${lang}&media=${encodeURIComponent(mediaOrigin)}`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-chat-media]");
    // every player settled: videos show a frame, the live clip is ready, the refused one says so
    await page.waitForFunction(() => {
      const videos = [...document.querySelectorAll("[data-chat-media] video")];
      const audio = document.querySelector('[data-media-audio="ready"] audio');
      // the expired card keeps an idle <video> under its panel
      return videos.filter((v) => v.readyState >= 1).length === 2 && audio && audio.readyState >= 1
        && document.querySelector('[data-media-audio="expired"]');
    }, null, { timeout: 30_000 }).catch(() => failures.push(`${label}: players did not settle`));
    await page.waitForTimeout(400);
    const facts = await page.evaluate(() => ({
      kinds: [...document.querySelectorAll("[data-chat-media]")].map((n) => n.getAttribute("data-chat-media")),
      expiredVideo: document.querySelectorAll('[data-chat-media="hls"] [data-expired="true"]').length,
      expiredAudio: document.querySelectorAll('[data-media-audio="expired"]').length,
      captions: [...document.querySelectorAll("[data-media-caption] a")].map((a) => a.getAttribute("href")),
      picture: document.querySelectorAll("[data-bare-image] img").length,
    }));
    console.log(label, JSON.stringify(facts));
    if (facts.kinds.join(",") !== "hls,video,audio,hls,audio") failures.push(`${label}: kinds ${facts.kinds}`);
    if (facts.expiredVideo !== 1 || facts.expiredAudio !== 1) failures.push(`${label}: expired panels ${facts.expiredVideo}/${facts.expiredAudio}`);
    if (facts.captions.length !== 3) failures.push(`${label}: captions ${facts.captions.length}`);
    if (facts.picture !== 1) failures.push(`${label}: picture ${facts.picture}`);
    const withCookie = requests.filter((r) => r.cookie);
    if (withCookie.length) failures.push(`${label}: a cookie reached the media server (${withCookie.map((r) => r.path)})`);
    if (!requests.some((r) => r.path.endsWith("index0.ts"))) failures.push(`${label}: no HLS segment loaded`);
    const file = join(outDir, `chat-media-links-${lang}-${label}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(file);
  }
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
  media.close();
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
