#!/usr/bin/env node
/**
 * Headless proof of the mascot turned by hand (#5384): on the bot page, a
 * shape mascot is dragged (start, middle, end), brought back, put in a state
 * with a key, light and dark, flat and glass; the same gestures are played on
 * the open-bot-avatar site's own stage, and each sequence is laid beside it.
 * Also measures what the bot page and a sidebar of twenty bots cost: the time
 * to draw and the frames a second.
 *
 * Starts its own Vite gallery server on a port of its own (never the app's
 * 5173) and stops it by its exact pid. Chrome runs headless: no window.
 *
 * Usage: node scripts/capture/mascot-turn.mjs [--out DIR] [--port N] [--measure-only LABEL] [--upstream URL|none]
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "mascot-turn")));
const port = Number(arg("--port", "5384"));
const measureLabel = arg("--measure-only", "");
const upstream = arg("--upstream", "https://dominikscholz.github.io/open-bot-avatar/");
const skins = [{ id: "pulsatrix-light", label: "light" }, { id: "pulsatrix", label: "dark" }];
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await sleep(500);
  }
  throw new Error(`gallery did not start at ${url}`);
}

const cacheDir = await mkdtemp(join(tmpdir(), "mascot-turn-vite-"));
const serve = `const { createServer } = await import(${JSON.stringify(join(root, "node_modules", "vite", "dist", "node", "index.js"))});
const server = await createServer({ configFile: "vite.gallery.config.ts", cacheDir: ${JSON.stringify(cacheDir)}, server: { host: "127.0.0.1", port: ${port}, strictPort: true } });
await server.listen(); console.log("ready");`;
const vite = spawn(process.execPath, ["--input-type=module", "-e", serve], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" } });
console.log("gallery server pid", vite.pid);
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

const gallery = (page, query) => `http://127.0.0.1:${port}/src/gallery/${page}.html?${new URLSearchParams(query)}`;
const STAGE = "[data-bot-profile-hero] [data-mascot-stage]";
const report = { webgl2: null, shots: [], cost: {}, upstream: null };

async function context(browser, { scheme = "dark", width = 1180, height = 900, reduced = false } = {}) {
  const made = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: scheme, reducedMotion: reduced ? "reduce" : "no-preference" });
  made.setDefaultTimeout(60_000);
  await made.route("**/api/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not in this gallery" }) }));
  return made;
}

/** Frames a second over two seconds, and the longest frame. */
const fps = (page) => page.evaluate(() => new Promise((done) => {
  let frames = 0;
  let longest = 0;
  let last = performance.now();
  const start = last;
  const tick = (now) => {
    frames += 1;
    longest = Math.max(longest, now - last);
    last = now;
    if (now - start < 2000) requestAnimationFrame(tick);
    else done({ fps: Math.round((frames * 1000) / (now - start)), longestFrameMs: Math.round(longest) });
  };
  requestAnimationFrame(tick);
}));

/** From the navigation to `count` mascots drawn under `scope`, ms (the page's own clock). */
const drawnMs = (page, scope, count) => page.evaluate(async ({ scope, count }) => {
  await new Promise((done) => {
    const check = () => {
      const drawn = [...document.querySelectorAll(`${scope} .shape-mascot`)];
      if (drawn.length >= count && drawn.every((el) => el.querySelector("img, svg, canvas"))) done(null);
      else requestAnimationFrame(check);
    };
    check();
  });
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  return Math.round(performance.now());
}, { scope, count });

/** The cost of the bot page (its hero mascot, the picker closed) and of a sidebar of twenty bots. Three runs each, the median kept. */
async function measure(browser) {
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const run = async (name, url, scope, count, prepare) => {
    const opens = [];
    const rates = [];
    const longest = [];
    // the server optimizes its dependencies on the first visit and reloads the page: let it settle before any timed run
    {
      const made = await context(browser);
      const page = await made.newPage();
      await page.goto(url, { waitUntil: "networkidle" }).catch(() => {});
      await sleep(4000);
      await page.goto(url, { waitUntil: "networkidle" }).catch(() => {});
      await made.close();
    }
    for (let i = 0; i < 4; i++) {
      const made = await context(browser);
      const page = await made.newPage();
      try {
        await page.goto(url, { waitUntil: "commit" });
        const ms = await drawnMs(page, scope, count);
        if (prepare) await prepare(page);
        await page.mouse.move(600, 500);
        await sleep(1200);
        const rate = await fps(page);
        // the first run warms the server's transforms: not counted
        if (i > 0) { opens.push(ms); rates.push(rate.fps); longest.push(rate.longestFrameMs); }
      } finally {
        await made.close();
      }
    }
    report.cost[name] = { openMs: median(opens), opensMs: opens, fps: median(rates), fpsRuns: rates, longestFrameMs: Math.max(...longest) };
    console.log("cost", name, JSON.stringify(report.cost[name]));
  };
  const closePicker = async (page) => { await page.keyboard.press("Escape"); await page.waitForSelector("[data-mascot-picker-popover]", { state: "detached" }).catch(() => {}); };
  await run("botPage.flat", gallery("appearance-editor", { skin: "pulsatrix", lang: "en", shape: "cup", color: "teal" }), "[data-bot-profile-hero]", 1, closePicker);
  await run("botPage.glass", gallery("appearance-editor", { skin: "pulsatrix", lang: "en", shape: "cup", color: "teal", material: "glass" }), "[data-bot-profile-hero]", 1, closePicker);
  await run("sidebar.twentyBots", gallery("app-shell-sidebar", { skin: "pulsatrix", lang: "en", shapes: "20" }), "body", 20);
}

