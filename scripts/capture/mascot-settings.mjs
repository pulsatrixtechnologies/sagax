#!/usr/bin/env node
/**
 * Headless captures of the mascot settings and states (#5349), on the gallery
 * pages (every name synthetic): Edit bot > Appearance with the Material tab
 * (each material chosen), the Face tab, the States tab (each of the six
 * states on the preview), beside the conforming neighbour (the Skin tab);
 * and the sidebar with bots in different states and looks, beside the
 * sidebar of shapes as it was. Light and dark, English and French.
 * Headless Chrome only: no window opens. The gallery's Vite runs on a port
 * of its own and is stopped by its process id.
 *
 * Usage: node scripts/capture/mascot-settings.mjs [--out DIR] [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "mascot-settings")));
const port = Number(arg("--port", "5349"));
const skins = [{ id: "pulsatrix-light", label: "light" }, { id: "pulsatrix", label: "dark" }];
const langs = ["en", "fr"];
const MATERIALS = ["flat", "fluffy", "glass"];
const STATES = ["idle", "thinking", "working", "waiting", "blocked", "done"];
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await sleep(500);
  }
  throw new Error(`gallery did not start at ${url}`);
}

// the gallery's Vite, with a dependency cache of its own
const cacheDir = await mkdtemp(join(tmpdir(), "mascot-settings-vite-"));
const serve = `const { createServer } = await import(${JSON.stringify(join(root, "node_modules", "vite", "dist", "node", "index.js"))});
const server = await createServer({ configFile: "vite.gallery.config.ts", cacheDir: ${JSON.stringify(cacheDir)}, server: { host: "127.0.0.1", port: ${port}, strictPort: true } });
await server.listen(); console.log("ready");`;
const vite = spawn(process.execPath, ["--input-type=module", "-e", serve], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" } });
console.log("gallery server pid", vite.pid);
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

const gallery = (page, query) => `http://127.0.0.1:${port}/src/gallery/${page}.html?${new URLSearchParams(query)}`;

/** Every mascot of the page drawn: a still image decoded, an SVG written, or the engine's canvas painted. */
async function mascotsDrawn(page) {
  await page.waitForFunction(() => [...document.querySelectorAll(".shape-mascot")].every((el) => el.querySelector("img, svg, canvas")), null, { timeout: 60_000 }).catch(() => {});
  await page.evaluate(async () => {
    const images = [...document.querySelectorAll(".shape-mascot img")];
    await Promise.all(images.map((image) => (image.complete ? null : image.decode().catch(() => null))));
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
}

const report = { webgl2: null, canvases: {}, shots: [] };

async function shots(browser) {
  const shoot = async ({ name, page: galleryPage, query = {}, skin, lang, width = 1280, height = 860, prepare, locator, wait = 1200 }) => {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: skin.label, locale: lang === "fr" ? "fr-CA" : "en-US" });
    context.setDefaultTimeout(120_000);
    const file = join(outDir, `${name}-${skin.label}-${lang}.png`);
    try {
      const page = await context.newPage();
      page.on("pageerror", (error) => console.error(`${name}: page error:`, error.message));
      if (galleryPage === "appearance-editor") await page.route("**/api/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not in this gallery" }) }));
      await page.goto(gallery(galleryPage, { skin: skin.id, lang, ...query }), { waitUntil: "networkidle" });
      await page.waitForSelector(".shape-mascot", { timeout: 60_000 });
      if (report.webgl2 === null) report.webgl2 = await page.evaluate(() => Boolean(document.createElement("canvas").getContext("webgl2")));
      if (prepare) await prepare(page);
      await page.mouse.move(0, 0);
      await sleep(wait);
      await mascotsDrawn(page);
      report.canvases[`${name}-${skin.label}-${lang}`] = await page.evaluate(() => document.querySelectorAll("[data-shape-canvas] canvas").length);
      await (locator ? page.locator(locator).first() : page).screenshot({ path: file, animations: "disabled" });
      report.shots.push(file);
      console.log("shot", file);
    } catch (error) {
      console.error(`${name}: failed: ${error.message.split("\n")[0]}`);
      process.exitCode = 1;
    } finally {
      await context.close();
    }
    return file;
  };

  /** Several captures on one sheet, each under its caption, four to a row. */
  const sideBySide = async ({ name, skin, lang, items }) => {
    const context = await browser.newContext({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1 });
    const file = join(outDir, `${name}-${skin.label}-${lang}.png`);
    try {
      const page = await context.newPage();
      const cells = [];
      for (const item of items) {
        const data = (await readFile(item.file)).toString("base64");
        cells.push(`<figure><figcaption>${item.caption}</figcaption><img src="data:image/png;base64,${data}" style="height:${item.height ?? 520}px"></figure>`);
      }
      const dark = skin.label === "dark";
      await page.setContent(`<body style="margin:0;padding:16px;display:grid;grid-template-columns:repeat(${Math.min(items.length, 4)},max-content);width:max-content;gap:16px;background:${dark ? "#111" : "#eee"};font:600 16px system-ui;color:${dark ? "#eee" : "#111"}"><style>figure{margin:0;display:flex;flex-direction:column;gap:8px}img{display:block;width:auto}</style>${cells.join("")}</body>`);
      await page.locator("body").screenshot({ path: file });
      report.shots.push(file);
      console.log("sheet", file);
    } finally {
      await context.close();
    }
  };

  const openTab = (tab) => async (page) => {
    await page.locator(`[data-appearance-tab="${tab}"]`).first().click();
    await page.waitForSelector(`[data-appearance-tab-panel="${tab}"]`);
  };

  for (const skin of skins) {
    for (const lang of langs) {
      const common = { skin, lang, page: "appearance-editor" };
      const editor = { shape: "cup", color: "blue" };
      // the conforming neighbour: the Skin tab of the same page
      const neighbour = await shoot({ name: "editor-skin-neighbour", ...common, query: editor, prepare: openTab("skin") });
      // Material: each material chosen
      const material = {};
      for (const id of MATERIALS) {
        material[id] = await shoot({ name: `editor-material-${id}`, ...common, query: { ...editor, material: id }, prepare: openTab("material"), wait: 2500 });
      }
      // Face: a happy bot with white eyes
      const face = await shoot({ name: "editor-face", ...common, query: { ...editor, mood: "happy", eyeColor: "#ffffff" }, prepare: openTab("face") });
      // States: each state on the preview
      const state = {};
      for (const id of STATES) {
        state[id] = await shoot({
          name: `editor-state-${id}`, ...common, query: editor, wait: 2600,
          prepare: async (page) => {
            await openTab("states")(page);
            await page.locator(`[data-agent-state-preview="${id}"]`).click();
          },
        });
      }
      // a state on a material: the engine paints the mark and the ribbons in the material too
      state.fluffyWorking = await shoot({
        name: "editor-state-working-fluffy", ...common, query: { ...editor, material: "fluffy" }, wait: 3200,
        prepare: async (page) => {
          await openTab("states")(page);
          await page.locator('[data-agent-state-preview="working"]').click();
        },
      });
      await sideBySide({ name: "sheet-editor-materials", skin, lang, items: [
        { file: neighbour, caption: "Neighbour: Skin tab" },
        ...MATERIALS.map((id) => ({ file: material[id], caption: `Material: ${id}` })),
        { file: face, caption: "Face: happy, white eyes" },
      ] });
      await sideBySide({ name: "sheet-editor-states", skin, lang, items: [
        { file: neighbour, caption: "Neighbour: Skin tab" },
        ...STATES.map((id) => ({ file: state[id], caption: `State previewed: ${id}` })),
        { file: state.fluffyWorking, caption: "Working, Fluffy" },
      ] });

      // the sidebar: bots in different states and looks, beside the sidebar of shapes as it was
      // tall enough for every row; Escape closes the account menu the gallery may leave open over the last rows
      const closeMenus = async (page) => { await page.keyboard.press("Escape"); await page.mouse.move(900, 500); };
      const shell = { skin, lang, page: "app-shell-sidebar", width: 1280, height: 1500, prepare: closeMenus };
      const before = await shoot({ name: "sidebar-neighbour", ...shell, query: { shapes: "13" }, locator: "aside, nav" });
      const after = await shoot({ name: "sidebar-states", ...shell, query: { states: "1" }, locator: "aside, nav", wait: 2600 });
      await shoot({ name: "shell-states", ...shell, query: { states: "1", select: "state-working" }, wait: 2600 });
      await sideBySide({ name: "sheet-sidebar", skin, lang, items: [
        { file: before, caption: "Neighbour: sidebar of shapes", height: 900 },
        { file: after, caption: "States and looks", height: 900 },
      ] });
    }
  }
}

let browser;
try {
  await waitForServer(gallery("shape-set", {}));
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  // a throwaway load: Vite optimizes dependencies on the first visit
  const warm = await browser.newPage();
  warm.setDefaultTimeout(300_000);
  await warm.goto(gallery("app-shell-sidebar", { states: "1" }), { waitUntil: "load" });
  await warm.waitForSelector(".shape-mascot", { timeout: 120_000 }).catch(() => {});
  await sleep(4000);
  await warm.close();
  await shots(browser);
  console.log(JSON.stringify({ webgl2: report.webgl2, canvases: report.canvases, shots: report.shots.length }));
} catch (error) {
  console.error(error);
  console.error(log.slice(-4000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  // only the server this script started, by its process id
  if (vite.pid) process.kill(vite.pid, "SIGTERM");
  await rm(cacheDir, { recursive: true, force: true });
}
