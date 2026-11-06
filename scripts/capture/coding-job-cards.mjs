#!/usr/bin/env node
/**
 * Headless screenshots for #2148, light and dark: the coding job card in the
 * bot's chat (running and finished, src/gallery/coding-job-cards.html), the
 * bot panel's Coding section with the clean branch rows
 * (src/gallery/bot-panel-coding.html), and a pushed branch's "..." menu
 * (details, Open on GitHub, Copy link, Ignore). The script answers /api
 * itself. Headless Chromium only: no window opens.
 * Usage: node scripts/capture/coding-job-cards.mjs [--out DIR] [--port N]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "coding-job-cards"));
const port = Number(arg("--port") ?? 5191);
const skins = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];

const state = (extra) => ({ exists: true, pushed: false, ahead: 0, behind: 0, changes: [], base: "main", worktree: "/srv/web-wt", ...extra });
const INFO = {
  "feat/it-tools-widgets": { state: state({ ahead: 2, changes: [{ path: "src/widgets/grid.tsx", status: "modified" }] }) },
  "feat/on-bot-computer": { place: "remote", computer: "remote_session", host: "Studio", state: state({ ahead: 1 }) },
  "feat/search-index": { place: "remote", computer: "desktop", state: state({ pushed: true, ahead: 1 }) },
  "feat/dark-mode": { state: state({ pushed: true }) },
  "fix/lexer": { state: state({ pushed: true, worktree: undefined }) },
};
const PULL = {
  "feat/dark-mode": { number: 42, url: "https://github.com/acme/web/pull/42", state: "open" },
  "fix/lexer": { number: 37, url: "https://github.com/acme/web/pull/37", state: "merged" },
};

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const vite = spawn("pnpm", ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" },
  detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

let browser;
try {
  const gallery = `http://127.0.0.1:${port}/src/gallery`;
  await waitForServer(`${gallery}/coding-job-cards.html`);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  const page = await browser.newPage({ viewport: { width: 820, height: 520 }, deviceScaleFactor: 2 });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const branch = url.searchParams.get("branch") ?? "";
    const reply = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname.endsWith("/code/branch")) return reply({ branch, place: "server", folderName: "web", repo: "acme/web", canPublish: true, ...(INFO[branch] ?? { state: state({}) }) });
    if (url.pathname.endsWith("/code/branch/pull")) return reply({ pull: PULL[branch] ?? null });
    if (url.pathname.endsWith("/code/branches/archived")) return reply({ keys: [] });
    return reply({ error: "not in this gallery" }, 404);
  });
  for (const { id, label } of skins) {
    // the chat: a finished job above a running one
    await page.setViewportSize({ width: 820, height: 520 });
    await page.goto(`${gallery}/coding-job-cards.html?skin=${id}&lang=fr`, { waitUntil: "load" });
    await page.waitForSelector('[data-coding-job-state="running"]');
    await page.waitForSelector('[data-coding-job-state="finished"]');
    await page.waitForTimeout(300);
    await page.locator("[data-gallery-chat]").screenshot({ path: join(outDir, `chat-cards-${label}.png`) });
    await page.locator('[data-coding-job-state="running"]').screenshot({ path: join(outDir, `chat-card-running-${label}.png`) });
    await page.locator('[data-coding-job-state="finished"]').screenshot({ path: join(outDir, `chat-card-finished-${label}.png`) });
    // the panel's Coding section, branch rows clean
    await page.setViewportSize({ width: 380, height: 1100 });
    await page.goto(`${gallery}/bot-panel-coding.html?skin=${id}&lang=fr`, { waitUntil: "load" });
    await page.waitForSelector('[data-branch-status="merged"]');
    await page.waitForTimeout(400);
    await page.locator('[data-bot-settings-section="coding"]').screenshot({ path: join(outDir, `panel-coding-${label}.png`) });
    // a pushed branch's "..." menu: details, GitHub, copy link, Ignore
    await page.click('[data-branch-menu-button="feat/search-index"]');
    await page.waitForSelector('[data-branch-menu] [data-menu-item="ignore"]');
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(outDir, `branch-menu-${label}.png`), clip: { x: 0, y: 0, width: 380, height: 1100 } });
    await page.keyboard.press("Escape");
  }
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(error);
  console.error(log.slice(-3000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  try { process.kill(-vite.pid, "SIGTERM"); } catch { vite.kill("SIGTERM"); }
}
