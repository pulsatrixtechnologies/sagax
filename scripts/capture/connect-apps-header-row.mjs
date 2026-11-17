#!/usr/bin/env node
/**
 * The control row of Connect Apps is ONE line at every window width. Headless:
 * for each width (French and English, with and without the update pill) it
 * measures the row (height, horizontal overflow, the parts' tops) and prints
 * the layout it chose; the French dark ones with the pill are saved as images.
 * Usage: node scripts/capture/connect-apps-header-row.mjs [--out DIR] [--port N] [--widths 700,820,950,1100,1280]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; };
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "connect-apps-header-row")));
const port = Number(arg("--port", "5201"));
const widths = arg("--widths", "700,820,950,1100,1280").split(",").map(Number);
const vite = spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: root, stdio: "ignore", env: { ...process.env, NODE_ENV: "development" } });
let browser;
let failed = false;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/connect-apps.html`;
  for (let i = 0; i < 240; i++) { try { const res = await fetch(base); if (res.status < 500) break; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 500)); }
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM } : { channel: "chrome" }) });
  for (const lang of ["fr", "en"]) for (const scheme of ["dark", "light"]) for (const pill of [true, false]) {
    if (scheme === "light" && lang === "fr") continue;
    for (const width of widths) {
      const page = await (await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 2, colorScheme: scheme })).newPage();
      for (const view of ["installed", "discover"]) {
        await page.goto(`${base}?view=manage&role=member&products=many${pill ? "&updates=1" : ""}&skin=${scheme === "light" ? "pulsatrix-light" : "pulsatrix"}&lang=${lang}`, { waitUntil: "networkidle" });
        await page.waitForSelector("[data-plugins-main]", { timeout: 30_000 });
        await page.click('[data-plugins-kind-tab="plugins"]');
        await page.click(`[data-plugins-view="${view}"]`);
        await page.waitForTimeout(500);
        const m = await page.evaluate(() => {
          const row = document.querySelector("[data-plugins-kind-row]");
          const box = row.getBoundingClientRect();
          const tops = [...row.querySelectorAll("[data-plugins-kinds], [data-plugins-views], [data-plugins-add], [data-plugins-update-all], [data-plugins-search-slot], [data-plugins-search-toggle]")].map((node) => { const r = node.getBoundingClientRect(); return Math.round(r.top + r.height / 2); });
          const parts = [...row.querySelectorAll("[data-plugins-kinds], [data-plugins-views], [data-plugins-add], [data-plugins-update-all], [data-plugins-search-slot], [data-plugins-search-toggle], [data-plugins-search-controls]")];
          const right = Math.max(...parts.map((node) => node.getBoundingClientRect().right));
          const frame = row.closest("[role=dialog]")?.getBoundingClientRect();
          const kinds = [...row.querySelectorAll("[data-plugins-kind-tab]")].map((tab) => tab.scrollWidth <= tab.clientWidth + 1);
          return { layout: row.getAttribute("data-plugins-layout"), height: Math.round(box.height), oneLine: Math.max(...tops) - Math.min(...tops) <= 1, overflow: right > box.right + 0.5 || row.scrollWidth > row.clientWidth + 1, rowWidth: Math.round(box.width), frame: Math.round(frame?.width ?? 0), kindsWhole: kinds.every(Boolean) };
        });
        const ok = m.height <= 34 && m.oneLine && !m.overflow && m.kindsWhole;
        if (!ok) failed = true;
        console.log(ok ? "ok  " : "FAIL", lang, scheme, pill ? "pill" : "nopill", view, width, JSON.stringify(m));
        if (lang === "fr" && scheme === "dark" && pill) await page.screenshot({ path: join(outDir, `header-row-${view}-${width}x800-dark-fr.png`) });
      }
      await page.close();
    }
  }
} catch (error) {
  console.error(error);
  failed = true;
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
  process.exitCode = failed ? 1 : 0;
}
