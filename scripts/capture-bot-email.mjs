#!/usr/bin/env node
/**
 * Headless screenshots of the bot's own email address (B21, 2026-10-21):
 * src/gallery/bot-email.html, light and dark: the bot panel's Overview with
 * the Email address group, the Triggers builder with source Bot email, a
 * Bot email trigger's row opened, and the administrator's off state. The
 * script answers /api itself. Headless Chromium only: no window opens.
 * Usage: node scripts/capture-bot-email.mjs [--out DIR] [--port N]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "bot-inbound-mail"));
const port = Number(arg("--port") ?? 5291);
const skins = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];

async function waitForServer(url, ms = 120_000) {
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

try {
  const base = `http://127.0.0.1:${port}/src/gallery/bot-email.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  const page = await browser.newPage({ viewport: { width: 1620, height: 1000 }, deviceScaleFactor: 2 });
  let enabled = true;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const reply = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname.endsWith("/inbound-mail") && route.request().method() === "PUT") {
      const { localPart } = JSON.parse(route.request().postData() ?? "{}");
      return localPart === "factures" ? reply({ error: "taken", message: "taken" }, 409) : reply({ available: true, address: `${localPart}@bots.acme.example`, enabled, canChange: true });
    }
    if (url.pathname.endsWith("/inbound-mail")) return reply({ available: true, address: "cryptic@bots.acme.example", enabled, canChange: true });
    return reply({ error: "not in this gallery" }, 404);
  });
  for (const { id, label } of skins) {
    enabled = true;
    await page.goto(`${base}?skin=${id}&lang=fr`, { waitUntil: "load" });
    await page.waitForSelector("[data-bot-email-address]");
    await page.waitForSelector("[data-botmail-address]");
    await page.click('[data-gallery-panel="row"] summary');
    await page.waitForTimeout(250);
    await page.locator('[data-gallery-panel="overview"]').screenshot({ path: join(outDir, `profile-${label}.png`) });
    await page.locator('[data-gallery-panel="builder"]').screenshot({ path: join(outDir, `trigger-builder-${label}.png`) });
    await page.locator('[data-gallery-panel="row"]').screenshot({ path: join(outDir, `trigger-row-${label}.png`) });
    // addresses are off by default (JC decision 1): greyed, waiting for the admin
    enabled = false;
    await page.goto(`${base}?skin=${id}&lang=fr`, { waitUntil: "load" });
    await page.waitForSelector("[data-bot-email-pending]");
    await page.locator('[data-gallery-panel="overview"]').screenshot({ path: join(outDir, `profile-pending-${label}.png`) });
    // the owner changes it (JC decision 4): the form, then a taken name
    await page.click('[data-bot-email-address] button:has-text("Changer")');
    await page.waitForSelector("[data-bot-email-form]");
    await page.fill("[data-bot-email-form] input", "factures");
    await page.click("[data-bot-email-save]");
    await page.waitForSelector('[data-bot-email-form] [role="alert"]');
    await page.locator('[data-gallery-panel="overview"]').screenshot({ path: join(outDir, `profile-change-${label}.png`) });
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
