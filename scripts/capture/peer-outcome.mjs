#!/usr/bin/env node
/**
 * #4238: headless screenshots of what a teammate's requests left for the
 * person, through the real ChatView (gallery ask-line, side=outcome), side
 * by side with the same chat before the change (side=outcome&before=1: the
 * same three requests, the "Asked by" line alone). English and French; the line's
 * exchange opened with its outcome; the "Asked by" line opened on a request.
 * Usage: node scripts/capture/peer-outcome.mjs [--out DIR] [--port N]
 * Files: <lang>-side-by-side.png, <lang>-beside-neighbour.png, <lang>-line-open.png, <lang>-asked-by-open.png
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "peer-outcome")));
const port = Number(arg("--port", "5342"));

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
  const base = `http://127.0.0.1:${port}/src/gallery/ask-line.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  for (const lang of ["en", "fr"]) {
    // before (the same chat without outcomes) beside after, then the
    // conforming neighbour (the "Asked by" receiver page) beside after
    for (const [name, left] of [["side-by-side", "side=outcome&before=1"], ["beside-neighbour", "side=receiver"]]) {
      const pair = await browser.newPage({ viewport: { width: 1600, height: 760 }, deviceScaleFactor: 2 });
      await pair.setContent(`<!doctype html><html><body style="margin:0;display:flex;gap:8px;background:#888">
        <iframe src="${base}?lang=${lang}&${left}&n=2&state=done" style="border:0;width:796px;height:760px"></iframe>
        <iframe src="${base}?lang=${lang}&side=outcome&n=2&state=done" style="border:0;width:796px;height:760px"></iframe>
      </body></html>`);
      await pair.waitForTimeout(2500);
      const file = join(outDir, `${lang}-${name}.png`);
      await pair.screenshot({ path: file });
      console.log(file);
      await pair.close();
    }

    const page = await browser.newPage({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 2 });
    for (const shot of [{ name: "line-open", open: "[data-peer-outcome-open]" }, { name: "asked-by-open", open: "[data-testid=incoming-line] button" }]) {
      await page.goto(`${base}?lang=${lang}&side=outcome&n=2&state=done`, { waitUntil: "networkidle" });
      await page.waitForTimeout(400);
      const target = page.locator(shot.open);
      if (await target.count()) await target.last().click();
      await page.waitForTimeout(800);
      const path = join(outDir, `${lang}-${shot.name}.png`);
      await page.screenshot({ path, fullPage: true });
      console.log(path);
    }
    await page.close();
  }
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