const clipAround = async (page, selector, pad = { x: 150, top: 70, bottom: 150 }) => {
  const box = await page.locator(selector).first().boundingBox();
  return { x: Math.max(0, box.x - pad.x), y: Math.max(0, box.y - pad.top), width: box.width + 2 * pad.x, height: box.height + pad.top + pad.bottom };
};

/** One gesture sequence on a stage: at rest, mid drag, end of drag (still held), released, then a state by its key, then back to the front. */
async function sequence(page, { stage, prefix, snap }) {
  const box = await page.locator(stage).first().boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx + 220, cy + 160);
  await sleep(700);
  await snap(`${prefix}-1-rest`);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 45, cy - 12, { steps: 6 });
  await sleep(250);
  await snap(`${prefix}-2-drag-middle`);
  await page.mouse.move(cx + 110, cy - 30, { steps: 8 });
  await sleep(250);
  await snap(`${prefix}-3-drag-end`);
  await page.mouse.up();
  await page.mouse.move(cx + 220, cy + 160);
  await sleep(500);
  await snap(`${prefix}-4-released`);
  // a state by its key: working (3), a second and a half in, when its ribbons sweep
  await page.locator(stage).first().focus();
  await page.keyboard.press("3");
  await sleep(1700);
  await snap(`${prefix}-5-state-working`);
  await page.keyboard.press("5");
  await sleep(900);
  await snap(`${prefix}-6-state-blocked`);
  await page.keyboard.press("1");
  await page.keyboard.press("Home");
  await sleep(900);
  await snap(`${prefix}-7-front-again`);
}

const FRAMES = ["1-rest", "2-drag-middle", "3-drag-end", "4-released", "5-state-working", "6-state-blocked", "7-front-again"];

