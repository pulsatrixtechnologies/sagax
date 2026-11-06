#!/usr/bin/env node
/**
 * Headless screenshots of Connect apps > Mac > Messages from
 * src/gallery/mac-messages.html. Synthetic permission states only.
 * Also the other Apple apps of This Mac (view app) and the organization-server
 * states (server: IPC answers after the 404; error: readable error, never blank).
 * Usage: node scripts/capture/mac-messages.mjs [--out DIR] [--port N]
 *   [--lang en|fr] [--states off,ready,enabled,unavailable,server,error]
 *   [--views setup,mac,app] [--apps mail,calendar,contacts,reminders,notes]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "mac-messages")));
const port = Number(arg("--port", "5327"));
const lang = arg("--lang", "en");
const states = arg("--states", "off,ready,enabled,unavailable,server,error").split(",").filter(Boolean);
const views = arg("--views", "setup,mac,app").split(",").filter(Boolean);
const apps = arg("--apps", "mail,calendar,contacts,reminders,notes").split(",").filter(Boolean);
const settle = Number(arg("--wait", "800"));
const skins = [{ id: "pulsatrix-light", label: "light" }, { id: "pulsatrix", label: "dark" }];

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const vite = spawn(
  process.execPath,
  [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" } },
);
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/mac-messages.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}),
  });
  for (const skin of skins) {
    const page = await browser.newPage({
      viewport: { width: 900, height: 1100 },
      deviceScaleFactor: 2,
      colorScheme: skin.label,
    });
    page.on("pageerror", (error) => console.error("page error:", error.stack));
    for (const view of views) {
      for (const state of states) for (const app of view === "app" ? apps : [""]) {
        if (view === "mac" && state !== "off" && state !== "enabled") continue;
        if (view === "app" && app !== "mail" && state !== "off" && state !== "server") continue;
        const url = `${base}?view=${view}&state=${state}&app=${app}&skin=${skin.id}&lang=${lang}`;
        await page.goto(url, { waitUntil: "domcontentloaded" });
        await page.waitForSelector("[data-gallery-mac-messages]", { timeout: 30_000 });
        if (view === "setup") {
          await page.waitForSelector("[data-messages-setup-steps], [data-messages-load-error], [data-messages-setup-unavailable]", { timeout: 30_000 });
        } else if (view === "app") {
          await page.waitForSelector("[data-mac-app-steps], [data-mac-app-load-error], [data-mac-app-unavailable]", { timeout: 30_000 });
        } else {
          await page.waitForSelector("[data-plugins-mac]", { timeout: 30_000 });
        }
        // Let mocked fetch + React settle; avoid networkidle (HMR keeps sockets open).
        await page.waitForTimeout(settle);
        const file = join(outDir, `${view}${app ? `-${app}` : ""}-${state}-${skin.label}-${lang}.png`);
        await page.locator("[data-gallery-mac-messages]").screenshot({ path: file });
        console.log("shot", file);
      }
    }
    await page.close();
  }
} catch (error) {
  console.error(error);
  console.error(log);
  process.exitCode = 1;
} finally {
  try { await browser?.close(); } catch { /* ignore */ }
  vite.kill("SIGTERM");
  await new Promise((done) => setTimeout(done, 300));
  try { vite.kill("SIGKILL"); } catch { /* ignore */ }
}
