#!/usr/bin/env node
/**
 * Headless screenshots of Plugins > Me for an organization member
 * (Playwright, no window), light and dark: Installed with the person's own
 * MCP servers, the "+ Add" menu, then each entry's form (Add an MCP server,
 * Paste config, New skill) and a server row's menu. 2026-11-06: no "My MCP
 * servers" card at the bottom; the servers are Installed rows.
 * Usage: node scripts/capture/plugins-me-add.mjs --out DIR [--prefix before]
 *   [--root CHECKOUT] [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const root = resolve(arg("--root") ?? here);
const outDir = resolve(arg("--out") ?? join(here, "docs", "screenshots", "plugins-me-add"));
const port = Number(arg("--port") ?? 5176);
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
  const executablePath = process.env.SAGAX_VERIFY_BROWSER_CHROME || process.env.SAGAX_CHROMIUM;
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  for (const { skin, scheme } of schemes) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1400 }, deviceScaleFactor: 2, colorScheme: scheme });
    page.setDefaultTimeout(20_000);
    page.on("pageerror", (error) => console.error("page error:", error.stack));
    await page.goto(`${base}?view=manage&skin=${skin}&lang=en&role=member`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-plugins-manage]", { timeout: 30_000 }).catch(async (error) => {
      await page.screenshot({ path: join(outDir, `${prefix}-debug-${scheme}.png`) });
      console.error(await page.locator("body").innerText().catch(() => ""));
      throw error;
    });
    const dialog = page.locator('[role="dialog"]').first();
    // ?view=manage opens on Discover; its "connected" link leads to Installed
    const toInstalled = async () => {
      // The link can be clicked before React hydrates it: retry a few times.
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await page.click("[data-plugins-connected]");
        try { await page.waitForSelector("[data-plugins-add]", { timeout: 5_000 }); return; } catch { /* retry */ }
      }
      await page.waitForSelector("[data-plugins-add]");
    };
    const shot = async (name) => {
      await page.waitForTimeout(600);
      await dialog.screenshot({ path: join(outDir, `${prefix}-${name}-${scheme}.png`) });
    };
    await toInstalled();
    console.log(`${scheme}: scope ${await page.locator("[data-plugins-scope]").first().getAttribute("data-plugins-scope").catch(() => "?")}`);
    await shot("installed");
    const bottom = page.locator("[data-plugins-personal]");
    if (await bottom.count()) { await bottom.first().scrollIntoViewIfNeeded(); await shot("installed-bottom"); }
    await page.click("[data-plugins-add]");
    await shot("add-menu");
    const actions = await page.locator("[data-plugins-add-action]").evaluateAll((items) => items.map((item) => item.getAttribute("data-plugins-add-action")));
    console.log(`${scheme}: + Add = ${actions.join(", ")}`);
    await page.keyboard.press("Escape");
    for (const action of actions) {
      await page.goto(`${base}?view=manage&skin=${skin}&lang=en&role=member`, { waitUntil: "networkidle" });
      await page.waitForSelector("[data-plugins-manage]");
      await toInstalled();
      await page.click("[data-plugins-add]");
      await page.click(`[data-plugins-add-action="${action}"]`);
      await shot(`add-${action}`);
    }
    await page.goto(`${base}?view=manage&skin=${skin}&lang=en&role=member`, { waitUntil: "networkidle" });
    await toInstalled();
    const row = page.locator('[data-personal-server="notes"]');
    if (await row.count()) {
      await row.scrollIntoViewIfNeeded();
      await shot("installed-personal-row");
      if (await row.locator("[data-entry-menu]").count()) {
        await row.locator("[data-entry-menu]").click();
        await shot("row-menu");
      }
    }
    await page.close();
  }
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(error);
  if (process.argv.includes("--log")) console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
