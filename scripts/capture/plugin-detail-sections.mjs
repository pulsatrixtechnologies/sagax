#!/usr/bin/env node
/**
 * Headless screenshots of a plugin's detail page (#4154): a plugin with
 * neither an account nor a tool, with only an account, only tools, both, the
 * GitHub plugin's account block, a plugin that uses the GitHub account, a
 * connector's sign-in with its client form and a connector with no account.
 * French and English, light and dark, 1280 and 390 wide (Playwright, no
 * window). Usage: node scripts/capture/plugin-detail-sections.mjs --out DIR
 *   [--prefix before] [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(here, "docs", "screenshots", "plugin-detail-sections"));
const port = Number(arg("--port") ?? 5377);
const prefix = arg("--prefix") ?? "after";
const cases = ["neither", "account", "tools", "both", "github", "uses-github", "sign-in", "connector"];
const schemes = [{ skin: "pulsatrix-light", scheme: "light" }, { skin: "pulsatrix", scheme: "dark" }];

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    // this checkout's gallery, never another one answering on the port
    try { const response = await fetch(url); if (response.ok && (await response.text()).includes("plugin-detail-sections")) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const vite = spawn(process.execPath, [join(here, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: here, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" },
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/plugin-detail-sections.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  for (const width of [1280, 390]) {
    for (const { skin, scheme } of schemes) {
      for (const lang of ["fr", "en"]) {
        const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1, colorScheme: scheme });
        page.on("pageerror", (error) => console.error("page error:", error.stack));
        for (const name of cases) {
          await page.goto(`${base}?case=${name}&skin=${skin}&lang=${lang}`, { waitUntil: "networkidle" });
          await page.waitForSelector("[data-plugins-detail]", { timeout: 30_000 });
          await page.waitForTimeout(600);
          // the whole detail, past the window's height
          const height = await page.evaluate(() => document.querySelector("[data-plugins-detail]")?.scrollHeight ?? 900);
          await page.setViewportSize({ width, height: Math.max(600, height + 80) });
          await page.waitForTimeout(200);
          await page.screenshot({ path: join(outDir, `${prefix}-${name}-${lang}-${scheme}-${width}.png`) });
          await page.setViewportSize({ width, height: 900 });
        }
        await page.close();
      }
    }
  }
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(error);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
