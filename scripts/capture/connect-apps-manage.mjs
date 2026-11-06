#!/usr/bin/env node
/**
 * Headless screenshots of Plugins (Playwright, no window): the real panel in
 * the gallery (src/gallery/connect-apps.html?view=manage, a stand-in /api
 * shaped like an organization member's, or an admin's with --role admin).
 * #2104 (2026-11-05): three tabs, Installed first (where a person lands),
 * Discover, Sources; the one "+ Add" menu; the "..." menu of an entry and its
 * "For which bots"; a plugin's page; the bot's scope on every tab (the tab row
 * must not move, checked here); Bots and Pages opened alone from a link
 * (?page=bots|pages), with their back arrow; for an admin, Settings >
 * Organization too; and a Settings sub-page in the same window size to compare.
 * Usage: node scripts/capture/connect-apps-manage.mjs [--out DIR] [--port N]
 *   [--lang fr] [--skin pulsatrix] [--scheme dark|light] [--role member|admin]
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "connect-apps-manage")));
const port = Number(arg("--port", "5297"));
const lang = arg("--lang", "fr");
const scheme = arg("--scheme", "dark");
const skin = arg("--skin", scheme === "light" ? "pulsatrix-light" : "pulsatrix");
const role = arg("--role", "member");

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { const res = await fetch(url); if (res.status < 500) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Vite gallery did not start at ${url}`);
}

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
  const base = `http://127.0.0.1:${port}/src/gallery/connect-apps.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 1200, height: 1500 }, deviceScaleFactor: 2, colorScheme: scheme });
  page.on("pageerror", (error) => console.error("page error:", error.stack));
  const query = `skin=${skin}&lang=${lang}&role=${role}`;
  await page.goto(`${base}?view=manage&${query}`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-plugins-manage]", { timeout: 30_000 });
  // #2104: Installed first and where the page opens; three tabs; no "N connected" button
  const TABS = ["installed", "discover", "sources"];
  const order = await page.locator("[data-plugins-tab]").evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("data-plugins-tab")));
  if (order.join(",") !== TABS.join(",")) throw new Error(`tab order: ${order.join(",")}`);
  if (await page.locator('[data-plugins-tab="installed"][aria-selected="true"]').count() !== 1) throw new Error("Plugins did not open on Installed");
  if (await page.locator("[data-plugins-connected]").count()) throw new Error("the N connected button is back");
  const once = async (selector, what) => {
    const n = await page.locator(selector).count();
    if (n !== 1) throw new Error(`${what}: ${n} on screen, wanted one`);
  };
  await page.waitForTimeout(600);
  const shot = async (name) => {
    await page.waitForTimeout(700);
    const file = join(outDir, `${name}.png`);
    await page.locator('[role="dialog"]').first().screenshot({ path: file });
    console.log("shot", file);
  };
  await shot("0-plugins");
  // every option once: one scope bar, one search, one refresh, one + Add
  await once("[data-plugins-scope]", "scope bar");
  await once("[data-plugins-search]", "search");
  await once('button[aria-label^="Refresh"], button[aria-label^="Actualiser"]', "refresh button");
  await once("[data-plugins-add]", "+ Add menu");
  for (const [index, tab] of TABS.entries()) {
    await page.click(`[data-plugins-tab="${tab}"]`);
    await page.waitForSelector(`[data-plugins-manage="${tab}"]`);
    if (tab === "installed") await page.waitForSelector("[data-harness-group]", { timeout: 15_000 }).catch(() => undefined);
    if (tab === "sources") await page.waitForTimeout(800);
    await shot(`${index + 1}-${tab}`);
    if (tab === "installed") {
      await page.click("[data-plugins-add]");
      await page.waitForSelector("[data-plugins-add-action]");
      await shot("1b-installed-add-menu");
      if (await page.locator('[data-plugins-add-action="server"]').count()) {
        await page.click('[data-plugins-add-action="server"]');
        await shot("1c-installed-add-server");
        await page.click("[data-mcp-editor-cancel]");
        await page.waitForSelector('[data-plugins-manage="installed"]');
      } else {
        await page.keyboard.press("Escape");
      }
      const accounts = page.locator("[data-plugins-providers]");
      if (await accounts.count()) {
        await accounts.first().scrollIntoViewIfNeeded();
        await shot("1d-installed-accounts");
      }
      if (await page.locator('[data-accounts-service-pill]').count()) throw new Error("the service pills are back");
    }
    if (tab === "sources" && role === "admin") {
      // the organization's sources and access: the Organization scope
      await page.click('[data-plugins-scope-option="workspace"]');
      await page.locator("[data-plugins-sources-admin]").scrollIntoViewIfNeeded();
      await shot("3b-sources-admin");
      await page.click('[data-plugins-scope-option="me"]');
      await page.waitForSelector('[data-plugins-manage="sources"]');
    }
  }
  // the tab row stays where it is on every tab (the scope bar never leaves)
  const tabRowTop = async () => (await page.locator("[data-plugins-manage-tabs]").boundingBox())?.y;
  const tops = {};
  for (const tab of TABS) {
    await page.click(`[data-plugins-tab="${tab}"]`);
    await page.waitForSelector(`[data-plugins-manage="${tab}"]`);
    tops[tab] = await tabRowTop();
  }
  console.log("tab row top (everyone):", JSON.stringify(tops));
  if (new Set(Object.values(tops)).size !== 1) throw new Error(`the tab row moves between tabs: ${JSON.stringify(tops)}`);
  await page.click('[data-plugins-tab="installed"]');
  await page.locator('[data-installed-entry="plugin:code-review@claude-plugins-official"] [data-entry-menu]').click();
  await shot("6-installed-menu-update");
  await page.keyboard.press("Escape");
  // the installed entry every scope has in the gallery (Code Review); GitHub is
  // installed for the organization only
  const ENTRY = '[data-installed-entry="plugin:code-review@claude-plugins-official"]';
  // "For which bots" needs an entry that brings MCP servers: GitHub, installed
  // for the organization (an admin's scope)
  if (await page.locator('[data-plugins-scope-option="workspace"]').count()) {
    const GITHUB = '[data-installed-entry="plugin:github@claude-plugins-official"]';
    await page.click('[data-plugins-scope-option="workspace"]');
    await page.waitForSelector(GITHUB);
    await page.locator(`${GITHUB} [data-entry-menu]`).click();
    await page.click('[data-entry-action="bots"]');
    await page.waitForSelector("[data-plugins-bots-for]");
    await shot("7-for-which-bots");
    await page.click('[data-plugins-tab="installed"]');
    await page.locator(`${GITHUB} button`).first().click();
    await page.waitForSelector("[data-plugins-detail]");
    await shot("8-detail-github");
    await page.click('[data-plugins-back]');
    await page.waitForSelector('[data-plugins-manage="installed"]');
    await page.click('[data-plugins-scope-option="me"]');
  }
  // a plugin's page, in its tab
  await page.click('[data-plugins-tab="installed"]');
  await page.locator(`${ENTRY} button`).first().click();
  await page.waitForSelector("[data-plugins-detail]");
  await shot("8-detail-code-review-update");
  await page.click('[data-plugins-back]');
  await page.waitForSelector('[data-plugins-manage="installed"]');
  // the bot's scope: every tab, then the same plugin's page for the bot
  if (await page.locator('[data-plugins-scope-option="bot"]').count()) {
    await page.click('[data-plugins-tab="installed"]');
    await page.click('[data-plugins-scope-option="bot"]');
    await page.waitForTimeout(500);
    const botTops = {};
    for (const tab of TABS) {
      await page.click(`[data-plugins-tab="${tab}"]`);
      await page.waitForSelector(`[data-plugins-manage="${tab}"]`);
      botTops[tab] = await tabRowTop();
      await shot(`9-bot-${tab}`);
    }
    console.log("tab row top (bot):", JSON.stringify(botTops));
    if (new Set(Object.values(botTops)).size !== 1) throw new Error(`the tab row moves between tabs (bot): ${JSON.stringify(botTops)}`);
    // the plugin's page for the person, then the scope turned to the bot on that page
    await page.click('[data-plugins-scope-option="me"]');
    await page.click('[data-plugins-tab="installed"]');
    await page.locator(`${ENTRY} button`).first().click();
    await page.waitForSelector("[data-plugins-detail]");
    await page.click('[data-plugins-scope-option="bot"]');
    await page.waitForTimeout(500);
    await shot("9b-bot-detail-code-review");
    await page.click('[data-plugins-scope-option="me"]').catch(() => undefined);
  }
  // Bots and Pages opened alone from a link (#2104): own title, back arrow, no tabs, no scope
  for (const pane of ["bots", "pages"]) {
    await page.goto(`${base}?view=manage&page=${pane}&${query}`, { waitUntil: "networkidle" });
    await page.waitForSelector(`[data-plugins-standalone="${pane}"]`, { timeout: 30_000 });
    if (await page.locator("[data-plugins-manage-tabs]").count()) throw new Error(`${pane} alone shows the tab row`);
    if (await page.locator("[data-plugins-scope]").count()) throw new Error(`${pane} alone shows the scope`);
    await once("[data-apps-back]", `${pane} back arrow`);
    await shot(`11-${pane}-alone`);
    await page.click("[data-apps-back]");
    await page.waitForSelector('[data-plugins-manage="installed"]');
  }
  await page.goto(`${base}?view=settings-subpage&${query}`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-settings-subpage]");
  await shot("10-settings-subpage");
  if (role === "admin") {
    await page.goto(`${base}?view=org-settings&${query}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    const file = join(outDir, "9-settings-organization.png");
    await page.screenshot({ path: file, fullPage: true });
    console.log("shot", file);
  }
} catch (error) {
  console.error(error);
  console.error(viteLog.slice(-4000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
