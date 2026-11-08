#!/usr/bin/env node
/**
 * Headless screenshots of the plan usage history gallery (#2757, Playwright,
 * no window): Settings > Usage with the Plan fold and the history fold open,
 * dark and light, English and French, plus the second "Claude" account.
 * Mocked periods only; no server.
 * Usage: node scripts/capture/plan-usage-history.mjs [--out DIR] [--port N]
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "plan-usage-history-2757")));
const port = Number(arg("--port", "5193"));

const shots = [
  { skin: "pulsatrix", label: "dark", lang: "en" },
  { skin: "daylight", label: "light", lang: "en" },
  { skin: "pulsatrix", label: "dark", lang: "fr" },
  { skin: "daylight", label: "light", lang: "fr" },
  { skin: "daylight", label: "light", lang: "en", account: "claude-pro" },
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

// vite itself, not through pnpm: a SIGTERM must reach the process that listens
const vite = spawn(
  process.execPath,
  [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" } },
);
let viteLog = "";
vite.stdout?.on("data", (c) => { viteLog += c; });
vite.stderr?.on("data", (c) => { viteLog += c; });

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/plan-usage-history.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 760, height: 1800 }, deviceScaleFactor: 2 });
  for (const { skin, label, lang, account } of shots) {
    await page.goto(`${base}?skin=${skin}&lang=${lang}${account ? `&account=${account}` : ""}`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-plan-history]", { state: "attached", timeout: 60_000 });
    for (const card of ["usage.planDetail", "usage.planHistory"]) {
      const fold = page.locator(`[data-settings-card="${card}"]`);
      if ((await fold.getAttribute("data-open")) !== "true") await fold.locator("button[aria-controls]").first().click();
    }
    await page.waitForTimeout(300);
    const path = join(outDir, `usage-${lang}-${label}${account ? `-${account}` : ""}.png`);
    await page.locator('[data-gallery-sample="usage"]').screenshot({ path });
    console.log(`wrote ${path}`);
  }
} catch (failure) {
  console.error(failure);
  console.error(viteLog.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
