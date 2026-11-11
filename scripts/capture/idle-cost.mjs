#!/usr/bin/env node
/**
 * What the window costs while nobody touches it (#3624), measured headless on
 * the real AppSidebar, ChatView and bot panel over a synthetic store (gallery
 * app-shell-sidebar, ?scene=, src/gallery/app-shell-scene.ts). No window
 * opens: Playwright drives Chrome headless.
 *
 * For each scene, over ten seconds, from the Chrome DevTools protocol:
 * the main thread's script, style, layout and task time (Performance.getMetrics),
 * the frames the page asked for (each requestAnimationFrame callback run),
 * the CSS animations started (Animation domain) and still running on screen,
 * and the React components rendered (commits read through the devtools hook,
 * a component counted once per commit it rendered in).
 *
 * Scenes: idle (nothing happens), background (three bots work in
 * conversations that are not the open one), open (the open conversation's
 * bot works), idle-hidden (idle, the document hidden), idle-away (idle, the
 * sidebar and the panel scrolled to their end), background-hidden,
 * background-away (the working rows scrolled out of view). A hidden document
 * is emulated (visibilityState): Chrome still runs requestAnimationFrame for
 * the page, which a really hidden window does not.
 *
 * --prod measures a production build of the gallery (React's production
 * build, as the app ships; not minified, so components keep their names)
 * instead of the dev server, whose React does far more per render.
 *
 * --shots DIR takes the UX gate's screenshots instead of measuring: the idle
 * and background scenes, English and French, light and dark, 1280 and 390 px
 * wide, next to the neighbour (the same gallery without a scene), named
 * <mode>-<scene>-<skin>-<width>-<lang>.png (--mode before|after).
 *
 * Usage: node scripts/capture/idle-cost.mjs [--out FILE.json] [--port N] [--seconds N] [--only scene,scene] [--profile] [--prod] [--shots DIR --mode before|after]
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
const out = resolve(arg("--out", join(root, "docs", "screenshots", "idle-cost", "idle-cost.json")));
const port = Number(arg("--port", "5344"));
const seconds = Number(arg("--seconds", "10"));
const only = arg("--only", "")?.split(",").filter(Boolean);
const profile = process.argv.includes("--profile");
const prod = process.argv.includes("--prod");
const shots = arg("--shots", "");
const mode = arg("--mode", "after");

const SCENES = [
  { name: "idle", scene: "idle" },
  { name: "background", scene: "background" },
  { name: "open", scene: "open" },
  { name: "idle-hidden", scene: "idle", hidden: true },
  { name: "idle-away", scene: "idle", away: true },
  { name: "background-hidden", scene: "background", hidden: true },
  { name: "background-away", scene: "background", away: true },
].filter((entry) => !only?.length || only.includes(entry.name));

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

/** Runs in the page before any script: counts the frames the page asks for
 * and the React components each commit rendered. */
function instrument() {
  const w = window;
  const probe = { frames: 0, frameSources: {}, commits: 0, renders: {} };
  w.__idleProbe = probe;
  const raf = w.requestAnimationFrame.bind(w);
  w.requestAnimationFrame = (callback) => {
    const source = (new Error().stack ?? "").split("\n")[2]?.trim().replace(/\?[^:)]*/, "").replace(/^at /, "") ?? "?";
    return raf((time) => {
      probe.frames += 1;
      probe.frameSources[source] = (probe.frameSources[source] ?? 0) + 1;
      callback(time);
    });
  };
  // PerformedWork: the fiber's component ran during this commit's render
  const PERFORMED_WORK = 1;
  const nameOf = (fiber) => {
    const type = fiber.elementType ?? fiber.type;
    if (!type || typeof type === "string") return null;
    return type.displayName ?? type.name ?? type.render?.displayName ?? type.render?.name ?? type.type?.displayName ?? type.type?.name ?? null;
  };
  // As React DevTools does: a subtree whose child list is the one of the
  // previous commit was not visited; a fiber met for the first time mounted.
  const walk = (next, prev, seen) => {
    const rendered = !prev || (next.flags & PERFORMED_WORK);
    if (rendered) {
      const name = nameOf(next);
      if (name && !seen.has(name)) {
        seen.add(name);
        probe.renders[name] = (probe.renders[name] ?? 0) + 1;
      }
    }
    if (prev && next.child === prev.child) return;
    for (let child = next.child; child; child = child.sibling) walk(child, prev ? child.alternate : null, seen);
  };
  w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map(),
    supportsFiber: true,
    inject(renderer) { const id = this.renderers.size + 1; this.renderers.set(id, renderer); return id; },
    onScheduleFiberRoot() {},
    onCommitFiberRoot(_id, root) {
      probe.commits += 1;
      walk(root.current, root.current.alternate, new Set());
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
  };
}

