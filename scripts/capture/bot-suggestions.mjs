#!/usr/bin/env node
/**
 * Headless screenshots of the bot panel's Suggestions card (#4250 S6,
 * src/gallery/bot-suggestions.html): an open fix card of the server, what a
 * routine needs, a conversation waiting on the person, a saving the server
 * proposed and a setup step, in the bot panel's width. French and English,
 * light. Headless Chrome only: no window opens.
 * Usage: node scripts/capture/bot-suggestions.mjs [--out DIR] [--port N] [--prefix before|after]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "bot-suggestions"));
const port = Number(arg("--port") ?? 5351);
const prefix = arg("--prefix") ?? "after";

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const words = {
  fr: { fix: "Tableau de billets a besoin d'une correction", saving: "Tableau de billets pourrait rouler sans réveiller son bot" },
  en: { fix: "Ticket board needs a fix", saving: "Ticket board could run without waking its bot" },
};

const vite = spawn("pnpm", ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" },
  // its own process group: stopping the group stops pnpm and vite
  detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/bot-suggestions.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : { channel: "chrome" }) });
  for (const lang of ["fr", "en"]) {
    const page = await browser.newPage({ viewport: { width: 440, height: 760 }, deviceScaleFactor: 2 });
    page.setDefaultNavigationTimeout(120_000);
    page.on("pageerror", (error) => { console.error("pageerror", error.message); });
    await page.route("**/api/**", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/overview")) {
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ setup: [{ id: "apps", label: "apps", done: false }] }) });
      }
      if (url.pathname === "/api/approvals" && url.searchParams.get("waiting") === "1") {
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ waiting: [
          { id: "q1", kind: "question", threadId: "t1", title: words[lang].fix, message: { kind: "options", card: { askKey: "routine-problem:r1" } } },
          { id: "q2", kind: "question", threadId: "t1", title: words[lang].saving, message: { kind: "options", card: { askKey: "routine-cheap-path:r1" } } },
        ] }) });
      }
      return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not in this gallery" }) });
    });
    await page.goto(`${base}?skin=daylight&lang=${lang}`);
    await page.waitForSelector("[data-suggestion]");
    await page.waitForTimeout(800);
    const file = join(outDir, `${prefix}-${lang}.png`);
    await page.locator("[data-gallery-panel]").screenshot({ path: file });
    console.log(file);
    await page.close();
  }
} catch (error) {
  console.error(error);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* gone */ }
}
