#!/usr/bin/env node
/**
 * The sidebar's bot row menu and a bot's own window (#4639), headless.
 * Real Sidebar and ChatView on the synthetic gallery store
 * (src/gallery/app-shell-sidebar.html), light and dark, en and fr:
 *   - menu-<theme>-<lang>.png: right-click on a bot row, the menu open.
 *   - window-<theme>-<lang>.png: `?window=chat`, the compact bot window
 *     (BotChatWindow: chat header with the mascot, name and "...", the
 *     conversation, the composer; no sidebar), 480x760 like the desktop one.
 * capture.json holds what the DOM says: the entries in order with their
 * icons, the separators between them, the menu's width and row height, the
 * Delete colour, and that the window has no sidebar.
 *
 *   node scripts/capture/bot-context-menu.mjs [--out DIR] [--port N]
 *
 * SAGAX_CHROMIUM overrides the Chrome binary.
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = resolve(arg("--out", "/Users/Workspace/artifacts/bot-context-menu-2026-11-17"));
const port = Number(arg("--port", "5178"));
const chrome = process.env.SAGAX_CHROMIUM || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const themes = [{ theme: "dark", skin: "pulsatrix" }, { theme: "light", skin: "daylight" }];
const langs = ["en", "fr"];

async function waitForServer(url, ms = 180_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

function readMenu() {
  const menu = document.querySelector("[data-bot-menu]");
  const box = menu.getBoundingClientRect();
  const kids = [...menu.children];
  const entries = kids.map((node) => {
    if (node.matches(".menu-divider, [role='separator']")) return { separator: true };
    const r = node.getBoundingClientRect();
    return {
      id: node.getAttribute("data-menu-item"),
      label: node.textContent.trim(),
      icon: node.querySelector("svg")?.getAttribute("class")?.match(/lucide-[\w-]+/)?.[0] ?? null,
      height: Math.round(r.height * 10) / 10,
      color: getComputedStyle(node).color,
    };
  });
  const rows = entries.filter((e) => !e.separator);
  return {
    width: Math.round(box.width),
    padding: getComputedStyle(menu).padding,
    radius: getComputedStyle(menu).borderRadius,
    entries,
    groups: entries.reduce((acc, e) => { if (e.separator) acc.push([]); else acc.at(-1).push(e.id); return acc; }, [[]]),
    rowHeights: [...new Set(rows.map((e) => e.height))],
    deleteColor: rows.find((e) => e.id === "delete")?.color,
    idleColor: rows.find((e) => e.id === "pin")?.color,
  };
}

function readWindow() {
  const root = document.querySelector("[data-bot-chat-window]");
  const header = document.querySelector("[data-chat-header-bar]");
  const composer = document.querySelector("[data-composer-dock] textarea");
  return {
    hasSidebar: Boolean(document.querySelector("aside[data-sidebar]")),
    header: header ? { text: header.textContent.trim().slice(0, 60), hasMenuButton: Boolean(header.querySelector("button[aria-haspopup='menu']")), hasMascot: Boolean(header.querySelector("svg, canvas, img, [data-owl], .shape-mascot")) } : null,
    composerPlaceholder: composer?.getAttribute("placeholder") ?? null,
    viewport: { width: innerWidth, height: innerHeight },
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    rootBox: root ? (({ width, height }) => ({ width: Math.round(width), height: Math.round(height) }))(root.getBoundingClientRect()) : null,
  };
}

const vite = spawn(
  process.execPath,
  [join(here, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: here, stdio: "ignore", env: { ...process.env, NODE_ENV: "development" } },
);
let browser;
const notes = [];
try {
  const base = `http://127.0.0.1:${port}/src/gallery/app-shell-sidebar.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  for (const { theme, skin } of themes) {
    for (const lang of langs) {
      // the menu, on a right-click of a bot row
      let context = await browser.newContext({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 2 });
      let page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error.message ?? error)));
      await page.goto(`${base}?skin=${skin}&lang=${lang}`, { waitUntil: "networkidle" });
      await page.waitForSelector("aside[data-sidebar] [data-sidebar-bot-row]");
      await page.waitForTimeout(400);
      const row = page.locator("aside[data-sidebar] [data-sidebar-bot-row]").nth(1);
      const at = await row.boundingBox();
      await page.mouse.click(at.x + 80, at.y + at.height / 2, { button: "right" });
      await page.waitForSelector("[data-bot-menu]");
      await page.waitForTimeout(300);
      const menu = await page.evaluate(readMenu);
      const file = `menu-${theme}-${lang}.png`;
      await page.screenshot({ path: join(outDir, file), clip: { x: 0, y: 0, width: 560, height: 900 } });
      notes.push({ file, theme, lang, kind: "menu", menu, errors });
      await context.close();
      // the bot's own window
      context = await browser.newContext({ viewport: { width: 480, height: 760 }, deviceScaleFactor: 2 });
      page = await context.newPage();
      const windowErrors = [];
      page.on("pageerror", (error) => windowErrors.push(String(error.message ?? error)));
      await page.goto(`${base}?skin=${skin}&lang=${lang}&window=chat&select=atlas`, { waitUntil: "networkidle" });
      await page.waitForSelector("[data-bot-chat-window] [data-composer-dock] textarea");
      await page.waitForTimeout(500);
      const win = await page.evaluate(readWindow);
      const windowFile = `window-${theme}-${lang}.png`;
      await page.screenshot({ path: join(outDir, windowFile) });
      notes.push({ file: windowFile, theme, lang, kind: "window", window: win, errors: windowErrors });
      await context.close();
      console.log(file, JSON.stringify({ groups: menu.groups, width: menu.width, rows: menu.rowHeights, del: menu.deleteColor, errors }));
      console.log(windowFile, JSON.stringify(win), windowErrors);
    }
  }
  await writeFile(join(outDir, "capture.json"), JSON.stringify(notes, null, 2) + "\n");
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
