#!/usr/bin/env node
/**
 * #3438: headless screenshots of the card pinned over the composer with a
 * question from handed-over work (one pending item) and, with it, a choice
 * question of the previous topic (two); French and English, light and dark,
 * 1440 and 390 wide. Next to them, the pinned card gallery of #3214 as the
 * conforming neighbour. Synthetic data only. Headless Chrome: no window opens.
 * With --cases approval: an approval asked in the previous topic, pinned too.
 * Usage: node scripts/capture/pinned-all-kinds.mjs --out DIR [--port N] [--prefix after] [--cases one,two,approval] [--no-neighbour]
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "pinned-all-kinds"));
const port = Number(arg("--port") ?? 5330);
const prefix = arg("--prefix") ?? "after";
const CASES = (arg("--cases") ?? "one,two").split(",");
const NEIGHBOUR = !process.argv.includes("--no-neighbour");
const SKINS = ["daylight", "midnight"];
const WIDTHS = [1440, 390];
const LANGS = ["fr", "en"];

async function waitForServer(url, ms = 180_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const vite = spawn("pnpm", ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" },
  detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/`;
  await waitForServer(`${base}pinned-all-kinds.html`);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const found = {};
  for (const lang of LANGS) for (const skin of SKINS) for (const width of WIDTHS) {
    const height = width < 600 ? 900 : 760;
    for (const which of CASES) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
      page.on("pageerror", (error) => console.error(`page error: ${error.message}`));
      await page.goto(`${base}pinned-all-kinds.html?${new URLSearchParams({ skin, lang, case: which, width: String(width) })}`, { waitUntil: "load" });
      await page.waitForSelector("[data-shot=chat]");
      await page.waitForTimeout(600);
      const name = `${prefix}-${which}-${width}-${skin}-${lang}`;
      await page.locator("[data-shot=chat]").screenshot({ path: join(outDir, `${name}.png`) });
      found[name] = {
        pinned: await page.locator("[data-pinned-waiting]").count(),
        title: await page.locator("[data-pinned-title]").count() ? await page.locator("[data-pinned-title]").textContent() : null,
        stepper: await page.locator("[data-approval-stepper]").count() ? await page.locator("[data-approval-stepper]").textContent() : null,
        questionSheets: await page.locator("[data-question-sheet]").count(),
        plainBoxes: await page.locator("textarea.resize-y").count(),
      };
      await page.close();
    }
    // the conforming neighbour: the pinned card of #3214
    if (!NEIGHBOUR) continue;
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
    await page.goto(`${base}pinned-card.html?${new URLSearchParams({ skin, lang, case: "two", width: String(width) })}`, { waitUntil: "load" });
    await page.waitForSelector("[data-pinned-waiting]");
    await page.waitForTimeout(500);
    await page.locator("[data-shot=chat]").screenshot({ path: join(outDir, `neighbour-${width}-${skin}-${lang}.png`) });
    await page.close();
  }
  await writeFile(join(outDir, `${prefix}-${CASES.join("-")}-found.json`), JSON.stringify(found, null, 2));
  console.log(JSON.stringify(found, null, 2));
} catch (error) {
  console.error(error);
  console.error(log.slice(-4000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* gone */ }
}
