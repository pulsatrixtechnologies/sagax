#!/usr/bin/env node
/**
 * Headless captures and measures of the sidebar's shape mascots (#5404): how
 * sharp they are drawn, whether they move, and what thirty of them cost. On
 * the gallery shell (every name synthetic): a pinned tile and thirty rows of
 * bots wearing a shape, flat, in Fluffy and in Glass. Headless Chrome at a
 * device pixel ratio of 2 (a Retina screen): no window opens.
 *
 * - shots: the sidebar, and the pinned tile, a row and the chat header pill
 *   enlarged four times with no smoothing (what the screen's pixels hold),
 *   light and dark;
 * - sharpness: for every mascot, the size it is shown at (CSS px, transforms
 *   included), the pixels of its canvas, and their ratio to the screen's
 *   pixels (1 is exact; under 1 the browser enlarges a smaller image);
 * - motion: whether a mascot's drawing keeps changing over two seconds;
 * - cost: with thirty bots, the WebGL contexts made, the canvases, the
 *   mascots alive, the frames a second, and the processor time of the page
 *   and of the GPU process over five seconds, in a window of the usual
 *   height and in one tall enough to show the thirty bots at once; there,
 *   also with other numbers of seats (--seats, how many small mascots live
 *   at once, src/components/shape-alive.ts), the measure that chose the
 *   page's number.
 *
 * Usage: node scripts/capture/sidebar-mascot-quality.mjs [--out DIR] [--port N]
 *          [--prefix before|after] [--only shots|measure] [--bots N]
 *          [--seats 6,12,18,31] [--materials flat,fluffy,glass]
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "sidebar-mascot-quality")));
const port = Number(arg("--port", "5347"));
const prefix = arg("--prefix", "after");
const only = arg("--only", "");
const bots = arg("--bots", "30");
// the cost is measured twice: in a window as tall as the app's usual one, and in one tall enough to show every row
const TALL = Number(arg("--tall", "2400"));
const seatCounts = arg("--seats", "").split(",").filter(Boolean).map(Number);
const skins = [{ id: "pulsatrix-light", label: "light" }, { id: "pulsatrix", label: "dark" }];
const MATERIALS = arg("--materials", "flat,fluffy,glass").split(",");
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await sleep(500);
  }
  throw new Error(`gallery did not start at ${url}`);
}

// the gallery's Vite on a port and a dependency cache of its own
const cacheDir = await mkdtemp(join(tmpdir(), "sidebar-mascot-vite-"));
const serve = `const { createServer } = await import(${JSON.stringify(join(root, "node_modules", "vite", "dist", "node", "index.js"))});
const server = await createServer({ configFile: "vite.gallery.config.ts", cacheDir: ${JSON.stringify(cacheDir)}, server: { host: "127.0.0.1", port: ${port}, strictPort: true } });
await server.listen(); console.log("ready");`;
const vite = spawn(process.execPath, ["--input-type=module", "-e", serve], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" } });
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

const shell = (material, skin, extra = {}) =>
  `http://127.0.0.1:${port}/src/gallery/app-shell-sidebar.html?${new URLSearchParams({ shapes: bots, skin, lang: "en", ...(material === "flat" ? {} : { material }), ...extra })}`;

const TILE = "button:has([data-sidebar-tile-labels])";
const ROW = "[data-sidebar-bot-row]";

/** Every mascot of the sidebar drawn: an image, an SVG or a painted canvas in each. */
async function drawn(page) {
  await page.waitForSelector(`${TILE} .shape-mascot`, { timeout: 120_000 });
  await page.waitForFunction(() => {
    const all = [...document.querySelectorAll("aside .shape-mascot, nav .shape-mascot, .shape-mascot")];
    return all.length > 0 && all.every((el) => {
      const canvas = el.querySelector("canvas");
      return canvas ? canvas.width > 1 : el.querySelector("img, svg");
    });
  }, null, { timeout: 60_000 }).catch(() => {});
  await page.evaluate(async () => {
    const images = [...document.querySelectorAll(".shape-mascot img")];
    await Promise.all(images.map((image) => (image.complete ? null : image.decode().catch(() => null))));
  });
  await sleep(1200);
}

