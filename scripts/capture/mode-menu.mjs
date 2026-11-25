#!/usr/bin/env node
/**
 * Headless screenshots of the composer's mode menu (#4900, #5088;
 * M-20261123-040, M-20261123-045, M-20261123-047) through the gallery
 * src/gallery/mode-menu.tsx (real composer, chip, ModelPanel with its modes
 * and real menu sections): the chat bar at rest with its chip and its
 * context and usage meter under the box (#5372), the rows (Auto, Fast,
 * Expert, Heavy, Favorites, Reasoning, All models) with a tooltip, Reasoning greyed under a mode that
 * sets its own level, the reasoning levels, and each step of All models
 * (providers, accounts, models, a provider with one account going straight
 * to its models), a pinned model. Since #5338 (M-20261125-035,
 * D-20261125-012) the levels are cascading submenus beside the menu: the
 * shots show the whole path at once, opened by clicks, by a rest of the
 * pointer and by the keyboard, and flipped to the left in a narrow window.
 * Real Chrome headless, DPR 2, no window.
 * Usage: node scripts/capture/mode-menu.mjs [--out DIR] [--port N] [--lang en|fr]
 * Files: <shot>-<dark|light>.png
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "mode-menu")));
const port = Number(arg("--port", "5387"));
const skins = [{ id: "pulsatrix", label: "dark" }, { id: "daylight", label: "light" }];
const lang = arg("--lang", "en");
const english = lang === "en";
// `steps`: the rows a person clicks, in order, before the shot
const shots = [
  // the chat bar (#5372): one box, the chip and the meter in the quiet row under it
  { name: "00-bar-rest", query: "mode=expert&open=0" },
  { name: "00-bar-narrow", query: "mode=expert&open=0", width: 400 },
  { name: "00-bar-narrowest", query: "mode=expert&open=0", width: 330 },
  { name: "00-meter-context", query: "mode=expert&open=0&meter=context" },
  { name: "00-meter-usage", query: "mode=expert&open=0&meter=usage" },
  { name: "01-menu-auto", query: "mode=auto" },
  { name: "02-menu-fast-tooltip", query: "mode=auto&hover=fast", tip: english ? "Quick responses · Grok 4 Fast" : undefined },
  { name: "03-menu-expert-reasoning-imposed", query: "mode=expert" },
  { name: "05-reasoning-levels", query: "mode=auto", steps: ['[data-mode-row="reasoning"]'] },
  { name: "06-all-models-providers", query: "mode=auto", steps: ['[data-mode-row="all"]'] },
  { name: "07-all-models-accounts", query: "mode=auto", steps: ['[data-mode-row="all"]', '[data-model-cascade-provider="anthropic"]'] },
  { name: "08-all-models-models", query: "mode=auto", steps: ['[data-mode-row="all"]', '[data-model-cascade-provider="anthropic"]', "[data-model-cascade-account] >> nth=1"] },
  { name: "09-all-models-single-account", query: "mode=auto", steps: ['[data-mode-row="all"]', '[data-model-cascade-provider="xai"]'] },
  { name: "10-all-models-local", query: "mode=auto", steps: ['[data-mode-row="all"]', '[data-model-cascade-provider="local"]'] },
  { name: "11-menu-pinned", query: "mode=pinned" },
  // the whole path at once (D-20261125-012): the menu, the providers, the accounts, the models
  { name: "12-cascade-full-path", query: "mode=auto&place=left", side: "right", levels: ["root", "providers", "accounts", "models"], steps: ['[data-mode-row="all"]', '[data-model-cascade-provider="anthropic"]', "[data-model-cascade-account] >> nth=1"] },
  { name: "13-cascade-hover", query: "mode=auto&place=left", side: "right", levels: ["root", "providers", "accounts", "models"], rests: ['[data-mode-row="all"]', '[data-model-cascade-provider="anthropic"]', "[data-model-cascade-account] >> nth=0"] },
  { name: "14-cascade-keyboard", query: "mode=auto&place=left", side: "right", levels: ["root", "providers", "accounts", "models"], keys: ["End", "ArrowRight", "ArrowRight", "ArrowRight"] },
  { name: "15-cascade-escape-one-level", query: "mode=auto&place=left", side: "right", levels: ["root", "providers", "accounts"], keys: ["End", "ArrowRight", "ArrowRight", "ArrowRight", "Escape"] },
  { name: "16-cascade-pinned-path", query: "mode=pinned&place=left", side: "right", levels: ["root", "providers", "accounts", "models"], steps: ['[data-mode-row="all"]', '[data-model-cascade-provider="anthropic"]', "[data-model-cascade-account] >> nth=0"] },
  // a bar at the window's right: no room on the right for the path, the levels open to the left of the menu
  { name: "17-cascade-flipped-left", query: "mode=auto&place=right", side: "left", levels: ["root", "providers", "accounts", "models"], steps: ['[data-mode-row="all"]', '[data-model-cascade-provider="anthropic"]', "[data-model-cascade-account] >> nth=1"] },
  // a window too narrow for the path on either side: each level stops at the window's margin, over a part of the one before
  { name: "18-cascade-narrow-window", query: "mode=auto", width: 1000, cramped: true, levels: ["root", "providers", "accounts", "models"], steps: ['[data-mode-row="all"]', '[data-model-cascade-provider="anthropic"]', "[data-model-cascade-account] >> nth=1"] },
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
// drain Vite's output: a full pipe stalls the dev server mid-page
vite.stdout.resume();
vite.stderr.resume();
let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/mode-menu.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const width = Number(arg("--width", "1720"));
  const page = await browser.newPage({ viewport: { width, height: 760 }, deviceScaleFactor: 2 });
  for (const { id, label } of skins) {
    for (const shot of shots) {
      await page.setViewportSize({ width: shot.width ?? width, height: 760 });
      // the pointer of the shot before rests on nothing
      await page.mouse.move(1, 1);
      await page.goto(`${base}?lang=${lang}&skin=${id}&${shot.query}`, { waitUntil: "networkidle" });
      await page.waitForSelector("[data-gallery-chip]");
      for (const step of shot.steps ?? []) await page.click(step);
      // a rest of the pointer on a row opens its level, without a click
      for (const row of shot.rests ?? []) {
        await page.hover(row);
        await page.waitForTimeout(350);
      }
      if (shot.keys) {
        await page.focus('[data-mode-row][aria-checked="true"]');
        for (const key of shot.keys) await page.keyboard.press(key);
      }
      if (shot.levels) {
        // the menu never leaves the screen and every level of the path is in view, none over another
        const boxes = await page.evaluate(() => [document.querySelector("[data-gallery-menu]"), ...document.querySelectorAll("[data-mode-level]")].map((node) => {
          const box = node.getBoundingClientRect();
          return { level: node.dataset.modeLevel ?? "root", side: node.dataset.side ?? "", left: box.left, right: box.right, top: box.top, bottom: box.bottom };
        }));
        const names = boxes.map((box) => box.level);
        if (names.join(",") !== shot.levels.join(",")) throw new Error(`${shot.name} (${label}): levels on screen ${names.join(" > ")}, expected ${shot.levels.join(" > ")}`);
        for (const box of boxes) {
          if (box.left < 0 || box.right > (shot.width ?? width) || box.top < 0 || box.bottom > 760) throw new Error(`${shot.name} (${label}): the ${box.level} level leaves the window`);
        }
        // a level sits 4px over the row that opened it (SUBMENU_SIDE_OFFSET), never further over another level
        for (let index = 1; index < boxes.length && !shot.cramped; index += 1) {
          for (let other = 0; other < index; other += 1) {
            const over = Math.min(boxes[index].right, boxes[other].right) - Math.max(boxes[index].left, boxes[other].left);
            const tall = Math.min(boxes[index].bottom, boxes[other].bottom) - Math.max(boxes[index].top, boxes[other].top);
            if (over > 6 && tall > 0) throw new Error(`${shot.name} (${label}): the ${boxes[index].level} level covers ${boxes[other].level} by ${Math.round(over)}px`);
          }
          if (shot.side && boxes[index].side !== shot.side) throw new Error(`${shot.name} (${label}): the ${boxes[index].level} level opened on the ${boxes[index].side}, expected the ${shot.side}`);
        }
      }
      // nothing "Off" or "Signed out" is ever listed in the mode menu (M-20261123-047)
      const words = await page.evaluate(() => [document.querySelector("[data-gallery-menu]"), ...document.querySelectorAll("[data-mode-level]")].map((node) => node?.textContent ?? "").join(" "));
      if (/Signed out|Déconnecté|\boff\b/i.test(words)) throw new Error(`${shot.name} (${label}): the menu lists something that cannot run: ${words}`);
      const hover = new URLSearchParams(shot.query).get("hover");
      if (hover) {
        await page.hover(`[data-mode-row="${hover}"]`);
        await page.waitForSelector(`[data-mode-tooltip="${hover}"]`);
        const text = await page.evaluate((mode) => document.querySelector(`[data-mode-tooltip="${mode}"]`)?.textContent ?? "", hover);
        if (shot.tip && text !== shot.tip) throw new Error(`${shot.name} (${label}): tooltip reads "${text}", expected "${shot.tip}"`);
      }
      const file = join(outDir, `${shot.name}-${label}.png`);
      await page.screenshot({ path: file });
      console.log(file);
    }
  }
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
