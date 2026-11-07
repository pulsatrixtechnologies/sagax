#!/usr/bin/env node
/**
 * #2045: Sidebar and Team map for two people (src/gallery/team-isolation.html),
 * headless Chrome only. Shots per person, with ?before=1 for the old team list.
 * Prints the team ids each sidebar shows.
 *
 *   node scripts/capture/team-isolation.mjs --out DIR [--port N] [--label after]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = resolve(arg("--out", join(here, "docs", "screenshots", "team-isolation")));
const port = Number(arg("--port", "5191"));
const label = arg("--label", "after");
const before = label === "before";
const chrome = process.env.SAGAX_CHROMIUM || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`gallery did not start at ${url}`);
}

await mkdir(outDir, { recursive: true });
const vite = spawn(process.execPath,
  [join(here, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: here, stdio: "ignore" });
let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/team-isolation.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  for (const person of ["anne", "benoit"]) {
    const page = await browser.newPage({ viewport: { width: 1480, height: 860 }, deviceScaleFactor: 2 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.goto(`${base}?person=${person}${before ? "&before=1" : ""}`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-sidebar-section-id]", { timeout: 30_000 });
    await page.waitForTimeout(2500);
    const teams = await page.evaluate(() => [...document.querySelectorAll("[data-sidebar-section-id]")].map((node) => node.getAttribute("data-sidebar-section-id")));
    const file = `${label}-${person}.png`;
    await page.screenshot({ path: join(outDir, file) });
    console.log(JSON.stringify({ file, person, sidebarTeams: teams, errors }));
    await page.close();
  }
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
