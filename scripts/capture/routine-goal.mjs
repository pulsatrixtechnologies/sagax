#!/usr/bin/env node
/**
 * Headless screenshots of a goal routine (#2696): the routine panel in view
 * and edit mode, beside the same panel without a goal, light and dark.
 * Headless Chromium only.
 * Usage: node scripts/capture/routine-goal.mjs [--out DIR] [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "routine-goal"));
const port = Number(arg("--port") ?? 5191);
const skins = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];
const modes = ["view", "edit"];

const vite = spawn("pnpm", ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, detached: true,
});
let log = "";
vite.stdout?.on("data", (c) => { log += c; });
vite.stderr?.on("data", (c) => { log += c; });
let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/routine-editor.html`;
  for (const start = Date.now(); ; await new Promise((d) => setTimeout(d, 500))) {
    try { if ((await fetch(base)).status < 500) break; } catch { /* retry */ }
    if (Date.now() - start > 120_000) throw new Error("gallery did not start");
  }
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  const page = await browser.newPage({ viewport: { width: 460, height: 960 }, deviceScaleFactor: 2, timezoneId: "America/Toronto", locale: "fr-CA" });
  for (const { id, label } of skins) for (const mode of modes) {
    const files = [];
    for (const goal of ["0", "1"]) {
      await page.goto(`${base}?skin=${id}&lang=fr&view=panel-editor&mode=${mode}&goal=${goal}`, { waitUntil: "load" });
      await page.waitForSelector("[data-gallery-card]", { timeout: 30_000 });
      await page.waitForTimeout(600);
      if (goal === "1") await page.locator("[data-routine-editor-section=goal]").waitFor({ timeout: 15_000 });
      const file = join(outDir, `${mode}-${goal === "1" ? "goal" : "neighbour"}-${label}.png`);
      await page.locator("[data-gallery-card]").first().screenshot({ path: file });
      files.push(file);
    }
    // Side by side: the neighbour (no goal) on the left, the goal on the right.
    const [left, right] = await Promise.all(files.map(async (f) => `data:image/png;base64,${(await readFile(f)).toString("base64")}`));
    const html = `<body style="margin:0;display:flex;gap:16px;padding:16px;background:#888"><img src="${left}" style="width:400px"><img src="${right}" style="width:400px"></body>`;
    const tmp = join(outDir, "_pair.html");
    await writeFile(tmp, html);
    await page.setViewportSize({ width: 848, height: 912 });
    await page.goto(`file://${tmp}`);
    await page.screenshot({ path: join(outDir, `${mode}-side-by-side-${label}.png`), fullPage: true });
    await page.setViewportSize({ width: 460, height: 960 });
    console.log(`${label} ${mode}: ok`);
  }
} catch (error) {
  console.error(String(error), log.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* gone */ }
}
