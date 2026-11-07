// Headless captures of file names in a bot message (#file-links), dark and
// light: the link, then the right-click menu. Synthetic data, mocked desktop
// bridge (nothing is opened). Starts and stops its own Vite and browser.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = process.env.SAGAX_CAPTURE_OUT ?? join(root, "docs/screenshots/file-links");
const port = Number(process.env.SAGAX_CAPTURE_PORT ?? 5203);
assert(port >= 5176 && port <= 5206, "Use an allowed Vite port (5176 to 5206).");
const vite = spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
let viteLog = "";
vite.stdout.on("data", (chunk) => { viteLog += chunk; });
vite.stderr.on("data", (chunk) => { viteLog += chunk; });
const exited = new Promise((resolveExit) => vite.once("exit", resolveExit));
const base = `http://127.0.0.1:${port}/src/gallery/file-links.html`;
let browser;
try {
  for (let attempt = 0; ; attempt++) {
    if (vite.exitCode !== null) throw new Error(viteLog);
    try { if ((await fetch(base)).ok) break; } catch { /* starting */ }
    if (attempt >= 90) throw new Error(`Vite did not start: ${viteLog}`);
    await new Promise((ready) => setTimeout(ready, 500));
  }
  await mkdir(out, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  for (const lang of ["fr", "en"]) for (const scheme of ["dark", "light"]) {
    const page = await browser.newPage({ viewport: { width: 820, height: 420 }, deviceScaleFactor: 2, colorScheme: scheme });
    page.setDefaultTimeout(60_000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const skin = scheme === "light" ? "pulsatrix-light" : "pulsatrix";
    await page.goto(`${base}?lang=${lang}&skin=${skin}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    const links = page.locator("[data-file-link]");
    await links.nth(1).waitFor();
    assert.equal(await links.count(), 2);
    assert.deepEqual(await page.locator('[data-shot="message"] code').allInnerTexts(), ["autre.html"]);
    const prefix = `${lang}-${scheme}`;
    await page.locator('[data-shot="message"]').screenshot({ path: join(out, `${prefix}-link.png`) });
    await links.first().click();
    assert.deepEqual(await page.evaluate(() => window.__opened), ["/Users/demo/Desktop/pelican-a-velo.html"]);
    await links.first().click({ button: "right" });
    const items = await page.locator('[data-file-link-menu] [role="menuitem"]').allInnerTexts();
    assert.deepEqual(items, lang === "fr" ? ["Ouvrir", "Afficher dans le Finder", "Copier le chemin"] : ["Open", "Show in Finder", "Copy path"]);
    await page.screenshot({ path: join(out, `${prefix}-menu.png`) });
    assert.deepEqual(errors, []);
    console.log(`PASS: ${prefix}`);
    await page.close();
  }
} finally {
  await browser?.close();
  if (vite.exitCode === null) {
    vite.kill("SIGTERM");
    const timer = setTimeout(() => vite.kill("SIGKILL"), 3000);
    await exited;
    clearTimeout(timer);
  }
}
