#!/usr/bin/env node
/**
 * Headless frames of a Heavy run's cell division (M-20261126-122), dark and
 * light, for 2, 5 and 8 experts: the chat's row magnified five times, frame
 * by frame on a clock the script steps itself, and the same row at its real
 * size once the experts are in their pile. With --mockup <file> the owner's
 * validated mock-up is stepped on the same clock and each sheet shows it
 * above the app. --measure prints what several live rows cost (frame times,
 * script, style and layout, paint) instead of capturing. Synthetic data
 * only. Real Chrome headless, DPR 2, never a window. --look adds the
 * gallery's look parameters (def=own, material=glass, mascotSkin=gold,
 * fail=2, shape=owl...) to every page, and --tag names the sheets after it.
 * Usage: node scripts/capture/heavy-division.mjs [--out DIR] [--port N] [--mockup FILE] [--counts 2,5,8] [--shape cat]
 *   [--look "material=glass"] [--tag glass] [--skins dark,light] [--measure]
 */
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "heavy-division")));
const port = Number(arg("--port", "5393"));
const mockup = arg("--mockup", "");
const counts = arg("--counts", "2,5,8").split(",").map(Number);
const shape = arg("--shape", "cat");
const measure = process.argv.includes("--measure");
const look = arg("--look", "");
const tag = arg("--tag", shape === "cat" ? "" : shape);
const extra = look ? `&${look}` : "";
const skins = [{ id: "pulsatrix", label: "dark" }, { id: "daylight", label: "light" }].filter(({ label }) => arg("--skins", "dark,light").split(",").includes(label));
const ZOOM = 5;
const FRAMES = 10;
/** One round of division at the mock-up's speed, and the pile closing up after the last. */
const ROUND_MS = (280 + 220 + 380 + 420 + 480) * 1.25;
const CLOSE_MS = 1400;

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Vite gallery did not start at ${url}`);
}

const vite = spawn(
  process.execPath,
  [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" } },
);
// drain Vite's output: a full pipe stalls the dev server mid-page
vite.stdout.resume();
vite.stderr.resume();
const base = `http://127.0.0.1:${port}/src/gallery/heavy-team.html`;
const rounds = (n) => Math.ceil(Math.log2(n));
const frameTimes = (n) => Array.from({ length: FRAMES }, (_, index) => Math.round(((rounds(n) * ROUND_MS + CLOSE_MS) * index) / (FRAMES - 1)));
const dataUrl = (buffer) => `data:image/png;base64,${buffer.toString("base64")}`;
/** The gallery's `photo=1` bot wears the app's icon as its own picture (an attachment the dev server does not have). */
const servePhoto = async (page) => {
  const body = await readFile(join(root, "public", "app-icon-192.png"));
  await page.route("**/api/attachments/demo-photo.png", (route) => route.fulfill({ status: 200, contentType: "image/png", body }));
};

/** The app's row, stepped from the moment its team arrives. */
async function appFrames(browser, skin, n) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 520 }, deviceScaleFactor: 2 });
  await servePhoto(page);
  // a clock only the script moves: both pages are read at the same instants
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(1000);
  await page.goto(`${base}?lang=en&skin=${skin}&case=division&shape=${shape}&n=${n}&zoom=${ZOOM}${extra}`, { waitUntil: "load" });
  for (let step = 0; step < 400 && !(await page.$("[data-gallery-planned]")); step += 1) await page.clock.runFor(25);
  await page.waitForSelector("[data-gallery-planned] [data-heavy-avatars]");
  const frames = [];
  let at = 0;
  for (const time of frameTimes(n)) {
    await page.clock.runFor(time - at);
    at = time;
    const box = await page.locator("[data-heavy-open]").boundingBox();
    frames.push(await page.screenshot({ clip: { x: Math.max(0, box.x - 12), y: box.y - 10, width: 1100, height: box.height + 20 } }));
  }
  // a character or a photo ends as its own pile (D-20261126-037), a shape as its cells
  const cells = (await page.$("[data-heavy-character-pile]")) ? String(await page.locator("[data-heavy-character-pile] [data-heavy-owl]").count()) : await page.getAttribute("[data-heavy-division]", "data-heavy-cells");
  if (Number(cells) !== n) throw new Error(`${n} experts (${skin}): the row ends with ${cells} cells`);
  await page.close();
  return frames;
}

