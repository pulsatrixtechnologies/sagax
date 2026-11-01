#!/usr/bin/env node
/**
 * The shapes' visual regression (2026-10-28): headless screenshots of every
 * shape (src/gallery/shape-set.html) at rest, in every skin, in every mood
 * and in the middle of each of the fourteen moves, at the sizes the app
 * draws them, and a check of every body on the page as the browser lays it
 * out: the two eyes sit inside the face, every slice of the body overlaps the
 * face (the pieces touch), the stem stands in the body, the body is one
 * closed outline. Then each screenshot is compared to its reference image.
 *
 * Usage: node scripts/capture-shapes.mjs [--out DIR] [--reference DIR] [--update] [--port N] [--chrome PATH] [--quick]
 *   --out        where the screenshots go (default docs/screenshots/shapes)
 *   --reference  the images to compare against (default: --out); --update
 *                rewrites them instead of comparing
 *   --quick      the rest and the moves only (no skins, no moods)
 *   (--chrome or SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 * Headless Chromium only: nothing opens on screen.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const flag = (name) => process.argv.includes(name);
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "shapes"));
const referenceDir = resolve(arg("--reference") ?? outDir);
const update = flag("--update");
const quick = flag("--quick");
const port = Number(arg("--port") ?? 5297);

const MOVES = ["thinking", "wink", "wide", "alert", "notify", "exclaim", "sleep", "egg", "hexagon", "play", "orbit", "swirl", "burst", "comet"];
const SKINS = ["plain", "pastel", "glossy", "night", "outline", "gold", "neon", "chrome", "crystal", "circuit", "holo", "molten", "galaxy"];
const MOODS = ["idle", "thinking", "working", "streaming", "happy", "blocked", "sleeping"];
/** Each move's duration (s): the screenshot is taken with the move fully in (shape-moves.ts MOVE_TIMING). */
const MOVE_MID = { thinking: 1.4, wink: 0.9, wide: 1, alert: 1.3, notify: 1.2, exclaim: 1.1, sleep: 1.3, egg: 1, hexagon: 0.9, play: 1.1, orbit: 1.8, swirl: 0.8, burst: 1.3, comet: 1.2 };

/** Every scene: a name, the gallery's query, how long after the move starts (ms) the shot is taken. */
function scenes() {
  const list = [
    // the two resting sheets at 2x (the reference of the set); every other scene at 1x, so the gallery stays light
    { name: "rest-96", query: "size=96", hd: true },
    { name: "rest-44", query: "size=44" },
    { name: "rest-36-still", query: "size=36&still=1" },
    { name: "rest-96-dark", query: "size=96", dark: true, hd: true },
    { name: "rest-96-white", query: "size=96&color=white" },
    { name: "rest-96-black", query: "size=96&color=black", dark: true },
  ];
  for (const move of MOVES) {
    list.push({ name: `move-${move}-96`, query: `size=96&move=${move}`, settle: 400 + MOVE_MID[move] * 1000 });
    list.push({ name: `move-${move}-44`, query: `size=44&move=${move}`, settle: 400 + MOVE_MID[move] * 1000 });
  }
  if (!quick) {
    for (const skin of SKINS) if (skin !== "plain") list.push({ name: `skin-${skin}-96`, query: `size=96&shapeSkin=${skin}` });
    for (const mood of MOODS) if (mood !== "idle") list.push({ name: `mood-${mood}-96`, query: `size=96&mood=${mood}` });
    // the white body in a move: its hairline must not peek out as rings
    list.push({ name: "move-alert-96-white", query: "size=96&move=alert&color=white", settle: 400 + MOVE_MID.alert * 1000 });
    list.push({ name: "move-thinking-96-white", query: "size=96&move=thinking&color=white", settle: 400 + MOVE_MID.thinking * 1000 });
  }
  return list;
}

/**
 * Runs in the page: for every shape on it, in the browser's own layout
 * (every transform the CSS and the SVG apply), checks that each eye point
 * falls inside the face's fill, that every slice's outline overlaps the face
 * and that the stem's foot is in the body.
 */
