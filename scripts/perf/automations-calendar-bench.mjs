#!/usr/bin/env node
/**
 * Headless benchmark of the Automations calendar (2026-11-02), on the fixture
 * src/gallery/automations-calendar-perf.html (production-size data, the real store
 * reducer). It builds the fixture for production with React's profiling
 * build, serves it on 127.0.0.1 and measures in headless Chromium:
 *   - first render (navigation to the first painted frame with the cards),
 *   - the time to switch Day, 3 days, Week, previous and next, and the month,
 *   - scroll frames (wheel on the grid) while live updates arrive,
 *   - long tasks over 50 ms and React commits per live run update,
 *   - the components each live update renders, and the JS heap.
 * No window opens. Writes <label>.json, a Chromium trace and screenshots.
 * Usage: node scripts/perf/automations-calendar-bench.mjs --out DIR [--label before|after] [--port N] [--ticks N] [--loads N]
 *   [--no-build] [--build-only] [--keep-build]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; };
const outDir = resolve(arg("--out", join(root, "dist-calperf-results")));
const label = arg("--label", "run");
const port = Number(arg("--port", 5311));
const ticks = Number(arg("--ticks", 20));
const loads = Number(arg("--loads", 5));
const distDir = join(root, "dist-calperf");

const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0; };
const p95 = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0; };
const round = (value) => Math.round(value * 10) / 10;

const { build, preview } = await import("vite");
const react = (await import("@vitejs/plugin-react")).default;
const tailwindcss = (await import("@tailwindcss/vite")).default;
const skipBuild = process.argv.includes("--no-build");
if (!skipBuild) await build({
  configFile: false,
  root,
  logLevel: "warn",
  publicDir: join(root, "public"),
  plugins: [react(), tailwindcss()],
  resolve: { alias: [
    { find: "@", replacement: join(root, "src") },
    // The profiling build keeps actualDuration and the DevTools commit hook.
    { find: /^react-dom\/client$/, replacement: join(root, "node_modules", "react-dom", "profiling.js") },
  ] },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: distDir, emptyOutDir: true, minify: false, target: "esnext",
    rollupOptions: { input: join(root, "src", "gallery", "automations-calendar-perf.html") },
  },
});
if (process.argv.includes("--build-only")) process.exit(0);
const server = await preview({ configFile: false, root, logLevel: "warn", build: { outDir: distDir }, preview: { host: "127.0.0.1", port, strictPort: true } });

const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
const browser = await chromium.launch({ headless: true, args: ["--enable-precise-memory-info", "--js-flags=--expose-gc"], ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
const url = `http://127.0.0.1:${port}/src/gallery/automations-calendar-perf.html?width=1440&height=900&lang=en`;

const initScript = () => {
  // A bare DevTools hook: React reports each commit to it (the fixture counts
  // the components that rendered).
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, isDisabled: false, renderers: new Map(), inject() { return 1; }, onCommitFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, onScheduleFiberRoot() {}, checkDCE() {} };
  window.__longTasks = [];
  new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__longTasks.push({ at: entry.startTime, duration: entry.duration }); }).observe({ type: "longtask", buffered: true });
  window.__firstCards = 0;
  const watch = () => {
    if (window.__firstCards) return;
    if (document.querySelector("[data-event-card]")) {
      requestAnimationFrame(() => { window.__firstCards = window.__firstCards || performance.now(); });
      return;
    }
    requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);
};

const results = { label, at: new Date().toISOString(), firstRender: {}, switches: {}, scroll: {}, live: {}, unrelated: {}, memory: {}, dom: {} };
try {
  await mkdir(outDir, { recursive: true });
  // 1. First render: fresh page loads.
  const firstRenders = [];
  const firstCommits = [];
  for (let index = 0; index < loads; index += 1) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.addInitScript(initScript);
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => window.__firstCards > 0, null, { timeout: 30_000 });
    const sample = await page.evaluate(() => ({ cards: window.__firstCards, mount: window.__calperf.commits.filter((commit) => commit.phase === "mount").reduce((sum, commit) => sum + commit.duration, 0), longest: Math.max(0, ...window.__longTasks.map((task) => task.duration)) }));
    firstRenders.push(sample.cards);
    firstCommits.push(sample.mount);
    if (index === 0) results.firstRender.longestTaskMs = round(sample.longest);
    await page.close();
  }
  results.firstRender.toFirstPaintedCardsMs = round(median(firstRenders));
  results.firstRender.mountCommitMs = round(median(firstCommits));

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (error) => console.error("page error:", error.stack));
  await page.addInitScript(initScript);
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => window.__firstCards > 0, null, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  const client = await page.context().newCDPSession(page);
  const heap = async () => {
    await client.send("HeapProfiler.collectGarbage");
    const usage = await client.send("Runtime.getHeapUsage");
    return round(usage.usedSize / 1048576);
  };
  results.memory.afterLoadMb = await heap();
  results.dom.nodes = await page.evaluate(() => document.querySelectorAll("*").length);
  results.dom.eventCards = await page.evaluate(() => document.querySelectorAll("[data-event-card]").length);
  await page.screenshot({ path: join(outDir, `${label}-week.png`) });

  await browser.startTracing(page, { path: join(outDir, `${label}-trace.json`), screenshots: false, categories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "blink.user_timing", "v8.execute"] });

  // 2. Switches: a key or a click, then the next painted frame.
  const timed = (action) => page.evaluate(async (action) => {
    const commitsBefore = window.__calperf.commits.length;
    const start = performance.now();
    if (action.key) document.body.dispatchEvent(new KeyboardEvent("keydown", { key: action.key, bubbles: true }));
    else document.querySelector(action.selector)?.click();
    await new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0)));
    const elapsed = performance.now() - start;
    const render = window.__calperf.commits.slice(commitsBefore).reduce((sum, commit) => sum + commit.duration, 0);
    return { elapsed, render };
  }, action);
  const switchActions = {
    day: { key: "1" },
    threeDays: { key: "3" },
    week: { key: "w" },
    next: { selector: "button[aria-label='Next dates']" },
    previous: { selector: "button[aria-label='Previous dates']" },
    monthNext: { selector: "button[aria-label='Next month']" },
    monthPrevious: { selector: "button[aria-label='Previous month']" },
  };
  const samples = Object.fromEntries(Object.keys(switchActions).map((name) => [name, { elapsed: [], render: [] }]));
  for (let round = 0; round < 8; round += 1) {
    for (const [name, action] of Object.entries(switchActions)) {
      if (name === "next" || name === "previous") continue;
      const sample = await timed(action);
      samples[name].elapsed.push(sample.elapsed); samples[name].render.push(sample.render);
      await page.waitForTimeout(120);
    }
    for (const name of ["next", "previous", "monthNext", "monthPrevious"]) {
      const sample = await timed(switchActions[name]);
      samples[name].elapsed.push(sample.elapsed); samples[name].render.push(sample.render);
      await page.waitForTimeout(120);
    }
  }
  for (const [name, sample] of Object.entries(samples)) {
    results.switches[name] = { medianMs: round(median(sample.elapsed)), p95Ms: round(p95(sample.elapsed)), reactRenderMedianMs: round(median(sample.render)) };
  }
  await timed({ key: "w" });

  // 3. Live updates: one run frame per second.
  await page.evaluate(() => { window.__longTasks.length = 0; window.__calperf.fiberCommits.length = 0; window.__calperf.commits.length = 0; });
  const perTick = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    const sample = await page.evaluate(async () => {
      const commitsBefore = window.__calperf.fiberCommits.length;
      const pageBefore = window.__calperf.commits.length;
      const start = performance.now();
      window.__calperf.tick();
      await new Promise((done) => setTimeout(done, 1000));
      const commits = window.__calperf.fiberCommits.slice(commitsBefore);
      const pageCommits = window.__calperf.commits.slice(pageBefore);
      const rendered = {};
      for (const commit of commits) for (const [name, count] of Object.entries(commit.rendered)) rendered[name] = (rendered[name] ?? 0) + count;
      const longTasks = window.__longTasks.filter((task) => task.at >= start).map((task) => task.duration);
      return { commits: commits.length, pageRenderMs: pageCommits.reduce((sum, commit) => sum + commit.duration, 0), rendered, longTasks };
    });
    perTick.push(sample);
  }
  const sum = (name) => perTick.map((sample) => sample.rendered[name] ?? 0);
  const allLong = perTick.flatMap((sample) => sample.longTasks);
  results.live = {
    ticks,
    commitsPerUpdate: round(median(perTick.map((sample) => sample.commits))),
    pageRenderMsPerUpdate: round(median(perTick.map((sample) => sample.pageRenderMs))),
    pageRenderMsPerUpdateP95: round(p95(perTick.map((sample) => sample.pageRenderMs))),
    componentsRenderedPerUpdate: round(median(perTick.map((sample) => Object.values(sample.rendered).reduce((total, count) => total + count, 0)))),
    eventCardsRenderedPerUpdate: round(median(sum("CalendarEventCard"))),
    gridRendersPerUpdate: round(median(sum("CalendarGrid"))),
    sidebarRendersPerUpdate: round(median(sum("CalendarSidebar"))),
    miniMonthRendersPerUpdate: round(median(sum("MiniMonth"))),
    avatarsRenderedPerUpdate: round(median(sum("BotAvatarImage"))),
    longTasksOver50: allLong.filter((duration) => duration > 50).length,
    longestTaskMs: round(Math.max(0, ...allLong)),
    sampleRendered: perTick[Math.floor(perTick.length / 2)]?.rendered,
  };

  // 4. Unrelated store frames (the sidebar's hidden rows): the page should not render.
  const unrelated = await page.evaluate(async () => {
    const before = window.__calperf.fiberCommits.length;
    const out = [];
    for (let index = 0; index < 10; index += 1) {
      const at = window.__calperf.fiberCommits.length;
      window.__calperf.unrelated();
      await new Promise((done) => setTimeout(done, 100));
      const rendered = {};
      for (const commit of window.__calperf.fiberCommits.slice(at)) for (const [name, count] of Object.entries(commit.rendered)) rendered[name] = (rendered[name] ?? 0) + count;
      out.push(rendered);
    }
    return { commits: window.__calperf.fiberCommits.length - before, rendered: out };
  });
  results.unrelated = {
    componentsRenderedPerFrame: median(unrelated.rendered.map((rendered) => Object.values(rendered).reduce((total, count) => total + count, 0))),
    eventCardsRenderedPerFrame: median(unrelated.rendered.map((rendered) => rendered.CalendarEventCard ?? 0)),
  };

  // 5. Scroll: wheel on the grid for 4 s in Week and in Day, live frames on.
  const scrollRun = async (key) => {
    await timed({ key });
    await page.waitForTimeout(300);
    const box = await page.locator("[role=grid]").boundingBox();
    await page.mouse.move(box.x + box.width / 2, Math.min(800, box.y + 300));
    await page.evaluate(() => {
      window.__frames = [];
      window.__longTasks.length = 0;
      window.__liveTimer = setInterval(() => window.__calperf.tick(), 1000);
      const step = (at) => { window.__frames.push(at); if (window.__frames.length < 100000) window.__frameLoop = requestAnimationFrame(step); };
      window.__frameLoop = requestAnimationFrame(step);
    });
    const start = Date.now();
    let direction = 1;
    let steps = 0;
    while (Date.now() - start < 4000) {
      await page.mouse.wheel(0, 60 * direction);
      steps += 1;
      if (steps % 20 === 0) direction = -direction;
      await page.waitForTimeout(16);
    }
    return page.evaluate(() => {
      cancelAnimationFrame(window.__frameLoop);
      clearInterval(window.__liveTimer);
      const frames = window.__frames;
      const gaps = frames.slice(1).map((at, index) => at - frames[index]);
      const elapsed = (frames[frames.length - 1] - frames[0]) / 1000;
      return { fps: frames.length / elapsed, p95FrameMs: gaps.sort((a, b) => a - b)[Math.floor(gaps.length * 0.95)] ?? 0, framesOver33ms: gaps.filter((gap) => gap > 33.4).length, longTasksOver50: window.__longTasks.filter((task) => task.duration > 50).length };
    });
  };
  for (const [name, key] of [["week", "w"], ["day", "1"]]) {
    const sample = await scrollRun(key);
    results.scroll[name] = { fps: round(sample.fps), p95FrameMs: round(sample.p95FrameMs), framesOver33ms: sample.framesOver33ms, longTasksOver50: sample.longTasksOver50 };
  }
  await timed({ key: "w" });
  await browser.stopTracing();

  results.memory.afterLiveMb = await heap();
  await page.screenshot({ path: join(outDir, `${label}-week-after-live.png`) });
  await timed({ key: "1" });
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(outDir, `${label}-day.png`) });
  await page.close();

  await writeFile(join(outDir, `${label}.json`), `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((done) => server.httpServer.close(done));
  if (!process.argv.includes("--keep-build")) await rm(distDir, { recursive: true, force: true });
}
