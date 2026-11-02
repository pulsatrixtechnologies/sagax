#!/usr/bin/env node
/**
 * Headless screenshots of where GitHub lives in Connect apps (Playwright, no
 * window): the Sources tab, Providers (its GitHub service when there is
 * one) and the GitHub entry of Installed, for an organization member and an
 * admin, light and dark. `--fail` answers GET /api/me/connections with a bare
 * proxy 502 (no JSON body, "Bad Gateway"), what a Sagax restart behind the
 * organization's proxy gives: no screen may show those words.
 * Usage: node scripts/capture/connect-apps-github.mjs --out DIR [--prefix before]
 *   [--root CHECKOUT] [--port N] [--fail]
 *   (--root: the checkout whose gallery to serve, e.g. a worktree of the old main)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const root = resolve(arg("--root") ?? here);
const outDir = resolve(arg("--out") ?? join(here, "docs", "screenshots", "connect-apps-github"));
const port = Number(arg("--port") ?? 5301);
const prefix = arg("--prefix") ?? "after";
const fail = process.argv.includes("--fail");
const schemes = [{ skin: "pulsatrix-light", scheme: "light" }, { skin: "pulsatrix", scheme: "dark" }];

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

// The gallery replaces window.fetch with its stand-in /api; this keeps a bare
// 502 in front of it for /api/me/connections (a proxy's answer has no JSON).
const failConnections = () => {
  let inner = window.fetch;
  const outer = (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    if (url.pathname === "/api/me/connections") return Promise.resolve(new Response("<html>502 Bad Gateway</html>", { status: 502, statusText: "Bad Gateway", headers: { "content-type": "text/html" } }));
    return inner(input, init);
  };
  Object.defineProperty(window, "fetch", { configurable: true, get: () => outer, set: (value) => { inner = value; } });
};

const vite = spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" },
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

let browser;
const raw = [];
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
      if (fail) await page.addInitScript(failConnections);
      await page.goto(`${base}?view=manage&skin=${skin}&lang=en&role=${role}`, { waitUntil: "networkidle" });
      await page.waitForSelector("[data-plugins-manage]", { timeout: 30_000 });
      const shot = async (name) => {
        await page.waitForTimeout(800);
        const text = await page.locator('[role="dialog"]').first().innerText();
        if (/Bad Gateway|\b502\b/.test(text)) raw.push(`${role}-${scheme}-${name}`);
        await page.locator('[role="dialog"]').first().screenshot({ path: join(outDir, `${prefix}-${role}-${name}-${scheme}.png`) });
      };
      for (const tab of ["sources", "providers"]) {
        if (!await page.locator(`[data-plugins-tab="${tab}"]`).count()) continue;
        await page.click(`[data-plugins-tab="${tab}"]`);
        await page.waitForSelector(`[data-plugins-manage="${tab}"]`);
        if (tab === "providers" && await page.locator('[data-accounts-service-pill="github"]').count()) await page.click('[data-accounts-service-pill="github"]');
        // with --fail: past the asks again (1.5 + 3 + 6 s), what stays on screen
        if (fail) await page.waitForTimeout(12_000);
        await shot(tab);
      }
      await page.click('[data-plugins-tab="installed"]');
      await page.waitForSelector('[data-installed-entry="plugin:github@claude-plugins-official"]');
      await page.locator('[data-installed-entry="plugin:github@claude-plugins-official"] button').first().click();
      await shot("installed-github");
      await page.close();
    }
  }
  console.log(`screenshots in ${outDir}`);
  if (raw.length) console.log(`a raw 502 is shown on: ${raw.join(", ")}`);
  else console.log("no raw 502 shown");
} catch (error) {
  console.error(error);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
