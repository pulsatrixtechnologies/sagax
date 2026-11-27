#!/usr/bin/env node
/**
 * Headless captures of the mascot picker's Generate flow (#5450): five
 * descriptions (cat, cup, rocket, cloud, robot), preview with Keep / Retry /
 * Cancel, light and dark, English and French. Real components through the
 * appearance-editor gallery. Chrome headless, channel chrome; never the
 * app's Vite on 5173. Stops the gallery by its exact pid.
 *
 * Usage: node scripts/capture/generate-shape.mjs [--out DIR] [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { generateEngineAvatarDef } from "../../shared/engine-avatar-generate.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = resolve(arg("--out", join("/Users/Workspace/artifacts/wave-2026-11-27/generate-shape", "captures")));
const port = Number(arg("--port", "5450"));
const skins = [{ id: "pulsatrix-light", label: "light" }, { id: "pulsatrix", label: "dark" }];
const langs = ["en", "fr"];
const trials = [
  { id: "cat", en: "a friendly cat", fr: "un chat amical" },
  { id: "cup", en: "a coffee cup", fr: "une tasse de café" },
  { id: "rocket", en: "a small rocket", fr: "une petite fusée" },
  { id: "cloud", en: "a soft cloud", fr: "un nuage doux" },
  { id: "robot", en: "a cute robot", fr: "un petit robot" },
];
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await sleep(500);
  }
  throw new Error(`gallery did not start at ${url}`);
}

const cacheDir = await mkdtemp(join(tmpdir(), "generate-shape-vite-"));
const serve = `const { createServer } = await import(${JSON.stringify(join(root, "node_modules", "vite", "dist", "node", "index.js"))});
const server = await createServer({ configFile: "vite.gallery.config.ts", cacheDir: ${JSON.stringify(cacheDir)}, server: { host: "127.0.0.1", port: ${port}, strictPort: true } });
await server.listen(); console.log("ready");`;
const vite = spawn(process.execPath, ["--input-type=module", "-e", serve], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" } });
console.log("gallery server pid", vite.pid);
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

const gallery = (query) => `http://127.0.0.1:${port}/src/gallery/appearance-editor.html?${new URLSearchParams(query)}`;
const PANEL = "[data-mascot-picker-popover]";

async function mascotsDrawn(page) {
  await page.waitForFunction(() => [...document.querySelectorAll(".shape-mascot")].every((el) => el.querySelector("img, svg, canvas")), null, { timeout: 60_000 }).catch(() => {});
  await page.evaluate(async () => {
    const images = [...document.querySelectorAll(".shape-mascot img")];
    await Promise.all(images.map((image) => (image.complete ? null : image.decode().catch(() => null))));
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
}

const report = { webgl2: null, shots: [], trials: [] };

let browser;
try {
  await mkdir(outDir, { recursive: true });
  await waitForServer(`http://127.0.0.1:${port}/src/gallery/appearance-editor.html`);
  browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });

  for (const trial of trials) {
    for (const skin of skins) {
      for (const lang of langs) {
        const direction = lang === "fr" ? trial.fr : trial.en;
        const def = generateEngineAvatarDef(direction);
        const context = await browser.newContext({
          viewport: { width: 1180, height: 900 },
          deviceScaleFactor: 2,
          colorScheme: skin.label,
          locale: lang === "fr" ? "fr-CA" : "en-US",
        });
        context.setDefaultTimeout(60_000);
        const page = await context.newPage();
        page.on("pageerror", (error) => console.error("page error:", error.message));
        await page.route("**/api/**", async (route) => {
          const request = route.request();
          if (request.method() === "POST" && /\/api\/bots\/[^/]+\/shape-avatar\/generate$/.test(new URL(request.url()).pathname)) {
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({ def, source: "fallback" }),
            });
            return;
          }
          await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not in this gallery" }) });
        });
        try {
          if (report.webgl2 === null) report.webgl2 = await page.evaluate(() => Boolean(document.createElement("canvas").getContext("webgl2")));
          await page.goto(gallery({ skin: skin.id, lang, shape: "cup", color: "teal" }), { waitUntil: "networkidle" });
          await page.waitForSelector(`${PANEL} [data-mascot-picker]`);
          await page.locator("[data-mascot-picker-grid]").evaluate((box) => { box.scrollTop = box.scrollHeight; });
          await page.locator("[data-mascot-add-open]").click();
          await page.waitForSelector("[data-mascot-add-generate]");
          await page.locator("[data-mascot-add-generate] textarea").fill(direction);
          await page.locator("[data-mascot-generate]").click();
          await page.waitForSelector("[data-mascot-generate-preview]");
          await page.waitForSelector("[data-mascot-generate-keep]");
          await page.mouse.move(2, 2);
          await sleep(700);
          await mascotsDrawn(page);
          const file = join(outDir, `preview-${trial.id}-${skin.label}-${lang}.png`);
          await page.screenshot({ path: file, clip: { x: 130, y: 0, width: 760, height: 740 }, animations: "disabled" });
          report.shots.push(file);
          report.trials.push({ id: trial.id, skin: skin.label, lang, direction, defId: def.id, file });
          console.log("shot", file, "def", def.id);
        } catch (error) {
          console.error(`${trial.id}-${skin.label}-${lang}: failed: ${error.message.split("\n")[0]}`);
          process.exitCode = 1;
        } finally {
          await context.close();
        }
      }
    }
  }

  // one sheet of the five previews (dark, French) for the lot folder
  const sheetContext = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  try {
    const page = await sheetContext.newPage();
    const cells = [];
    for (const trial of trials) {
      const file = join(outDir, `preview-${trial.id}-dark-fr.png`);
      const png = (await readFile(file)).toString("base64");
      cells.push(`<figure><figcaption>${trial.fr} → ${trial.id}</figcaption><img src="data:image/png;base64,${png}"></figure>`);
    }
    await page.setContent(`<!doctype html><body style="margin:0;padding:16px;display:grid;grid-template-columns:repeat(5,1fr);gap:12px;background:#111;font:600 13px system-ui;color:#eee"><style>figure{margin:0;display:flex;flex-direction:column;gap:6px}img{display:block;width:100%;height:auto;border-radius:12px}</style>${cells.join("")}</body>`);
    const sheet = join(outDir, "five-previews-dark-fr.png");
    await page.locator("body").screenshot({ path: sheet });
    report.shots.push(sheet);
    console.log("sheet", sheet);
  } finally {
    await sheetContext.close();
  }

  await writeFile(join(outDir, "report.json"), JSON.stringify(report, null, 2));
} catch (error) {
  console.error(error);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (vite.pid) { try { process.kill(vite.pid, "SIGTERM"); } catch { /* already gone */ } }
  await rm(cacheDir, { recursive: true, force: true });
}
