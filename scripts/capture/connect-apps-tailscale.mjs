#!/usr/bin/env node
/**
 * Headless screenshots of Connect apps > Tailscale (Playwright, no window).
 * Gallery: src/gallery/connect-apps.html?view=manage&tailscale=…
 * Phases: disconnected (setup), ready (join), waiting, connected.
 * Synthetic names only. Usage:
 *   node scripts/capture/connect-apps-tailscale.mjs --out DIR [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const outDir = resolve(arg("--out") ?? join(here, "docs", "screenshots", "connect-apps-tailscale"));
const port = Number(arg("--port") ?? 5317);
const schemes = [
  { skin: "pulsatrix-light", scheme: "light" },
  { skin: "pulsatrix", scheme: "dark" },
];
const phases = [
  { seed: "disconnected", name: "setup", open: true },
  { seed: "ready", name: "join", open: true },
  { seed: "waiting", name: "waiting", open: true },
  { seed: "connected", name: "connected", open: true },
];

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {
      /* retry */
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const vite = spawn(
  process.execPath,
  [
    join(here, "node_modules", "vite", "bin", "vite.js"),
    "--config",
    "vite.gallery.config.ts",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  {
    cwd: here,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "development" },
  },
);
let log = "";
vite.stdout?.on("data", (chunk) => {
  log += chunk;
});
vite.stderr?.on("data", (chunk) => {
  log += chunk;
});

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/connect-apps.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const chromePath = process.env.SAGAX_VERIFY_BROWSER_CHROME || process.env.SAGAX_CHROMIUM;
  browser = await chromium.launch({
    headless: true,
    ...(chromePath ? { executablePath: chromePath } : {}),
  });

  for (const { skin, scheme } of schemes) {
    for (const phase of phases) {
      const page = await browser.newPage({
        viewport: { width: 1100, height: 900 },
        deviceScaleFactor: 1,
        colorScheme: scheme,
      });
      page.on("pageerror", (error) => console.error("page error:", error.stack));
      await page.goto(`${base}?view=manage&skin=${skin}&lang=en&tailscale=${phase.seed}`, {
        waitUntil: "load",
      });
      await page.waitForSelector("[data-plugins-manage], [data-plugins-discover]", { timeout: 30_000 });
      await page.waitForTimeout(800);
      // Prefer workspace scope so featured apps (and Tailscale) are listed.
      if (await page.locator('[data-plugins-scope-option="workspace"]').count()) {
        await page.click('[data-plugins-scope-option="workspace"]');
        await page.waitForTimeout(400);
      }
      const installedPhase = phase.seed === "waiting" || phase.seed === "connected";
      if (installedPhase) {
        await page.click('[data-plugins-tab="installed"]');
        await page.waitForSelector('[data-installed-entry="tailscale:tailscale"]', { timeout: 15_000 });
      } else {
        await page.click('[data-plugins-tab="discover"]');
        await page.waitForSelector('[data-plugin-row="tailscale:tailscale"]', { timeout: 15_000 });
      }
      const row = installedPhase
        ? page.locator('[data-installed-entry="tailscale:tailscale"]').first()
        : page.locator('[data-plugin-row="tailscale:tailscale"]').first();
      await row.waitFor({ timeout: 15_000 });
      await page.waitForTimeout(400);
      await page.screenshot({
        path: join(outDir, `tailscale-row-${phase.name}-${scheme}.png`),
        fullPage: false,
      });
      if (phase.open) {
        const connect = row.locator("[data-tailscale-connect]");
        if (await connect.count()) await connect.click();
        else await row.locator("button").first().click();
        await page.waitForSelector("[data-plugins-tailscale-page]", { timeout: 15_000 });
        await page.waitForTimeout(500);
        await page.locator("[data-plugins-tailscale-page]").screenshot({
          path: join(outDir, `tailscale-page-${phase.name}-${scheme}.png`),
        });
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