/** The mock-up's magnified row, stepped from the moment it knows how many experts it needs. */
async function mockupFrames(browser, scheme, n) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme });
  // a clock only the script moves: both pages are read at the same instants
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(1000);
  // the mock-up's web font is not needed for its magnified row, and a capture never waits on the network
  await page.route(/^https?:/, (route) => route.abort());
  await page.goto(pathToFileURL(resolve(mockup)).href, { waitUntil: "domcontentloaded" });
  await page.evaluate((count) => {
    document.getElementById("n").value = String(count);
    document.getElementById("go").click();
  }, n);
  // its own "analysing the request" wait, at its speed
  await page.clock.runFor(900 * 1.25);
  const frames = [];
  let at = 0;
  for (const time of frameTimes(n)) {
    await page.clock.runFor(time - at);
    at = time;
    const box = await page.locator(".zoom").boundingBox();
    frames.push(await page.screenshot({ clip: { x: box.x, y: box.y, width: Math.min(box.width, 1100), height: box.height } }));
  }
  await page.close();
  return frames;
}

/** The finished row at its real size, as the chat shows it. */
async function restRow(browser, skin, n) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 520 }, deviceScaleFactor: 2 });
  await servePhoto(page);
  // the dev server sometimes drops the shape's still on a first load: one more load then
  for (let attempt = 0; ; attempt += 1) {
    await page.goto(`${base}?lang=en&skin=${skin}&case=done&shape=${shape}&n=${n}${extra}`, { waitUntil: "networkidle" });
    try {
      await page.waitForSelector("[data-heavy-owl], [data-heavy-division][data-heavy-cells]", { timeout: 10_000 });
      // a material's stills come in a few frames after the cells
      if (look.includes("material=")) await page.waitForSelector("[data-heavy-cell] image", { timeout: 10_000 });
      break;
    } catch (error) {
      if (attempt) throw error;
    }
  }
  const box = await page.locator("[data-heavy-open]").boundingBox();
  const shot = await page.screenshot({ clip: { x: Math.max(0, box.x - 12), y: box.y - 10, width: 620, height: box.height + 20 } });
  await page.close();
  return shot;
}