const CHECK = `(() => {
  const SVG = "http://www.w3.org/2000/svg";
  const report = [];
  for (const rootNode of document.querySelectorAll("[data-shape]")) {
    const svg = rootNode.querySelector("svg");
    const shape = rootNode.getAttribute("data-shape");
    const skin = rootNode.getAttribute("data-shape-skin");
    if (!svg) { report.push({ shape, skin, error: "no drawing" }); continue; }
    const face = svg.querySelector("[data-shape-face]") || svg.querySelector(".shape-fill");
    const eyes = svg.querySelector("[data-shape-eyes]");
    const stem = svg.querySelector("[data-shape-stem]");
    const slices = [...svg.querySelectorAll("[data-shape-slice]")];
    if (!face) { report.push({ shape, skin, error: "no face" }); continue; }
    const d = face.getAttribute("d") || "";
    if (!/^M[^M]*Z$/.test(d.split("M").slice(0, 2).join("M"))) { report.push({ shape, skin, error: "face is not one closed outline: " + d.slice(0, 40) }); continue; }
    // the face's own outline (the first subpath: a flat skin cuts the eyes through it as more subpaths)
    const probe = document.createElementNS(SVG, "path");
    probe.setAttribute("d", "M" + d.split("M")[1]);
    svg.appendChild(probe);
    const pt = svg.createSVGPoint();
    const toFace = face.getScreenCTM().inverse();
    const inFace = (node, p) => {
      pt.x = p.x; pt.y = p.y;
      const s = pt.matrixTransform(node.getScreenCTM());
      const q = s.matrixTransform(toFace);
      return probe.isPointInFill(q);
    };
    const sample = (node, count) => {
      const total = node.getTotalLength();
      const out = [];
      for (let i = 0; i < count; i += 1) out.push(node.getPointAtLength((i / count) * total));
      return out;
    };
    let eyeOut = 0, eyePoints = 0;
    if (eyes && eyes.getAttribute("d")) {
      for (const p of sample(eyes, 96)) { eyePoints += 1; if (!inFace(eyes, p)) eyeOut += 1; }
    }
    // the pieces touch: a slice's middle sits in the face and so does its outline drawn
    // at half size about the body's middle (a slice a little offset is fine; one standing
    // beside the face, as a dot smeared into a pill, is not)
    const gaps = [];
    for (const slice of slices) {
      const node = slice.tagName === "use" ? probe : slice;
      const points = sample(node, 48).map((p) => ({ x: 50 + (p.x - 50) * 0.5, y: 50 + (p.y - 50) * 0.5 }));
      const inside = points.filter((p) => inFace(slice, p)).length + (inFace(slice, { x: 50, y: 50 }) ? 1 : 0);
      if (inside < points.length + 1) gaps.push(inside / (points.length + 1));
    }
    let stemOut = null;
    if (stem && stem.getAttribute("d")) {
      const points = sample(stem, 24);
      stemOut = points.some((p) => inFace(stem, p)) ? 0 : 1;
    }
    probe.remove();
    report.push({ shape, skin, eyes: eyes ? (eyes.getAttribute("d") || "").split("M").length - 1 : 0, eyePoints, eyeOut, slices: slices.length, gaps, stemOut });
  }
  return report;
})()`;

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {
      /* retry */
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

/** `pngquant` when it is installed (brew install pngquant): the gallery stays light in the repo; otherwise the PNG is kept as it is. */
let pngquant;
function shrink(file) {
  if (pngquant === undefined) {
    try {
      pngquant = execFileSync("which", ["pngquant"], { encoding: "utf8" }).trim() || null;
    } catch {
      pngquant = null;
    }
  }
  if (!pngquant) return;
  try {
    execFileSync(pngquant, ["--force", "--skip-if-larger", "--quality", "70-95", "--speed", "1", "--output", file, file], { stdio: "ignore" });
  } catch {
    /* kept as captured */
  }
}

/**
 * Two PNGs compared pixel by pixel in the browser itself (no image library
 * in the repo): the share of pixels that differ by more than a little.
 */
async function diffShare(page, a, b) {
  const [x, y] = await Promise.all([a, b].map(async (file) => `data:image/png;base64,${(await readFile(file)).toString("base64")}`));
  return page.evaluate(async ([ua, ub]) => {
    const load = (src) =>
      new Promise((done, fail) => {
        const img = new Image();
        img.onload = () => done(img);
        img.onerror = fail;
        img.src = src;
      });
    const [ia, ib] = await Promise.all([load(ua), load(ub)]);
    if (ia.width !== ib.width || ia.height !== ib.height) return 1;
    const draw = (img) => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, img.width, img.height).data;
    };
    const da = draw(ia);
    const db = draw(ib);
    let differ = 0;
    const n = ia.width * ia.height;
    for (let i = 0; i < n; i += 1) {
      const o = i * 4;
      const delta = Math.abs(da[o] - db[o]) + Math.abs(da[o + 1] - db[o + 1]) + Math.abs(da[o + 2] - db[o + 2]);
      if (delta > 48) differ += 1;
    }
    return differ / n;
  }, [x, y]);
}

