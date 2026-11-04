// Headless member journey through the real PluginsPanel on a local /api
// stand-in. Synthetic data only. Starts and stops its own Vite and browser.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = join(root, "docs/screenshots/flow-superseded");
const port = Number(process.env.SAGAX_CAPTURE_PORT ?? 5187);
assert(port >= 5176 && port <= 5206, "Use an allowed Vite port (5176 to 5206).");
const vite = spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
let viteLog = "";
vite.stdout.on("data", (chunk) => { viteLog += chunk; });
vite.stderr.on("data", (chunk) => { viteLog += chunk; });
const exited = new Promise((resolveExit) => vite.once("exit", resolveExit));
const base = `http://127.0.0.1:${port}/src/gallery/connect-apps.html`;
let browser;
const checks = [];
try {
  for (let attempt = 0; ; attempt++) {
    if (vite.exitCode !== null) throw new Error(viteLog);
    try { if ((await fetch(base)).ok) break; } catch { /* starting */ }
    if (attempt >= 90) throw new Error(`Vite did not start: ${viteLog}`);
    await new Promise((ready) => setTimeout(ready, 500));
  }
  await mkdir(out, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  for (const lang of ["en", "fr"]) for (const scheme of ["light", "dark"]) for (const width of [1100, 700, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1, colorScheme: scheme });
    page.setDefaultTimeout(60_000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const deletes = [];
    page.on("request", (request) => { if (request.method() === "DELETE") deletes.push(new URL(request.url()).pathname); });
    const skin = scheme === "light" ? "pulsatrix-light" : "pulsatrix";
    await page.goto(`${base}?view=manage&superseded=1&role=member&lang=${lang}&skin=${skin}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    const note = page.locator("[data-capability-superseded]");
    await note.waitFor();
    assert.equal(await note.innerText(), lang === "fr"
      ? "Remplacé par le pack Flow de l'organisation (osprey 0.1.41)"
      : "Superseded by the organization's Flow pack (osprey 0.1.41)");
    const remove = page.locator("[data-remove-superseded]");
    assert.equal(await remove.innerText(), lang === "fr" ? "Retirer" : "Remove");
    assert(await remove.isEnabled());
    const geometry = await note.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const action = node.closest("li").querySelector("[data-remove-superseded]").getBoundingClientRect();
      return { overflow: document.documentElement.scrollWidth > innerWidth, noteVisible: box.left >= 0 && box.right <= innerWidth, actionVisible: action.left >= 0 && action.right <= innerWidth };
    });
    assert.deepEqual(geometry, { overflow: false, noteVisible: true, actionVisible: true });
    const prefix = `${lang}-${scheme}-${width}`;
    await page.locator('[data-tour="apps-panel"]').screenshot({ path: join(out, `${prefix}.png`) });
    await remove.click();
    await note.waitFor({ state: "detached" });
    assert.equal(await page.locator('[data-capability="flow"]').count(), 1);
    assert.equal(await page.locator('[role="dialog"]').count(), 1);
    // The stand-in handles fetch in the page, so no HTTP DELETE leaves it.
    assert.deepEqual(deletes, []);
    assert.deepEqual(errors, []);
    if (width === 1100) await page.locator('[data-tour="apps-panel"]').screenshot({ path: join(out, `${prefix}-removed.png`) });
    checks.push({ lang, scheme, width, geometry, removed: true, flowRetained: true, pageErrors: errors });
    console.log(`PASS: ${prefix}, removal and retained Flow.`);
    await page.close();
  }
  await writeFile(join(out, "capture.json"), JSON.stringify({ fixture: "member, synthetic local API", checks }, null, 2) + "\n");
  console.log(`PASS: ${checks.length} headless journeys, 16 captures, no page errors.`);
} finally {
  await browser?.close();
  if (vite.exitCode === null) {
    vite.kill("SIGTERM");
    const timer = setTimeout(() => vite.kill("SIGKILL"), 3000);
    await exited;
    clearTimeout(timer);
  }
}
