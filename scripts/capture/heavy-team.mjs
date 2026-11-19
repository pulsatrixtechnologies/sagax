#!/usr/bin/env node
/**
 * Headless screenshots of a Heavy run (#4901), dark and light: the row while
 * the agents work ("Agents thinking · 6s", the owls, the live preview), after
 * ("Thought for 8s", the Leader's answer under it) and the Thoughts panel in
 * the right-hand detail panel, live and finished. Synthetic data and demo
 * providers only. Real Chrome headless, DPR 2.
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
const port = Number(arg("--port", "5198"));
const skins = [{ id: "pulsatrix", label: "dark" }, { id: "daylight", label: "light" }];
const shots = [
  { name: "heavy-running-three-providers", query: "case=running&team=three", header: "Agents thinking · 6s" },
  { name: "heavy-running-one-provider", query: "case=running&team=single", header: "Agents thinking · 6s" },
  { name: "heavy-done", query: "case=done&team=three", header: "Thought for 8s" },
  { name: "heavy-panel-live", query: "case=panel&live=1&team=three", header: "Agents thinking · 6s", panel: true },
  { name: "heavy-panel-done", query: "case=panel&team=three", header: "Thought for 8s", panel: true, open: [1, 2] },
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
let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/heavy-team.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const exe = process.env.SAGAX_VERIFY_BROWSER_CHROME || process.env.SAGAX_CHROMIUM;
  browser = await chromium.launch({ headless: true, ...(exe ? { executablePath: exe } : {}) });
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
