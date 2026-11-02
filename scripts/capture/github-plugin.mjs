#!/usr/bin/env node
/**
 * Headless screenshots of the GitHub connection's place (Playwright, no
 * window): Connect apps > Providers (engines and the person's servers
 * only), the GitHub plugin's page (Installed > GitHub, where the GitHub
 * connection is since 2026-10-29) with Connect GitHub opened, and Sources
 * (its GitHub connection row), for an organization member and an admin,
 * light and dark, on a server without a GitHub OAuth App.
 * Usage: node scripts/capture/github-plugin.mjs --out DIR [--prefix before]
 *   [--root CHECKOUT] [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const root = resolve(arg("--root") ?? here);
const outDir = resolve(arg("--out") ?? join(here, "docs", "screenshots", "github-plugin"));
const port = Number(arg("--port") ?? 5317);
const prefix = arg("--prefix") ?? "after";
const schemes = [{ skin: "pulsatrix-light", scheme: "light" }, { skin: "pulsatrix", scheme: "dark" }];

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const vite = spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" },
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/connect-apps.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM } : {}) });
  for (const role of ["member", "admin"]) {
    for (const { skin, scheme } of schemes) {
      const page = await browser.newPage({ viewport: { width: 1200, height: 1400 }, deviceScaleFactor: 1, colorScheme: scheme });
      page.on("pageerror", (error) => console.error("page error:", error.stack));
      await page.goto(`${base}?view=manage&skin=${skin}&lang=en&role=${role}&app=none`, { waitUntil: "networkidle" });
      await page.waitForSelector("[data-plugins-manage]", { timeout: 30_000 });
      // the panel mounts again once the bots arrive: let it settle first
      await page.waitForSelector("[data-plugins-scope-bar]", { timeout: 30_000 });
      await page.waitForTimeout(1000);
      const shot = async (name) => {
        await page.waitForTimeout(800);
        await page.locator('[role="dialog"]').first().screenshot({ path: join(outDir, `${prefix}-${role}-${name}-${scheme}.png`) });
      };
      await page.click('[data-plugins-tab="providers"]');
      await page.waitForSelector('[data-plugins-manage="providers"]');
      await shot("providers");
      // the GitHub plugin's page, from its Installed row
      await page.click('[data-plugins-tab="installed"]');
      await page.locator("[data-installed-entry]", { hasText: "GitHub" }).first().locator("button").first().click();
      await page.waitForSelector("[data-plugins-detail]");
      await shot("github-plugin");
      // Connect GitHub with no OAuth App: the token form, for anyone
      if (await page.locator("[data-github-connect]").count()) {
        await page.click("[data-github-connect]");
        await shot("github-plugin-connect");
      }
      if (await page.locator('[data-plugins-tab="sources"]').count()) {
        await page.click('[data-plugins-tab="sources"]');
        await shot("sources");
      }
      await page.close();
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
