#!/usr/bin/env node
/**
 * Headless captures of the cards a bot asks as a form or a checklist
 * (#4490): src/gallery/question-forms.html, each sample alone, dark and
 * light, English and French, at device scale 2. Also one capture of the
 * time form half filled in and of the checklist with a row unchecked.
 * Headless Chromium only: no window opens. Its own Vite port (never 5173).
 * Usage: node scripts/capture/question-forms.mjs [--out DIR] [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "question-forms"));
const port = Number(arg("--port") ?? 5187);
const SAMPLES = ["side-by-side-single", "side-by-side-form", "before-time", "before-drafts", "time-form", "drafts-checklist", "control-kinds", "time-settled", "drafts-settled"];

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const viteBin = join(root, "node_modules", "vite", "bin", "vite.js");
const vite = spawn(process.execPath, [viteBin, "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

let browser;
let failed = false;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/question-forms.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const executablePath = process.env.SAGAX_VERIFY_BROWSER_CHROME;
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  for (const skin of ["pulsatrix", "pulsatrix-light"]) {
    for (const lang of ["en", "fr"]) {
      const theme = skin === "pulsatrix" ? "dark" : "light";
      const page = await browser.newPage({ viewport: { width: 1240, height: 1000 }, deviceScaleFactor: 2 });
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error?.stack ?? error).slice(0, 800)));
      await page.goto(`${base}?${new URLSearchParams({ skin, lang })}`, { waitUntil: "load" });
      await page.waitForSelector("[data-gallery-sample='drafts-settled']");
      await page.waitForTimeout(800);
      for (const sample of SAMPLES) {
        const file = join(outDir, `${sample}-${theme}-${lang}.png`);
        await page.locator(`[data-gallery-sample='${sample}']`).screenshot({ path: file });
        console.log(file);
      }
      // the time form half answered, the drafts with a row unchecked
      const form = page.locator("[data-gallery-sample='time-form']");
      await form.locator("[data-form-row]").nth(0).locator("[data-form-choice]").first().click();
      await form.locator("[data-form-row]").nth(1).locator("input").nth(0).fill("1");
      await form.locator("[data-form-row]").nth(1).locator("input").nth(1).fill("30");
      await form.locator("[data-form-row]").nth(5).locator("[data-form-choice]").first().click();
      const filled = join(outDir, `time-form-filling-${theme}-${lang}.png`);
      await form.screenshot({ path: filled });
      console.log(filled);
      const list = page.locator("[data-gallery-sample='drafts-checklist']");
      await list.locator("[role='checkbox']").nth(1).click();
      const unchecked = join(outDir, `drafts-checklist-unchecked-${theme}-${lang}.png`);
      await list.screenshot({ path: unchecked });
      console.log(unchecked);
      if (errors.length) { failed = true; console.log(`ERRORS: ${errors.join(" | ")}`); }
      await page.close();
    }
  }
} catch (error) {
  failed = true;
  console.error(error);
  console.error(log.slice(-2000));
} finally {
  await browser?.close();
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* gone */ }
}
process.exit(failed ? 1 : 0);
