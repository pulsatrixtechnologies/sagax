#!/usr/bin/env node
/**
 * Headless frame capture of a routine run's card flipping status fast (JC,
 * 0.8.35: "the app flashes"): src/gallery/routine-status-flash.html, a burst
 * of status changes 20 to 100 ms apart, a screenshot and the card's geometry
 * every 30 ms (CDP screencast frames, one kept per 30 ms). Writes frame-NNN.png and frames.json (per frame: status shown,
 * card and bubble heights, the transcript's first row top, whether the card
 * and the bubble are the same nodes as at the start).
 * Headless Chromium only: no window opens.
 * Usage: node scripts/capture/routine-status-flash.mjs [--out DIR] [--port N] [--skin ID]
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "routine-status-flash"));
const port = Number(arg("--port") ?? 5347);
const skin = arg("--skin") ?? "pulsatrix-light";
const burst = ["queued", "running", "completed", "running", "completed", "queued", "running", "waiting", "running", "completed"];
const gaps = [20, 60, 100, 40, 30];

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const viteBin = join(root, "node_modules", "vite", "bin", "vite.js");
const vite = spawn(process.execPath, [viteBin, "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" },
  detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/routine-status-flash.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const executablePath = process.env.SAGAX_VERIFY_BROWSER_CHROME;
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error?.stack ?? error).slice(0, 1200)));
  page.on("console", (message) => { if (message.type() === "error") pageErrors.push(message.text().slice(0, 400)); });
  await page.goto(`${base}?${new URLSearchParams({ skin, width: "1100", height: "760" })}`, { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.__setRunStatus === "function" && document.querySelector("section[aria-label*='routine run']"));
  await page.waitForTimeout(600);
  // every painted frame (CDP screencast), kept one per 30 ms
  const cdp = await page.context().newCDPSession(page);
  const painted = [];
  cdp.on("Page.screencastFrame", async (frame) => {
    painted.push({ ms: frame.metadata.timestamp * 1000, data: frame.data });
    await cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1, maxWidth: 1100, maxHeight: 760 });
  await page.waitForTimeout(150);
  // the start: mark the card and its bubble, then sample every 30 ms in the page
  await page.evaluate(({ burst, gaps }) => {
    const card = () => document.querySelector("section[aria-label*='routine run']");
    const first = card();
    const firstBubble = first?.firstElementChild ?? null;
    const firstRow = document.querySelector("[data-gallery-transcript] > div");
    const samples = [];
    const t0 = performance.now();
    const sample = () => {
      const now = card();
      // #3581: the run's one form (the live row, then the result card)
      const bubble = now?.firstElementChild ?? null;
      samples.push({
        t: Math.round(performance.now() - t0),
        status: now?.querySelector("[aria-live]")?.textContent ?? "",
        cardHeight: now ? Math.round(now.getBoundingClientRect().height) : null,
        bubbleHeight: bubble ? Math.round(bubble.getBoundingClientRect().height) : null,
        firstRowTop: firstRow ? Math.round(firstRow.getBoundingClientRect().top) : null,
        sameCard: now === first,
        sameBubble: bubble === firstBubble,
        spinner: Boolean(now?.querySelector(".animate-spin")),
      });
    };
    window.__samples = samples;
    window.__sampler = setInterval(sample, 30);
    let at = 0;
    burst.forEach((status, index) => {
      at += gaps[index % gaps.length];
      setTimeout(() => window.__setRunStatus(status), at);
    });
    window.__burstEnd = at;
  }, { burst, gaps });
  await page.waitForTimeout(1_400);
  await cdp.send("Page.stopScreencast").catch(() => {});
  const shots = [];
  if (painted.length) {
    const t0 = painted[0].ms;
    let next = 0;
    for (const frame of painted) {
      if (frame.ms - t0 < next) continue;
      const name = `frame-${String(shots.length).padStart(3, "0")}.png`;
      await writeFile(join(outDir, name), Buffer.from(frame.data, "base64"));
      shots.push({ name, ms: Math.round(frame.ms - t0) });
      next = Math.floor((frame.ms - t0) / 30) * 30 + 30;
    }
  }
  const samples = await page.evaluate(() => { clearInterval(window.__sampler); return window.__samples; });
  const heights = [...new Set(samples.map((sample) => sample.bubbleHeight))];
  const tops = [...new Set(samples.map((sample) => sample.firstRowTop))];
  let statusChanges = 0;
  for (let i = 1; i < samples.length; i++) if (samples[i].status !== samples[i - 1].status) statusChanges++;
  const summary = {
    skin,
    samples: samples.length,
    bubbleHeights: heights,
    firstRowTops: tops,
    layoutShifts: samples.filter((sample, i) => i > 0 && sample.bubbleHeight !== samples[i - 1].bubbleHeight).length,
    statusChangesSeen: statusChanges,
    cardRemounted: samples.some((sample) => !sample.sameCard),
    bubbleRemounted: samples.some((sample) => !sample.sameBubble),
    spinnerToggles: samples.filter((sample, i) => i > 0 && sample.spinner !== samples[i - 1].spinner).length,
    final: samples.at(-1),
    pageErrors,
  };
  await writeFile(join(outDir, "frames.json"), JSON.stringify({ summary, samples, shots }, null, 2));
  console.log(JSON.stringify(summary));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (log) console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* already gone */ }
}