/** Counts the contexts the page makes, before any script of the page runs. */
const countContexts = () => {
  const w = window;
  w.__contexts = { webgl2: 0, webgl: 0, "2d": 0 };
  const get = HTMLCanvasElement.prototype.getContext;
  const seen = new WeakMap();
  HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
    const context = get.call(this, kind, ...rest);
    if (context && !seen.get(this)) {
      seen.set(this, true);
      if (kind in w.__contexts) w.__contexts[kind] += 1;
    }
    return context;
  };
};

/** One mascot's drawing: what it is, the size shown, the pixels held. */
const readMascots = () => {
  const dpr = window.devicePixelRatio;
  const one = (el, where) => {
    const mascot = el.querySelector(".shape-mascot");
    if (!mascot) return null;
    const node = mascot.querySelector("canvas") ?? mascot.querySelector("img") ?? mascot.querySelector("svg");
    if (!node) return null;
    const shown = node.getBoundingClientRect();
    const laid = node.tagName === "CANVAS" ? node.offsetWidth : node.clientWidth || shown.width;
    const pixels = node.tagName === "CANVAS" ? node.width : null;
    return {
      where,
      kind: node.tagName.toLowerCase(),
      material: mascot.getAttribute("data-shape-material"),
      live: node.tagName === "CANVAS" ? null : mascot.querySelector("[data-shape-live]") !== null,
      boxCss: Math.round(mascot.getBoundingClientRect().width * 100) / 100,
      shownCss: Math.round(shown.width * 100) / 100,
      laidOutCss: Math.round(laid * 100) / 100,
      bitmapPx: pixels,
      neededPx: Math.round(shown.width * dpr),
      // 1: one pixel of the image for one pixel of the screen; under 1 the image is enlarged
      sharpness: pixels === null ? null : Math.round((pixels / (shown.width * dpr)) * 100) / 100,
    };
  };
  const tile = document.querySelector("button:has([data-sidebar-tile-labels])");
  const row = document.querySelector("[data-sidebar-bot-row]");
  const pill = document.querySelector("[data-chat-pill]");
  return [tile && one(tile, "tile"), row && one(row, "row"), pill && one(pill, "chat-pill")].filter(Boolean);
};

/** A fingerprint of a mascot's drawing: the canvas' pixels, or the SVG's markup. */
const fingerprint = (selector) => {
  const mascot = document.querySelector(`${selector} .shape-mascot`);
  if (!mascot) return null;
  const canvas = mascot.querySelector("canvas");
  if (canvas) {
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 0;
    for (let i = 0; i < data.length; i += 7) hash = (hash * 31 + data[i]) | 0;
    return `canvas:${hash}`;
  }
  const svg = mascot.querySelector("svg");
  return svg ? `svg:${svg.innerHTML}` : `img:${mascot.querySelector("img")?.src ?? ""}`;
};

/** Whether a mascot's drawing keeps changing over two seconds (a still may be painted again once, when its row is drawn again). */
async function moves(page, selector) {
  const seen = new Set();
  for (let i = 0; i < 10; i += 1) {
    seen.add(await page.evaluate(fingerprint, selector));
    await sleep(200);
  }
  return seen.size >= 5;
}

/** A locator enlarged four times, pixel for pixel: what the screen's pixels hold. */
async function enlarged(browser, page, locator, file) {
  const buffer = await page.locator(locator).first().screenshot({ animations: "disabled" });
  const context = await browser.newContext({ deviceScaleFactor: 1 });
  try {
    const sheet = await context.newPage();
    await sheet.setContent(`<body style="margin:0;background:transparent"><img id="i" style="image-rendering:pixelated;display:block" src="data:image/png;base64,${buffer.toString("base64")}"></body>`);
    await sheet.evaluate(async () => {
      const image = document.getElementById("i");
      await image.decode();
      image.style.width = `${image.naturalWidth * 4}px`;
    });
    await sheet.locator("#i").screenshot({ path: file });
  } finally {
    await context.close();
  }
  console.log("shot", file);
}

