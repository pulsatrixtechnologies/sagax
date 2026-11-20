#!/usr/bin/env node
/**
 * Headless screenshots of a Heavy run (#4901, #5089, #5090), dark and light:
 * the orbit while the experts propose (one pulsing, Auto's one line above),
 * while they critique (the lines), on agreement (merged into the bot), the
 * row after ("Thought for 26s", the leader's plan and the disputes) and the
 * Thoughts panel. Synthetic data and demo accounts only. Real Chrome
 * headless, DPR 2.
 * Usage: node scripts/capture/heavy-team.mjs [--out DIR] [--port N]
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "heavy-team")));
const port = Number(arg("--port", "5389"));
const skins = [{ id: "pulsatrix", label: "dark" }, { id: "daylight", label: "light" }];
const shots = [
  { name: "heavy-propose-auto", query: "case=propose&auto=risky", header: "Experts thinking · round 1 of 5 · 14s" },
  { name: "heavy-critique-lines", query: "case=critique", header: "Experts thinking · round 3 of 5 · 14s" },
  { name: "heavy-merged", query: "case=merged", header: "Thought for 14s" },
  { name: "heavy-done-decided", query: "case=done", header: "Thought for 26s" },
  { name: "heavy-panel-decided", query: "case=panel", header: "Thought for 26s", panel: true, open: [2] },
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
  const base = `http://127.0.0.1:${port}/src/gallery/heavy-team.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 2 });
  for (const { id, label } of skins) {
    for (const shot of shots) {
      await page.goto(`${base}?lang=en&skin=${id}&${shot.query}`, { waitUntil: "networkidle" });
      await page.waitForSelector("[data-heavy-header]");
      const header = await page.textContent("[data-heavy-header]");
      if (header !== shot.header) throw new Error(`${shot.name} (${label}): header reads "${header}", expected "${shot.header}"`);
      if (shot.panel) {
        await page.waitForSelector("[data-thoughts-panel]");
        for (const n of shot.open ?? []) await page.click(`[data-thoughts-agent="${n}"] button`);
      }
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
