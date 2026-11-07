#!/usr/bin/env node
/**
 * Headless screenshots of the team settings dialog (src/gallery/team-settings.html):
 * the Approval tab (the compliant neighbour) beside the Computer tab (I2),
 * light and dark. Headless Chromium only: no window opens.
 * Usage: node scripts/capture/team-settings.mjs [--out DIR] [--port N] [--lang fr]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "team-settings"));
const port = Number(arg("--port") ?? 5331);
const lang = arg("--lang") ?? "fr";
const skins = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];

async function waitForServer(url, ms = 180_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const vite = spawn("pnpm", ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/team-settings.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  for (const { id, label } of skins) {
    const page = await browser.newPage({ viewport: { width: 1180, height: 1500 }, deviceScaleFactor: 2 });
    page.on("pageerror", (error) => console.error("pageerror", (error.stack ?? error.message).split("\n").slice(0, 6).join(" | ")));
    await page.goto(`${base}?skin=${id}&lang=${lang}`, { waitUntil: "load" });
    const dialog = page.getByTestId("team-settings-dialog");
    await dialog.waitFor();
    await page.locator("input[type=radio]").first().check();
    await page.mouse.move(1, 1);
    await page.waitForTimeout(400);
    const approval = join(outDir, `team-settings-${lang}-approval-${label}.png`);
    await dialog.screenshot({ path: approval });
    await page.locator("[role=tab]").nth(2).click({ force: true });
    await page.waitForSelector("input[name=team-computer]");
    await page.locator("input[name=team-computer]").nth(1).check();
    await page.mouse.move(1, 1);
    await page.waitForTimeout(400);
    const computer = join(outDir, `team-settings-${lang}-computer-${label}.png`);
    await dialog.screenshot({ path: computer });
    const side = await browser.newPage({ viewport: { width: 1400, height: 1500 }, deviceScaleFactor: 1 });
    const img = async (file) => `data:image/png;base64,${(await readFile(file)).toString("base64")}`;
    await side.setContent(`<body style="margin:0;display:inline-flex;gap:16px;padding:16px;background:#888;align-items:flex-start"><img style="width:640px" src="${await img(approval)}"><img style="width:640px" src="${await img(computer)}"></body>`);
    await side.locator("body").screenshot({ path: join(outDir, `team-settings-${lang}-side-by-side-${label}.png`), fullPage: true });
  }
  console.log(`team-settings captures in ${outDir}`);
} catch (error) {
  console.error(log.slice(-2000));
  throw error;
} finally {
  await browser?.close();
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* gone */ }
}
