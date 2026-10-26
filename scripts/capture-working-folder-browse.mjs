#!/usr/bin/env node
/**
 * Headless screenshots of the working-folder field and its Parcourir dropdown
 * (src/gallery/working-folder-browse.html), light and dark, wide and narrow.
 * The script answers /api itself (a Windows computer's folders). Headless
 * Chromium only: no window opens.
 * Usage: node scripts/capture-working-folder-browse.mjs [--out DIR] [--port N]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "working-folder-browse"));
const port = Number(arg("--port") ?? 5288);
const skins = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];
const HOME = "C:\\Users\\zseilam";
const DL = `${HOME}\\Downloads`;
const L = (path, parent, names) => ({ path, parent, home: HOME, roots: ["C:\\", "D:\\"], truncated: false, entries: names.map((name) => ({ name, kind: "dir" })) });
const TREE = {
  [DL]: L(DL, HOME, ["Nouveau dossier (23)", "Factures", "Photos de chantier", "Scripts"]),
  [HOME]: L(HOME, "C:\\Users", ["Desktop", "Documents", "Downloads"]),
};

async function waitForServer(url, ms = 120_000) {
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

try {
  const base = `http://127.0.0.1:${port}/src/gallery/working-folder-browse.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  const page = await browser.newPage({ viewport: { width: 520, height: 640 }, deviceScaleFactor: 2 });
  await page.route("**/api/**", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    const listing = TREE[body.path || HOME] ?? L(body.path, body.path.slice(0, body.path.lastIndexOf("\\")), []);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(listing) });
  });
  for (const { id, label } of skins) {
    for (const width of [440, 320]) {
      await page.setViewportSize({ width: width + 40, height: 640 });
      await page.goto(`${base}?skin=${id}&lang=fr&width=${width}`, { waitUntil: "load" });
      await page.waitForSelector("[data-remote-folder-toggle]");
      await page.screenshot({ path: join(outDir, `field-${width}-${label}.png`) });
      await page.click('[data-gallery-card="vm"] [data-remote-folder-toggle]');
      await page.waitForSelector("[data-remote-folder-entry]");
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(outDir, `dropdown-${width}-${label}.png`) });
      if (width === 440) {
        await page.click('[data-remote-folder-entry="Factures"]');
        await page.waitForFunction(() => document.body.textContent?.includes("Factures"));
        await page.click("[data-remote-folder-choose]");
        await page.screenshot({ path: join(outDir, `chosen-${label}.png`) });
      }
    }
  }
  await browser.close();
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(error);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  try { process.kill(-vite.pid, "SIGTERM"); } catch { vite.kill("SIGTERM"); }
}
