#!/usr/bin/env node
/**
 * Headless screenshots of Automations > Webhooks without modals
 * (2026-11-01, lot 2 of docs: /Users/Workspace/plans/2026-11-01-sagax-ux-no-modals.md):
 * the sentence builder with the list, and the WebhookEditor in the right
 * DetailPanel. Gallery `src/gallery/webhooks-ux.html` (three fictional
 * triggers; the gallery answers /api itself). Headless Chromium only: no
 * window opens. Light and dark, desktop and narrow.
 * Usage: node scripts/capture-webhooks-panels.mjs [--out DIR] [--port N] [--prefix before|after]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "webhooks-panels"));
const port = Number(arg("--port") ?? 5301);
const prefix = arg("--prefix") ?? "after";
const skins = [{ id: "pulsatrix-light", label: "light" }, { id: "pulsatrix", label: "dark" }];
const sizes = [{ width: 1280, height: 800, label: "desktop" }, { width: 700, height: 860, label: "narrow" }];

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const steps = [
  { name: "list", run: async () => {} },
  { name: "editor", run: async (page) => {
    const edit = page.locator('button:has-text("Edit settings"), button:has-text("Modifier les réglages")').first();
    // Open Advanced options on the first bearer row so Edit settings is visible.
    const advanced = page.locator("details.group\\/advanced, details").filter({ hasText: /Advanced|Options avancées|Plus/ }).first();
    if (await advanced.count()) {
      await advanced.locator("summary").first().click().catch(() => {});
      await page.waitForTimeout(300);
    }
    if (await edit.count()) {
      await edit.click();
    } else {
      // Fallback: open New webhook from the Automations create menu if present.
      const create = page.locator('[aria-label*="webhook" i], [data-automations-create]').first();
      if (await create.count()) await create.click();
    }
    await page.waitForSelector("[data-webhook-editor-panel], [data-detail-panel]", { timeout: 8_000 }).catch(() => {});
  } },
];

const vite = spawn("pnpm", ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/webhooks-ux.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  for (const size of sizes) {
    const page = await browser.newPage({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2 });
    page.on("pageerror", (error) => console.error("page error:", error.stack));
    for (const skin of skins) for (const step of steps) {
      if (size.label === "narrow" && skin.label === "light") continue;
      await page.goto(`${base}?view=list&width=${size.width}&height=${size.height}&skin=${skin.id}&lang=en`, { waitUntil: "load" });
      await page.waitForSelector("[data-gallery-sample]");
      await page.waitForSelector("[data-triggers-view]", { timeout: 15_000 });
      await page.waitForTimeout(1200);
      try {
        await step.run(page);
      } catch (error) {
        console.error(`${step.name} (${size.label}, ${skin.label}): ${error.message.split("\n")[0]}`);
      }
      await page.waitForTimeout(700);
      const file = join(outDir, `${prefix}-${step.name}-${size.label}-${skin.label}.png`);
      await page.screenshot({ path: file });
      console.log(file);
    }
    await page.close();
  }
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(error); console.error(log.slice(-4000)); process.exitCode = 1;
} finally {
  await browser?.close();
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* gone */ }
}