async function shots(browser, report) {
  for (const material of MATERIALS) {
    for (const skin of skins) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2, colorScheme: skin.label });
      context.setDefaultTimeout(120_000);
      try {
        const page = await context.newPage();
        page.on("pageerror", (error) => console.error(`${material}: page error:`, error.message));
        await page.goto(shell(material, skin.id), { waitUntil: "load" });
        await drawn(page);
        const name = (part) => join(outDir, `${prefix}-${material}-${part}-${skin.label}.png`);
        await page.screenshot({ path: name("sidebar"), clip: { x: 0, y: 0, width: 300, height: 620 }, animations: "disabled" });
        console.log("shot", name("sidebar"));
        await enlarged(browser, page, `${TILE} [data-sidebar-mascot]`, name("tile-x4"));
        await enlarged(browser, page, `${ROW} [data-sidebar-mascot]`, name("row-x4"));
        if (await page.locator("[data-chat-pill] .shape-mascot").count()) await enlarged(browser, page, "[data-chat-pill] .shape-mascot", name("chat-pill-x4"));
        if (skin.label === "light") {
          report.sharpness[material] = await page.evaluate(readMascots);
          report.motion[material] = { tile: await moves(page, TILE), row: await moves(page, ROW) };
        }
      } finally {
        await context.close();
      }
    }
  }
}

