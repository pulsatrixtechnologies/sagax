#!/usr/bin/env node
/**
 * The app shell's sidebar by window width (JC 2026-11-01, Grok Bot's window
 * collapses its sidebar to icons at 700 px). Real AppSidebar, Sidebar and
 * ChatView (gallery src/gallery/app-shell-sidebar.html), synthetic data,
 * headless Chrome only.
 *
 * Shots: 1338x809 (the person's full sidebar, and a rail they chose),
 * 700x809 (the automatic rail), 390x844 (the drawer, closed and open), light
 * and dark. Next to the PNGs, what the DOM says: layout and density, the
 * aside's width, the saved density before and after (never changed by the
 * automatic rail), the rail's buttons and their names, centring of the rail
 * items, horizontal overflow, page errors. One shot also widens 700 -> 1338
 * in the same page to show the saved density comes back.
 *
 *   node scripts/capture-sidebar-rail.mjs [--out DIR] [--port N]
 *
 * SAGAX_CHROMIUM overrides the Chrome binary.
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = resolve(arg("--out", join(here, "docs", "screenshots", "grok-convergence", "sidebar")));
const port = Number(arg("--port", "5317"));
const chrome = process.env.SAGAX_CHROMIUM || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const themes = [
  { theme: "dark", skin: "pulsatrix" },
  { theme: "light", skin: "daylight" },
];
const shots = themes.flatMap(({ theme, skin }) => [
  { name: `w1338-${theme}-full`, skin, width: 1338, height: 809, density: "comfortable" },
  { name: `w1338-${theme}-saved-rail`, skin, width: 1338, height: 809, density: "icons" },
  { name: `w700-${theme}-auto-rail`, skin, width: 700, height: 809, density: "comfortable", widenTo: 1338 },
  { name: `w390-${theme}-drawer-closed`, skin, width: 390, height: 844, density: "comfortable" },
  { name: `w390-${theme}-drawer-open`, skin, width: 390, height: 844, density: "comfortable", openDrawer: true },
]).concat([
  { name: "w700-dark-auto-rail-fr", skin: "pulsatrix", width: 700, height: 809, density: "comfortable", lang: "fr" },
]);

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`gallery did not start at ${url}`);
}

/** What the page says about its sidebar, read in the browser. */
function readLayout() {
  const aside = document.querySelector("aside[data-sidebar]");
  const rect = (node) => node ? (({ x, y, width, height }) => ({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }))(node.getBoundingClientRect()) : null;
  const box = aside?.getBoundingClientRect();
  const center = box ? box.x + box.width / 2 : 0;
  const railItems = [...(aside?.querySelectorAll("[data-sidebar-bot-row], [data-sidebar-search], [data-sidebar-new], [data-sidebar-rail-foot] button, [data-sidebar-account-rail] button") ?? [])]
    .filter((node) => node.getBoundingClientRect().width > 0);
  const offCentre = railItems
    .map((node) => ({ node, r: node.getBoundingClientRect() }))
    .filter(({ r }) => Math.abs(r.x + r.width / 2 - center) > 1.5)
    .map(({ node, r }) => ({ label: node.getAttribute("aria-label") ?? node.getAttribute("data-sidebar-bot-row"), dx: Math.round(r.x + r.width / 2 - center) }));
  const account = aside?.querySelector('[data-sidebar-account-rail] button[aria-haspopup="menu"], [data-sidebar-account-row] button[aria-haspopup="menu"]');
  const apps = aside?.querySelector("[data-sidebar-connect-apps]");
  const drawerButton = document.querySelector("[data-drawer-button]");
  return {
    viewport: { width: innerWidth, height: innerHeight },
    layout: aside?.getAttribute("data-sidebar-layout") ?? null,
    density: aside?.getAttribute("data-sidebar-density") ?? null,
    savedDensity: localStorage.getItem("openmausbot.sidebarDensity"),
    aside: rect(aside),
    asideVisible: box ? box.right > 0 && box.x < innerWidth : false,
    chat: rect(document.querySelector("[data-sidebar-follower]")),
    drawerButton: drawerButton && getComputedStyle(drawerButton).display !== "none" ? { label: drawerButton.getAttribute("aria-label"), expanded: drawerButton.getAttribute("aria-expanded") } : null,
    scrim: Boolean(document.querySelector("[data-drawer-scrim]")),
    separator: Boolean(aside?.querySelector('[role="separator"]')),
    compactToggle: Boolean(aside?.querySelector("[data-sidebar-compact-toggle]")),
    account: account ? { label: account.getAttribute("aria-label"), rect: rect(account) } : null,
    apps: apps ? { label: apps.getAttribute("aria-label"), grid: Boolean(apps.querySelector("[data-apps-grid-icon]")), rect: rect(apps) } : null,
    botRows: [...(aside?.querySelectorAll("[data-sidebar-bot-row]") ?? [])].map((node) => node.getAttribute("aria-label") ?? node.textContent?.trim().slice(0, 24)),
    railOffCentre: aside?.getAttribute("data-sidebar-density") === "icons" ? offCentre : [],
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    guidLike: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(document.body.innerText),
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
  for (const shot of shots) {
    const context = await browser.newContext({ viewport: { width: shot.width, height: shot.height }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error.message ?? error)));
    await page.goto(`${base}?skin=${shot.skin}&lang=${shot.lang ?? "en"}&density=${shot.density}`, { waitUntil: "networkidle" });
    await page.waitForSelector("aside[data-sidebar] [data-sidebar-bot-row]");
    await page.waitForSelector("[data-composer-dock] textarea");
    if (shot.openDrawer) {
      await page.click("[data-drawer-button]");
      await page.waitForSelector("[data-drawer-scrim]");
    }
    await page.waitForTimeout(500);
    const note = { file: `${shot.name}.png`, ...shot, dom: await page.evaluate(readLayout) };
    await page.screenshot({ path: join(outDir, note.file), fullPage: false });
    if (shot.widenTo) {
      await page.setViewportSize({ width: shot.widenTo, height: shot.height });
      await page.waitForTimeout(400);
      note.widened = await page.evaluate(readLayout);
      note.widenedFile = `${shot.name}-widened-${shot.widenTo}.png`;
      await page.screenshot({ path: join(outDir, note.widenedFile), fullPage: false });
    }
    note.errors = errors;
    notes.push(note);
    console.log(note.file, JSON.stringify({ layout: note.dom.layout, density: note.dom.density, saved: note.dom.savedDensity, aside: note.dom.aside, offCentre: note.dom.railOffCentre, overflow: note.dom.horizontalOverflow, widened: note.widened && { layout: note.widened.layout, density: note.widened.density }, errors }));
    await context.close();
  }
  await writeFile(join(outDir, "capture.json"), JSON.stringify(notes, null, 2) + "\n");
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