let browser;
try {
  await mkdir(outDir, { recursive: true });
  await waitForServer(`http://127.0.0.1:${port}/src/gallery/appearance-editor.html`);
  browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  await measure(browser);
  if (measureLabel) {
    await writeFile(join(outDir, `cost-${measureLabel}.json`), JSON.stringify(report.cost, null, 2));
  } else {
    for (const material of ["flat", "glass"]) {
      // the upstream site's own stage, the same gestures (it has no light theme)
      if (upstream !== "none") {
        const made = await context(browser);
        const page = await made.newPage();
        try {
          await page.goto(`${upstream}?${new URLSearchParams({ avatar: "mug", color: "teal", material })}`, { waitUntil: "networkidle" });
          await page.waitForSelector(".stage-view canvas");
          await sleep(1500);
          const clip = await clipAround(page, ".stage-view", { x: 20, top: 10, bottom: 60 });
          await sequence(page, { stage: ".stage-view", prefix: `upstream-${material}`, snap: async (name) => { const file = join(outDir, `${name}.png`); await page.screenshot({ path: file, clip }); report.shots.push(file); } });
          report.upstream = upstream;
        } catch (error) {
          console.error(`upstream ${material}: failed: ${error.message.split("\n")[0]}`);
          report.upstream = `failed: ${error.message.split("\n")[0]}`;
        } finally {
          await made.close();
        }
      }
      for (const skin of skins) {
        const made = await context(browser, { scheme: skin.label });
        const page = await made.newPage();
        page.on("pageerror", (error) => console.error("page error:", error.message));
        try {
          await page.goto(gallery("appearance-editor", { skin: skin.id, lang: "fr", shape: "cup", color: "teal", ...(material === "flat" ? {} : { material }) }), { waitUntil: "networkidle" });
          await page.waitForSelector("[data-mascot-picker-popover] [data-mascot-picker]");
          if (report.webgl2 === null) report.webgl2 = await page.evaluate(() => Boolean(document.createElement("canvas").getContext("webgl2")));
          await sleep(1500);
          const clip = await clipAround(page, STAGE);
          const checks = {};
          await sequence(page, {
            stage: STAGE,
            prefix: `sagax-${material}-${skin.label}`,
            snap: async (name) => {
              const file = join(outDir, `${name}.png`);
              await page.screenshot({ path: file, clip });
              report.shots.push(file);
              checks[name] = await page.evaluate((stage) => ({
                view: document.querySelector(`${stage} [data-shape]`)?.getAttribute("data-shape-view") ?? null,
                state: document.querySelector(`${stage} [data-shape]`)?.getAttribute("data-agent-state") ?? null,
                turn: document.querySelector("[data-bot-profile-hero] [data-mascot-turn]")?.getAttribute("data-mascot-turn") ?? null,
                pickerOpen: Boolean(document.querySelector("[data-mascot-picker-popover]")),
                resetShown: !(document.querySelector("[data-bot-profile-hero] [data-mascot-turn-reset]")?.hidden ?? true),
              }), STAGE);
            },
          });
          // a plain click still toggles the picker: it was open, the click closes it, the next one opens it again
          await page.locator(STAGE).first().click();
          await sleep(300);
          checks.clickCloses = !(await page.evaluate(() => Boolean(document.querySelector("[data-mascot-picker-popover]"))));
          await page.locator(STAGE).first().click();
          await page.waitForSelector("[data-mascot-picker-popover] [data-mascot-picker]");
          checks.clickOpens = true;
          report[`sagax-${material}-${skin.label}`] = checks;
        } catch (error) {
          console.error(`sagax ${material} ${skin.label}: failed: ${error.message.split("\n")[0]}`);
          process.exitCode = 1;
        } finally {
          await made.close();
        }
      }
    }

    // reduced motion: the device's setting respected (no idle life), the mascot still turns and comes back at once
    {
      const made = await context(browser, { scheme: "dark", reduced: true });
      const page = await made.newPage();
      try {
        await page.goto(gallery("appearance-editor", { skin: "pulsatrix", lang: "fr", shape: "cup", color: "teal" }), { waitUntil: "networkidle" });
        await page.waitForSelector("[data-mascot-picker-popover] [data-mascot-picker]");
        await sleep(1200);
        const clip = await clipAround(page, STAGE);
        const still = async () => {
          const a = await page.screenshot({ clip });
          await sleep(900);
          const b = await page.screenshot({ clip });
          return a.equals(b);
        };
        const restStill = await still();
        const box = await page.locator(STAGE).first().boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 - 20, { steps: 8 });
        await page.mouse.up();
        await page.mouse.move(box.x + 400, box.y + 300);
        await sleep(400);
        const file = join(outDir, "sagax-flat-dark-reduced-turned.png");
        await page.screenshot({ path: file, clip });
        report.shots.push(file);
        const turnedView = await page.evaluate((stage) => document.querySelector(`${stage} [data-shape]`)?.getAttribute("data-shape-view") ?? null, STAGE);
        await page.locator(STAGE).first().focus();
        await page.keyboard.press("Home");
        await sleep(60);
        const backAtOnce = await page.evaluate((stage) => document.querySelector(`${stage} [data-shape]`)?.getAttribute("data-shape-view") ?? null, STAGE);
        report.reducedMotion = { restStill, turnedView, viewRightAfterHome: backAtOnce };
      } catch (error) {
        console.error(`reduced motion: failed: ${error.message.split("\n")[0]}`);
        process.exitCode = 1;
      } finally {
        await made.close();
      }
    }

    // each sequence as one sheet: the upstream's row over ours
    const made = await browser.newContext({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1 });
    try {
      const page = await made.newPage();
      const image = async (name) => { try { return `<img src="data:image/png;base64,${(await readFile(join(outDir, `${name}.png`))).toString("base64")}">`; } catch { return `<div class="missing">not captured</div>`; } };
      for (const material of ["flat", "glass"]) {
        for (const skin of skins) {
          const dark = skin.label === "dark";
          const row = async (label, prefix) => `<h2>${label}</h2><div class="row">${(await Promise.all(FRAMES.map(async (frame) => `<figure>${await image(`${prefix}-${frame}`)}<figcaption>${frame.slice(2).replaceAll("-", " ")}</figcaption></figure>`))).join("")}</div>`;
          await page.setContent(`<body style="margin:0;padding:16px;width:max-content;background:${dark ? "#111" : "#eee"};font:500 14px system-ui;color:${dark ? "#eee" : "#111"}"><style>h2{font:600 16px system-ui;margin:12px 0 8px}.row{display:flex;gap:10px}figure{margin:0;display:flex;flex-direction:column;gap:6px;align-items:center}img{display:block;height:300px;width:auto;border-radius:10px}.missing{height:300px;width:220px;display:grid;place-items:center;opacity:.6}</style>${await row(`open-bot-avatar 0.5.1 site, ${material} (dark only)`, `upstream-${material}`)}${await row(`Sagax bot page, ${material}, ${skin.label}`, `sagax-${material}-${skin.label}`)}</body>`);
          const file = join(outDir, `side-by-side-${material}-${skin.label}.png`);
          await page.locator("body").screenshot({ path: file });
          report.shots.push(file);
          console.log("sheet", file);
        }
      }
    } finally {
      await made.close();
    }
    await writeFile(join(outDir, "report.json"), JSON.stringify(report, null, 2));
  }
} catch (error) {
  console.error(error);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  // stop only what this script started, by its exact pid
  if (vite.pid) { try { process.kill(vite.pid, "SIGTERM"); } catch { /* already gone */ } }
  await rm(cacheDir, { recursive: true, force: true });
}
