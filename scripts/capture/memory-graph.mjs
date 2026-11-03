#!/usr/bin/env node
/**
 * Headless screenshots and a perf check of Tools > Memory > Map > Graph
 * (2026-11-03): src/gallery/memory-graph.html, light and dark, at 1440 x 900:
 * the graph at rest, a hovered hub (its neighbours lit, the rest dimmed),
 * the Graph settings card open, and zoomed in (the labels faded in). Then
 * 1,200 notes: the frame times while it moves and how long it takes to rest.
 * Headless Chromium only: no window opens.
 * Usage: node scripts/capture/memory-graph.mjs [--out DIR] [--port N] [--n 360] [--perf 1200]
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "memory-graph"));
const port = Number(arg("--port") ?? 5343);
const notes = Number(arg("--n") ?? 360);
const perfNotes = Number(arg("--perf") ?? 1200);
const skins = [{ id: "pulsatrix-light", label: "light" }, { id: "pulsatrix", label: "dark" }];

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

const settledSel = '[data-memory-graph][data-settled]';
const hubIds = ["mine", "org", "bot:atlas", "bot:nova", "team:ops"].map((tier) => `n:${tier}|0`);

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/memory-graph.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const chromePath = process.env.SAGAX_VERIFY_BROWSER_CHROME
    || (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined);
  browser = await chromium.launch({ headless: true, ...(chromePath ? { executablePath: chromePath } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const open = async (query) => {
    await page.goto(`${base}?${new URLSearchParams({ width: "1440", height: "900", ...query })}`, { waitUntil: "load" });
    await page.waitForSelector("[data-memory-graph]");
    await page.waitForSelector(settledSel, { timeout: 60_000 });
    await page.waitForTimeout(500);
  };
  const hub = () => page.evaluate((ids) => {
    const c = document.querySelector('[data-testid="memory-graph-canvas"]');
    const box = c.getBoundingClientRect();
    for (const id of ids) {
      const at = c.pxGraphNode(id);
      if (at && at.x > 40 && at.y > 40 && at.x < box.width - 300 && at.y < box.height - 160) return { x: box.left + at.x, y: box.top + at.y };
    }
    return null;
  }, hubIds);
  for (const { id, label } of skins) {
    await open({ skin: id, n: String(notes) });
    await page.screenshot({ path: join(outDir, `graph-${label}.png`) });
    const at = await hub();
    if (at) {
      await page.mouse.move(at.x, at.y);
      await page.waitForTimeout(450);
      await page.screenshot({ path: join(outDir, `graph-hover-${label}.png`) });
      await page.mouse.move(5, 5);
    }
    // Zoomed in: the labels have faded in.
    const box = await page.locator('[data-testid="memory-graph-canvas"]').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let k = 0; k < 6; k++) { await page.mouse.wheel(0, -160); await page.waitForTimeout(40); }
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(outDir, `graph-zoom-${label}.png`) });
    await open({ skin: id, n: String(notes), settings: "1" });
    await page.screenshot({ path: join(outDir, `graph-settings-${label}.png`) });
  }

  // Perf: 1,200 notes, frame times measured by the page while the graph moves.
  await page.goto(`${base}?${new URLSearchParams({ skin: "pulsatrix", n: String(perfNotes), width: "1440", height: "900" })}`, { waitUntil: "load" });
  await page.waitForSelector("[data-memory-graph]");
  const frames = await page.evaluate(() => new Promise((done) => {
    const out = [];
    let last = performance.now();
    const t0 = last;
    const step = (now) => {
      out.push(now - last);
      last = now;
      if (now - t0 < 3000) requestAnimationFrame(step); else done(out);
    };
    requestAnimationFrame(step);
  }));
  await page.waitForSelector(settledSel, { timeout: 60_000 });
  const stats = await page.evaluate(() => document.querySelector('[data-testid="memory-graph-canvas"]').pxGraphStats());
  // A hover after rest: one redraw, then the loop sleeps again.
  const before = stats.frames;
  await page.mouse.move(720, 450);
  await page.waitForTimeout(800);
  const afterHover = await page.evaluate(() => document.querySelector('[data-testid="memory-graph-canvas"]').pxGraphStats().frames);
  await page.waitForTimeout(1500);
  const idle = await page.evaluate(() => document.querySelector('[data-testid="memory-graph-canvas"]').pxGraphStats().frames);
  const sorted = [...frames].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  const perf = {
    notes: perfNotes,
    nodes: stats.nodes,
    links: stats.links,
    frameMsMean: Number((frames.reduce((a, b) => a + b, 0) / frames.length).toFixed(2)),
    frameMsP95: Number(pct(0.95).toFixed(2)),
    frameMsMax: Number(sorted[sorted.length - 1].toFixed(2)),
    drawMsMean: Number(stats.drawMs.toFixed(2)),
    drawMsP95: Number(stats.drawP95.toFixed(2)),
    tickMsMean: Number(stats.tickMs.toFixed(2)),
    ticks: stats.ticks,
    settleMs: Math.round(stats.settledMs),
    framesAfterHover: afterHover - before,
    framesWhileIdle1500ms: idle - afterHover,
  };
  await writeFile(join(outDir, "perf.json"), `${JSON.stringify(perf, null, 2)}\n`);
  console.log(JSON.stringify(perf, null, 2));
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  if (log) console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* already gone */ }
}