async function sheet(browser, { n, label, times, app, mock, rest }) {
  const page = await browser.newPage({ viewport: { width: 1180, height: 800 }, deviceScaleFactor: 2 });
  const dark = label === "dark";
  const rows = times.map((time, index) => `
    <section><h2>${(time / 1000).toFixed(2)} s</h2>
      ${mock ? `<figure><figcaption>Mock-up</figcaption><img src="${dataUrl(mock[index])}" style="width:${Math.round(550)}px"></figure>` : ""}
      <figure><figcaption>App</figcaption><img src="${dataUrl(app[index])}" style="width:550px"></figure>
    </section>`).join("");
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; padding: 20px; background: ${dark ? "#0b0b0b" : "#f4f4f4"}; color: ${dark ? "#d8d8d8" : "#222"}; font: 13px system-ui, sans-serif; }
    h1 { font-size: 16px; margin: 0 0 12px; } h2 { font-size: 12px; margin: 0; width: 60px; flex: none; }
    section { display: flex; gap: 12px; align-items: center; padding: 6px 0; border-top: 1px solid ${dark ? "#2a2a2a" : "#ddd"}; }
    figure { margin: 0; display: flex; flex-direction: column; gap: 2px; } figcaption { font-size: 11px; opacity: .7; } img { display: block; }
  </style><h1>Heavy division, ${n} experts, ${label}${tag ? `, ${tag}` : ""}: the row at ${ZOOM}x${mock ? ", the mock-up beside the app" : ""}</h1>${rows}
  <section><h2>Real size</h2><figure><figcaption>App, the run over</figcaption><img src="${dataUrl(rest)}" style="width:620px"></figure></section>`);
  const file = join(outDir, `heavy-division-${tag ? `${tag}-` : ""}${n}-${label}.png`);
  await page.screenshot({ path: file, fullPage: true });
  await page.close();
  return file;
}

/** What several live rows cost: a trace of five seconds of the division and of the breathing pile after it. */
async function cost(browser) {
  for (const rowsShown of [1, 6]) {
    for (const phase of ["over", "dividing", "breathing"]) {
      // tall enough for six rows and their previews: a row off the screen stops, and would cost nothing
      const page = await browser.newPage({ viewport: { width: 1280, height: 2000 }, deviceScaleFactor: 2 });
      const client = await page.context().newCDPSession(page);
      await page.goto(`${base}?lang=en&skin=pulsatrix&case=${phase === "over" ? "done" : "division"}&shape=${shape}&n=8&rows=${rowsShown}`, { waitUntil: "load" });
      await page.waitForSelector(phase === "over" ? "[data-heavy-cells]" : "[data-gallery-planned]");
      if (phase === "breathing") await page.waitForFunction(() => [...document.querySelectorAll("[data-heavy-division]")].every((node) => node.getAttribute("data-heavy-division") === "live"), null, { timeout: 30_000 });
      await page.evaluate(() => {
        window.__frames = [];
        let last = performance.now();
        const tick = (now) => {
          window.__frames.push(now - last);
          last = now;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      await client.send("Performance.enable");
      const read = async () => Object.fromEntries((await client.send("Performance.getMetrics")).metrics.map((metric) => [metric.name, metric.value]));
      const before = await read();
      const seconds = 5;
      await page.waitForTimeout(seconds * 1000);
      const after = await read();
      const frames = (await page.evaluate(() => window.__frames)).slice(2).sort((a, b) => a - b);
      const ms = (name) => (((after[name] - before[name]) * 1000) / seconds).toFixed(1);
      console.log(`${rowsShown} row(s), 8 experts, ${phase}: per second of wall time, script ${ms("ScriptDuration")} ms, style ${ms("RecalcStyleDuration")} ms, layout ${ms("LayoutDuration")} ms, main thread ${ms("TaskDuration")} ms`
        + `; frames ${frames.length} in ${seconds} s, median ${frames[Math.floor(frames.length / 2)]?.toFixed(1)} ms, p95 ${frames[Math.floor(frames.length * 0.95)]?.toFixed(1)} ms, longest ${frames.at(-1)?.toFixed(1)} ms`);
      await page.close();
    }
  }
  // a row that left the screen asks for no frame
  const page = await browser.newPage({ viewport: { width: 1280, height: 2000 }, deviceScaleFactor: 2 });
  await page.addInitScript(() => {
    window.__asked = 0;
    const ask = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      window.__asked += 1;
      return ask(callback);
    };
  });
  await page.goto(`${base}?lang=en&skin=pulsatrix&case=division&shape=${shape}&n=8&rows=6`, { waitUntil: "load" });
  await page.waitForSelector("[data-gallery-planned]");
  const count = async () => {
    const start = await page.evaluate(() => window.__asked);
    await page.waitForTimeout(2000);
    return (await page.evaluate(() => window.__asked)) - start;
  };
  const shown = await count();
  await page.evaluate(() => { document.querySelector("[data-gallery-rows]").style.marginTop = "4000px"; });
  await page.waitForTimeout(300);
  const away = await count();
  console.log(`6 rows on screen ask for ${shown} frames in 2 s; scrolled off the screen, ${away}`);
  await page.close();
}

let browser;
try {
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  browser = await chromium.launch({ channel: "chrome", headless: true });
  if (measure) await cost(browser);
  else {
    await mkdir(outDir, { recursive: true });
    for (const { id, label } of skins) {
      for (const n of counts) {
        const app = await appFrames(browser, id, n);
        const mock = mockup ? await mockupFrames(browser, label, n) : null;
        const rest = await restRow(browser, id, n);
        console.log(await sheet(browser, { n, label, times: frameTimes(n), app, mock, rest }));
      }
    }
  }
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