const vite = spawn("pnpm", ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, NODE_ENV: "development" },
  detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => {
  log += chunk;
});
vite.stderr?.on("data", (chunk) => {
  log += chunk;
});

const failures = [];
try {
  const base = `http://127.0.0.1:${port}/src/gallery/shape-set.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const chrome = arg("--chrome") ?? process.env.SAGAX_VERIFY_BROWSER_CHROME;
  const browser = await chromium.launch({ headless: true, ...(chrome ? { executablePath: chrome } : {}) });
  const results = [];
  // the dev server optimises the gallery's dependencies on its first loads and reloads the page
  // under us: warm it up until a load goes through without a navigation
  {
    const warm = await browser.newPage();
    for (let i = 0; i < 6; i += 1) {
      await warm.goto(`${base}?skin=pulsatrix-light&size=44`, { waitUntil: "networkidle" });
      let navigated = false;
      warm.once("framenavigated", () => {
        navigated = true;
      });
      await warm.waitForTimeout(1500);
      if (!navigated) break;
    }
    await warm.close();
  }
  for (const scene of scenes()) {
    const context = await browser.newContext({ viewport: { width: 1000, height: 560 }, deviceScaleFactor: scene.hd ? 2 : 1 });
    const page = await context.newPage();
    const file = join(outDir, `${scene.name}.png`);
    let report = [];
    // a scene is taken again when the page navigated under it (a dependency re-optimised) or came up short
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.goto(`${base}?skin=${scene.dark ? "pulsatrix" : "pulsatrix-light"}&${scene.query}`, { waitUntil: "load" });
      await page.waitForSelector("[data-shot]");
      await page.evaluate(() => {
        window.__shapesShot = true;
      });
      await page.waitForTimeout(scene.settle ?? 900);
      const same = await page.evaluate(() => window.__shapesShot === true).catch(() => false);
      if (!same) continue;
      // the screenshot first: the check walks every point of 32 drawings and takes a while, a move would be over
      await page.locator("[data-shot]").screenshot({ path: file });
      report = await page.evaluate(CHECK);
      if (report.length >= 40) break;
    }
    shrink(file);
    const bad = report.filter((r) => r.error || r.eyeOut > 0 || r.gaps.length > 0 || r.stemOut);
    if (report.length < 40) failures.push(`${scene.name}: only ${report.length} shapes on the page`);
    for (const r of bad) failures.push(`${scene.name}: ${r.shape} ${r.error ?? `eyes out ${r.eyeOut}/${r.eyePoints}, slices apart ${r.gaps.length}/${r.slices}, stem out ${r.stemOut}`}`);
    let diff = null;
    const reference = join(referenceDir, `${scene.name}.png`);
    if (!update && referenceDir !== outDir && existsSync(reference)) {
      diff = await diffShare(page, reference, file);
      if (diff > 0.004) failures.push(`${scene.name}: ${(diff * 100).toFixed(2)} % of the pixels differ from ${reference}`);
    }
    await context.close();
    results.push({ scene: scene.name, shapes: report.length, bad: bad.length, diff });
    console.log(`${scene.name}: ${report.length} shapes, ${bad.length} bad${diff === null ? "" : `, diff ${(diff * 100).toFixed(2)} %`}`);
  }
  await browser.close();
  await writeFile(join(outDir, "report.json"), `${JSON.stringify({ at: new Date().toISOString(), results, failures }, null, 1)}\n`);
  if (update && referenceDir !== outDir) {
    await mkdir(referenceDir, { recursive: true });
    for (const r of results) await writeFile(join(referenceDir, `${r.scene}.png`), await readFile(join(outDir, `${r.scene}.png`)));
  }
  if (failures.length) {
    console.error(`\n${failures.length} failure(s):\n${failures.join("\n")}`);
    process.exitCode = 1;
  } else {
    console.log(`every shape holds together; screenshots in ${outDir}`);
  }
} catch (error) {
  console.error(error);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  try {
    process.kill(-vite.pid, "SIGTERM");
  } catch {
    vite.kill("SIGTERM");
  }
}