async function cost(browser, report) {
  const system = await browser.newBrowserCDPSession();
  const processes = async () => Object.fromEntries((await system.send("SystemInfo.getProcessInfo")).processInfo.map((p) => [`${p.type}:${p.id}`, p.cpuTime]));
  // both skins: a light skin lays a drop shadow under every mascot (--mascot-filter), which the compositor draws again on every frame a canvas near it changes
  const cases = MATERIALS.flatMap((name) => [
    ...skins.flatMap((skin) => [[name, skin, 860, null], [name, skin, TALL, null]]),
    ...seatCounts.map((seats) => [name, skins[1], TALL, seats]),
  ]);
  for (const [material, skin, height, seats] of cases) {
    const label = `${material}-${skin.label}-${height}${seats === null ? "" : `-seats${seats}`}`;
    const runs = [];
    for (let run = 0; run < 3; run += 1) {
      const context = await browser.newContext({ viewport: { width: 1280, height }, deviceScaleFactor: 2 });
      await context.addInitScript(countContexts);
      context.setDefaultTimeout(120_000);
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send("Performance.enable");
      await page.goto(shell(material, skin.id, seats === null ? {} : { seats: String(seats) }), { waitUntil: "load" });
      await drawn(page);
      await sleep(3000);
      const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
      const [m0, p0] = [await metrics(), await processes()];
      const frames = await page.evaluate(() => new Promise((done) => {
        let count = 0;
        let longest = 0;
        let slow = 0;
        let last = performance.now();
        const start = last;
        const tick = (now) => {
          count += 1;
          longest = Math.max(longest, now - last);
          if (now - last > 34) slow += 1;
          last = now;
          if (now - start < 5000) requestAnimationFrame(tick);
          else done({ fps: Math.round((count * 1000) / (now - start)), longestFrameMs: Math.round(longest), slowFrames: slow });
        };
        requestAnimationFrame(tick);
      }));
      const [m1, p1] = [await metrics(), await processes()];
      const seconds = m1.Timestamp - m0.Timestamp;
      // every process whose time moved during the window, by type (the page's renderer, the GPU process)
      const cpu = {};
      for (const [key, time] of Object.entries(p1)) {
        const type = key.split(":")[0];
        cpu[type] = (cpu[type] ?? 0) + (time - (p0[key] ?? time));
      }
      const page1 = await page.evaluate(() => ({
        contexts: window.__contexts,
        mascots: document.querySelectorAll(".shape-mascot").length,
        canvases: document.querySelectorAll(".shape-mascot canvas").length,
        liveSvg: document.querySelectorAll(".shape-mascot [data-shape-live]").length,
        alive: document.querySelectorAll(".shape-mascot[data-shape-alive]").length,
        rows: document.querySelectorAll("[data-sidebar-bot-row]").length,
        onScreen: [...document.querySelectorAll(".shape-mascot")].filter((el) => {
          const box = el.getBoundingClientRect();
          return box.bottom > 0 && box.top < window.innerHeight && box.width > 0;
        }).length,
        renderer: (() => {
          const gl = document.createElement("canvas").getContext("webgl2");
          const info = gl?.getExtension("WEBGL_debug_renderer_info");
          const name = gl && info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl ? "webgl2" : "none";
          gl?.getExtension("WEBGL_lose_context")?.loseContext();
          return name;
        })(),
      }));
      runs.push({
        ...page1,
        ...frames,
        mainThreadPct: Math.round(((m1.TaskDuration - m0.TaskDuration) / seconds) * 1000) / 10,
        scriptPct: Math.round(((m1.ScriptDuration - m0.ScriptDuration) / seconds) * 1000) / 10,
        rendererCpuPct: Math.round(((cpu.renderer ?? 0) / seconds) * 1000) / 10,
        gpuCpuPct: Math.round(((cpu.GPU ?? 0) / seconds) * 1000) / 10,
        heapMb: Math.round((m1.JSHeapUsedSize / 1048576) * 10) / 10,
      });
      await context.close();
    }
    const median = (key) => runs.map((r) => r[key]).sort((a, b) => a - b)[1];
    report.cost[label] = {
      bots: Number(bots),
      skin: skin.label,
      windowHeight: height,
      inWindow: runs[0].onScreen,
      alive: runs[0].alive,
      mascots: runs[0].mascots,
      rows: runs[0].rows,
      canvases: runs[0].canvases,
      liveSvg: runs[0].liveSvg,
      contexts: runs[0].contexts,
      renderer: runs[0].renderer,
      fps: median("fps"),
      longestFrameMs: median("longestFrameMs"),
      slowFrames: median("slowFrames"),
      mainThreadPct: median("mainThreadPct"),
      scriptPct: median("scriptPct"),
      rendererCpuPct: median("rendererCpuPct"),
      gpuCpuPct: median("gpuCpuPct"),
      heapMb: median("heapMb"),
    };
    console.log(label, JSON.stringify(report.cost[label]));
  }
}

let browser;
try {
  await waitForServer(shell("flat", "pulsatrix-light"));
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  // a throwaway load: Vite optimizes dependencies on the first visit
  const warm = await browser.newPage();
  warm.setDefaultTimeout(300_000);
  for (const material of ["fluffy", "glass"]) {
    await warm.goto(shell(material, "pulsatrix-light"), { waitUntil: "load" });
    await warm.waitForSelector(".shape-mascot canvas", { timeout: 120_000 }).catch(() => {});
    await sleep(2500);
  }
  await warm.close();
  const report = { prefix, devicePixelRatio: 2, sharpness: {}, motion: {}, cost: {} };
  if (only !== "measure") await shots(browser, report);
  if (only !== "shots") await cost(browser, report);
  await writeFile(join(outDir, `${prefix}-measure.json`), `${JSON.stringify(report, null, 1)}\n`);
  console.log(JSON.stringify({ sharpness: report.sharpness, motion: report.motion }, null, 1));
} catch (error) {
  console.error(error);
  console.error(log.slice(-4000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
  await rm(cacheDir, { recursive: true, force: true });
}