function hide() {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
  document.dispatchEvent(new Event("visibilitychange"));
}

/** Scroll the working rows out of view: the sidebar list to its end (the
 * working bots sit at its top) and the bot panel past its Coding section. */
function scrollAway() {
  const scrollers = [...document.querySelectorAll("*")].filter((el) => {
    const style = getComputedStyle(el);
    return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 4;
  });
  for (const el of scrollers) el.scrollTop = el.scrollHeight;
  return scrollers.length;
}

/** The gallery's server: vite's dev server, or a production build served by vite preview. */
async function serveGallery() {
  if (!prod) {
    const vite = spawn(
      process.execPath,
      [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" } },
    );
    return { close: async () => { vite.kill(); } };
  }
  const { build, preview } = await import("vite");
  const outDir = await mkdtemp(join(tmpdir(), "idle-cost-"));
  const configFile = join(root, "vite.gallery.config.ts");
  await build({
    configFile, root, logLevel: "warn", mode: "production",
    build: { outDir, emptyOutDir: true, minify: false, target: "esnext", rollupOptions: { input: join(root, "src", "gallery", "app-shell-sidebar.html") } },
  });
  const server = await preview({ configFile, root, logLevel: "warn", build: { outDir }, preview: { host: "127.0.0.1", port, strictPort: true } });
  return { close: async () => { await server.close(); await rm(outDir, { recursive: true, force: true }); } };
}

const server = await serveGallery();
let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery`;
  await waitForServer(`${base}/app-shell-sidebar.html`);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  browser = await chromium.launch({ channel: "chrome", headless: true });
  if (shots) {
    await mkdir(shots, { recursive: true });
    const shoot = async (query, file, width, skin) => {
      const page = await browser.newPage({ viewport: { width, height: 860 }, deviceScaleFactor: 2, colorScheme: skin === "daylight" ? "light" : "dark" });
      page.on("pageerror", (error) => console.error(String(error)));
      await page.goto(`${base}/app-shell-sidebar.html?${query}&skin=${skin}`, { waitUntil: "networkidle" });
      await page.waitForSelector("[data-sidebar-row-avatar], [data-app-shell]", { timeout: 30_000 });
      await page.waitForTimeout(2_500);
      await page.screenshot({ path: join(shots, file) });
      await page.close();
      console.log(file);
    };
    for (const skin of ["daylight", "pulsatrix"]) {
      for (const width of [1280, 390]) {
        for (const lang of ["en", "fr"]) {
          for (const scene of ["idle", "background"]) await shoot(`lang=${lang}&scene=${scene}`, `${mode}-${scene}-${skin}-${width}-${lang}.png`, width, skin);
          if (mode === "after") await shoot(`lang=${lang}`, `neighbour-${skin}-${width}-${lang}.png`, width, skin);
        }
      }
    }
  }
  const results = [];
  for (const entry of shots ? [] : SCENES) {
    for (let take = 1; take <= 2; take++) {
      const page = await browser.newPage({ viewport: { width: 1280, height: entry.away ? 520 : 860 }, deviceScaleFactor: 2 });
      page.on("pageerror", (error) => console.error(String(error)));
      await page.addInitScript(instrument);
      await page.goto(`${base}/app-shell-sidebar.html?lang=en&scene=${entry.scene}`, { waitUntil: "networkidle" });
      await page.waitForSelector("[data-sidebar-row-avatar]", { timeout: 30_000 });
      // the scene's frames start a second after mount; entrance animations end
      await page.waitForTimeout(3_000);
      if (entry.away) await page.evaluate(scrollAway);
      if (entry.hidden) await page.evaluate(hide);
      await page.waitForTimeout(500);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Performance.enable");
      await cdp.send("Animation.enable");
      const started = {};
      cdp.on("Animation.animationStarted", ({ animation }) => {
        const key = `${animation.type}:${animation.name || animation.cssId || "?"}`;
        started[key] = (started[key] ?? 0) + 1;
      });
      await page.evaluate(() => {
        const probe = window.__idleProbe;
        probe.frames = 0; probe.frameSources = {}; probe.commits = 0; probe.renders = {};
      });
      const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((metric) => [metric.name, metric.value]));
      if (profile) {
        await cdp.send("Profiler.enable");
        await cdp.send("Profiler.setSamplingInterval", { interval: 250 });
        await cdp.send("Profiler.start");
      }
      const before = await metrics();
      await page.waitForTimeout(seconds * 1000);
      const after = await metrics();
      let hot;
      if (profile) {
        const { profile: cpu } = await cdp.send("Profiler.stop");
        const nodes = new Map(cpu.nodes.map((node) => [node.id, node]));
        const self = new Map();
        cpu.samples.forEach((id, index) => {
          const frame = nodes.get(id).callFrame;
          if (!frame.url) return;
          const key = `${frame.functionName || "(anonymous)"} ${frame.url.replace(/^.*\/src\//, "src/").replace(/\?.*$/, "")}:${frame.lineNumber + 1}`;
          self.set(key, (self.get(key) ?? 0) + (cpu.timeDeltas[index] ?? 0) / 1000);
        });
        hot = [...self].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([key, ms]) => `${ms.toFixed(1)} ms ${key}`);
      }
      const span = after.Timestamp - before.Timestamp;
      const delta = (key) => after[key] - before[key];
      const share = (key) => Number(((delta(key) / span) * 100).toFixed(2));
      const probe = await page.evaluate(() => window.__idleProbe);
      const running = await page.evaluate(() => {
        const counts = {};
        for (const animation of document.getAnimations()) {
          if (animation.playState !== "running") continue;
          const target = animation.effect?.target;
          const rect = target?.getBoundingClientRect?.();
          if (!rect || rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth || !rect.width) continue;
          const key = animation.animationName ?? animation.id ?? "script";
          counts[key] = (counts[key] ?? 0) + 1;
        }
        return counts;
      });
      const result = {
        scene: entry.name, take, seconds: Number(span.toFixed(2)),
        scriptPercent: share("ScriptDuration"), taskPercent: share("TaskDuration"),
        stylePercent: share("RecalcStyleDuration"), layoutPercent: share("LayoutDuration"),
        styleRecalcs: delta("RecalcStyleCount"), layouts: delta("LayoutCount"),
        frames: probe.frames, frameSources: probe.frameSources,
        commits: probe.commits,
        renders: Object.fromEntries(Object.entries(probe.renders).sort((a, b) => b[1] - a[1]).slice(0, 400)),
        animationsStarted: started, animationsRunningOnScreen: running,
        ...(hot ? { hot } : {}),
      };
      results.push(result);
      console.log(`${entry.name} #${take}: script ${result.scriptPercent}% task ${result.taskPercent}% style ${result.styleRecalcs} layout ${result.layouts} frames ${result.frames} commits ${result.commits}`);
      await page.close();
    }
  }
  if (!shots) {
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, `${JSON.stringify(results, null, 2)}\n`);
    console.log(out);
  }
} finally {
  await browser?.close();
  await server.close();
}
