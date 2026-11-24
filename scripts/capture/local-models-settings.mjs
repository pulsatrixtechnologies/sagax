#!/usr/bin/env node
/**
 * Headless screenshots of Settings > Local models (D-20261123-023,
 * M-20261123-040, M-20261123-047), dark and light, in French: the people and
 * teams the computer's models are shared with, the whole organization, and a
 * server declared on a port of the person's own with its remove control.
 * Synthetic data and demo accounts only. Real Chrome headless, DPR 2.
 * Usage: node scripts/capture/local-models-settings.mjs [--out DIR] [--port N]
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "local-models-settings")));
const port = Number(arg("--port", "5392"));
const skins = [{ id: "pulsatrix", label: "dark" }, { id: "daylight", label: "light" }];
const shots = [
  { name: "local-models-shared-none", query: "case=none", recipients: "0" },
  { name: "local-models-shared-chosen", query: "case=chosen", recipients: "3" },
  { name: "local-models-shared-org", query: "case=org", recipients: "3" },
  { name: "local-models-search", query: "case=none", recipients: "0", search: "p" },
];

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Vite gallery did not start at ${url}`);
}

const vite = spawn(
  process.execPath,
  [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" } },
);
// drain Vite's output: a full pipe stalls the dev server mid-page
vite.stdout.resume();
vite.stderr.resume();
let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/local-models-settings.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 900, height: 860 }, deviceScaleFactor: 2 });
  for (const { id, label } of skins) {
    for (const shot of shots) {
      await page.goto(`${base}?lang=fr&skin=${id}&${shot.query}`, { waitUntil: "networkidle" });
      await page.waitForSelector(`[data-local-models-recipients="${shot.recipients}"]`);
      await page.waitForSelector('[data-loopback-server="http://127.0.0.1:8100/v1"]');
      if (shot.search) {
        await page.fill("[data-local-models-recipients] input[type=search]", shot.search);
        await page.waitForSelector("[data-local-models-recipients] [role=option]");
      }
      // the line under the organization switch, as the person reads it in this state
      console.log(`${shot.name}: ${await page.locator('[data-settings-row="localModels.share"]').innerText().catch(() => "(row text not read)")}`);
      await page.mouse.move(2, 2);
      await page.waitForTimeout(250);
      const file = join(outDir, `${shot.name}-${label}.png`);
      await page.screenshot({ path: file });
      console.log(file);
    }
  }
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
