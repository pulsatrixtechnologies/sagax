#!/usr/bin/env node
/**
 * Headless check and captures of media links in a bot reply (Playwright,
 * Chrome channel, no window): an HLS playback link, a video file and an audio
 * clip play inline, an expired signed link and a link the media server
 * refuses say so in words, next to a reply with a bare picture. The real 1:1
 * chat (src/gallery/chat-media-links.tsx) on the gallery's own Vite; the media
 * comes from a local HTTPS test server this script starts (self-signed).
 *
 * Nothing may load before Play (checked on the media server's log), then
 * every card is played. Desktop and phone (390 px), dark and light.
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
  requests.push({ path: url.pathname });
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "range");
  res.setHeader("access-control-expose-headers", "content-range, content-length, accept-ranges");
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  if (url.pathname.startsWith("/denied/")) return res.writeHead(403).end("forbidden");
  // a readable playlist whose segments are gone
  if (url.pathname.startsWith("/broken/")) {
    if (!url.pathname.endsWith(".m3u8")) return res.writeHead(404).end();
    return res.writeHead(200, { "content-type": TYPES[".m3u8"] }).end("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:2.0,\nseg0.ts\n#EXTINF:2.0,\nseg1.ts\n#EXT-X-ENDLIST\n");
  }
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
  const shots = [
    { name: "desktop", viewport: { width: 1000, height: 2500 } },
    { name: "phone", viewport: { width: 390, height: 3200 } },
  ];
  for (const shot of shots) {
    const context = await browser.newContext({ viewport: shot.viewport, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
    const page = await context.newPage();
    for (const [skin, label] of [["midnight", "dark"], ["daylight", "light"]]) {
      const tag = `${shot.name}-${label}`;
      requests.length = 0;
      await page.goto(`${base}?skin=${skin}&lang=${lang}&media=${encodeURIComponent(mediaOrigin)}`, { waitUntil: "networkidle" });
      await page.waitForSelector("[data-chat-media]");
      await page.waitForTimeout(1500);
      // nothing but the picture loads before a Play press
      const early = requests.filter((r) => r.path !== "/picture.png").map((r) => r.path);
      if (early.length) failures.push(`${tag}: ${early.length} media requests before Play (${early.slice(0, 4)})`);
      const facts = await page.evaluate(() => ({
        kinds: [...document.querySelectorAll("[data-chat-media]")].map((n) => n.getAttribute("data-chat-media")),
        expiredVideo: document.querySelectorAll('[data-chat-media="hls"] [data-expired="true"]').length,
        captions: [...document.querySelectorAll("[data-media-caption] a")].map((a) => a.getAttribute("href")),
        picture: document.querySelectorAll("[data-bare-image] img").length,
      }));
      console.log(tag, JSON.stringify(facts));
      if (facts.kinds.join(",") !== "hls,video,audio,hls,audio,hls") failures.push(`${tag}: kinds ${facts.kinds}`);
      if (facts.expiredVideo !== 1) failures.push(`${tag}: expired panel ${facts.expiredVideo}`);
      if (facts.captions.length !== 4) failures.push(`${tag}: captions ${facts.captions.length}`);
      if (facts.picture !== 1) failures.push(`${tag}: picture ${facts.picture}`);
      // Play every card that can play, the damaged stream and the refused clip included
      const players = page.locator("[data-chat-media]");
      for (let i = 0; i < await players.count(); i++) {
        const card = players.nth(i);
        if (await card.locator('[data-expired="true"]').count()) continue;
        await card.scrollIntoViewIfNeeded();
        const center = card.locator(".vpc-play");
        if (await center.count()) await center.click();
        else await card.locator("[data-media-audio] button").first().click();
      }
      await page.waitForFunction(() => {
        const cards = [...document.querySelectorAll("[data-chat-media]")];
        const videos = cards.map((c) => c.querySelector("video")).filter((v) => v && v.currentTime > 0.3);
        const audio = document.querySelector('[data-media-audio="playing"] audio');
        const refused = document.querySelector('[data-media-audio="expired"]');
        const broken = cards.at(-1)?.querySelector(".vpc-error:not([data-expired])");
        return videos.length === 2 && audio && audio.currentTime > 0.3 && refused && broken;
      }, null, { timeout: 30_000 }).catch(async () => {
        const states = await page.evaluate(() => [...document.querySelectorAll("[data-chat-media]")].map((c) => {
          const v = c.querySelector("video, audio");
          return `${c.getAttribute("data-chat-media")}:${v ? v.currentTime.toFixed(1) : "-"}:${c.querySelector(".vpc-error, [data-media-audio]")?.textContent?.slice(0, 30) ?? ""}`;
        }));
        failures.push(`${tag}: players did not play or settle (${states.join(" | ")})`);
      });
      await page.evaluate(() => document.querySelectorAll("video, audio").forEach((m) => { m.pause(); }));
      await page.mouse.move(0, 0);
      await page.waitForTimeout(600);
      if (!requests.some((r) => r.path.endsWith("index0.ts"))) failures.push(`${tag}: no HLS segment loaded`);
      // the phone bar: the time on one line, inside the bar
      if (shot.name === "phone") {
        const wrapped = await page.evaluate(() => [...document.querySelectorAll(".vpc-time")].filter((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size > 1;
        }).length);
        if (wrapped) failures.push(`${tag}: ${wrapped} times on two lines`);
      }
      const file = join(outDir, `chat-media-links-${lang}-${tag}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log(file);
    }
    await context.close();
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
