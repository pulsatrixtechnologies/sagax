#!/usr/bin/env node
/**
 * Headless screenshots of the bot panel's Coding branches beside Routines
 * (src/gallery/bot-panel-coding.html), light and dark: the panel, a branch's
 * "..." menu, the commit dialog and the diff. The script answers /api itself
 * (each branch read now, its pull request, a diff). Headless Chromium only:
 * no window opens.
 * Usage: node scripts/capture-bot-panel-coding.mjs [--out DIR] [--port N] [--before]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 *   --before: the gallery as it is on a build without the branch actions
 *   (only the panel is captured).
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "bot-panel-coding"));
const port = Number(arg("--port") ?? 5287);
const before = process.argv.includes("--before");
const skins = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];

const state = (extra) => ({ exists: true, pushed: false, ahead: 0, behind: 0, changes: [], base: "main", worktree: "/srv/web-wt", ...extra });
const INFO = {
  "feat/it-tools-widgets": { state: state({ ahead: 2, changes: [{ path: "src/widgets/grid.tsx", status: "modified" }, { path: "src/widgets/tools.ts", status: "untracked" }, { path: "src/widgets/old.ts", status: "deleted" }] }), proposedMessage: "Add the IT tools widgets" },
  "feat/search-index": { state: state({ pushed: true, ahead: 1 }) },
  "feat/dark-mode": { state: state({ pushed: true }) },
  "fix/lexer": { state: state({ pushed: true, worktree: undefined }) },
  "spike/old-parser": { state: state({ ahead: 3, worktree: undefined }) },
};
// Branches whose repository is on the bot's own computer (place "remote"):
// one actionable (its actions run there), one with the computer offline. The
// `/code/branch` reply returns these verbatim instead of the server default.
const REMOTE = {
  "feat/on-bot-computer": { branch: "feat/on-bot-computer", place: "remote", host: "Studio de Max", folderName: "web", repo: "acme/web", canPublish: true, state: state({ ahead: 1, changes: [{ path: "src/widgets/grid.tsx", status: "modified" }, { path: "src/widgets/tools.ts", status: "untracked" }] }), proposedMessage: "Add the IT tools widgets" },
  "feat/bot-offline": { branch: "feat/bot-offline", place: "remote", host: "Studio de Max", offline: true, canPublish: false, publishBlocked: "offline" },
};
const PULL = {
  "feat/dark-mode": { number: 42, url: "https://github.com/acme/web/pull/42", state: "open" },
  "fix/lexer": { number: 37, url: "https://github.com/acme/web/pull/37", state: "merged" },
  "feat/search-index": null,
};
const DIFF = {
  base: "main",
  truncated: false,
  files: [{
    path: "src/widgets/grid.tsx", status: "modified", added: 3, removed: 1,
    hunks: [{ header: "@@ -1,4 +1,6 @@", lines: [
      { kind: "ctx", old: 1, new: 1, text: "import { Tool } from \"./tools\";" },
      { kind: "del", old: 2, text: "export const columns = 2;" },
      { kind: "add", new: 2, text: "export const columns = 3;" },
      { kind: "add", new: 3, text: "export const gap = 12;" },
      { kind: "add", new: 4, text: "export const title = \"IT tools\";" },
      { kind: "ctx", old: 3, new: 5, text: "" },
    ] }],
  }],
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
  // its own process group: pnpm starts vite as a grandchild, and stopping
  // the group stops them all
  detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

try {
  const base = `http://127.0.0.1:${port}/src/gallery/bot-panel-coding.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  // SAGAX_VERIFY_BROWSER_CHROME: an installed Chromium when Playwright's own
  // download is not there.
  const browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  const page = await browser.newPage({ viewport: { width: 380, height: 1100 }, deviceScaleFactor: 2 });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const branch = url.searchParams.get("branch") ?? "";
    const reply = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname.endsWith("/code/branch")) return reply(REMOTE[branch] ?? { branch, place: "server", folderName: "web", repo: "acme/web", canPublish: true, ...INFO[branch] });
    if (url.pathname.endsWith("/code/branch/pull")) return reply({ pull: PULL[branch] ?? null });
    if (url.pathname.endsWith("/code/branch/diff")) return reply(DIFF);
    if (url.pathname.endsWith("/code/branches/archived")) return reply({ keys: [] });
    return reply({ error: "not in this gallery" }, 404);
  });
  for (const { id, label } of skins) {
    await page.goto(`${base}?skin=${id}&lang=fr`, { waitUntil: "load" });
    await page.waitForSelector('[data-bot-settings-section="routines"]');
    const panel = page.locator("[data-gallery-panel]");
    if (!before) {
      await page.waitForSelector('[data-branch-status="merged"]');
      await page.waitForFunction(() => document.body.textContent?.includes("2 commits en avance"));
    }
    await panel.screenshot({ path: join(outDir, `${before ? "before" : "after"}-panel-${label}.png`) });
    if (before) continue;
    // archived branches shown
    await page.click("[data-show-archived-branches]");
    await page.waitForSelector("[data-branch-archived]");
    await panel.screenshot({ path: join(outDir, `after-archived-${label}.png`) });
    await page.click("[data-show-archived-branches]");
    // the "..." menu of the branch not pushed
    await page.click('[data-branch-menu-button="feat/it-tools-widgets"]');
    await page.waitForSelector("[data-branch-menu]");
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(outDir, `after-menu-${label}.png`), clip: { x: 0, y: 0, width: 380, height: 760 } });
    await page.keyboard.press("Escape");
    // the "..." menu of a branch on the bot's own computer: its actions are
    // enabled (they run on that computer), not greyed out.
    await page.click('[data-branch-menu-button="feat/on-bot-computer"]');
    await page.waitForSelector("[data-branch-menu]");
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(outDir, `after-menu-bot-computer-${label}.png`), clip: { x: 0, y: 0, width: 380, height: 820 } });
    await page.keyboard.press("Escape");
    // the same, but the bot's computer is offline: one plain reason.
    await page.click('[data-branch-menu-button="feat/bot-offline"]');
    await page.waitForSelector("[data-branch-menu]");
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(outDir, `after-menu-offline-${label}.png`), clip: { x: 0, y: 0, width: 380, height: 820 } });
    await page.keyboard.press("Escape");
    await page.click('[data-branch-menu-button="feat/it-tools-widgets"]');
    // the commit dialog
    await page.click('[data-branch-menu] [data-menu-item="commit"]');
    await page.waitForSelector("[data-branch-commit]");
    await page.waitForTimeout(300);
    await page.setViewportSize({ width: 760, height: 620 });
    await page.screenshot({ path: join(outDir, `after-commit-${label}.png`) });
    await page.keyboard.press("Escape");
    // the diff
    await page.setViewportSize({ width: 380, height: 1100 });
    await page.click('[data-branch-menu-button="feat/it-tools-widgets"]');
    await page.click('[data-branch-menu] [data-menu-item="diff"]');
    await page.waitForSelector('[data-branch-diff] [data-testid="branch-diff"], [data-branch-diff] table, [data-branch-diff] pre', { timeout: 10_000 }).catch(() => {});
    await page.setViewportSize({ width: 900, height: 620 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(outDir, `after-diff-${label}.png`) });
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 380, height: 1100 });
  }
  await browser.close();
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(error);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  try { process.kill(-vite.pid, "SIGTERM"); } catch { vite.kill("SIGTERM"); }
}
