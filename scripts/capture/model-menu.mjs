#!/usr/bin/env node
/**
 * Headless screenshots of the composer's model menu through the real
 * ModelPanel (gallery model-menu, real Chrome headless, DPR 2, no window):
 * the short menu (Auto, favorites, All models) and All models with its stars,
 * light and dark, English and French.
 * Usage: node scripts/capture/model-menu.mjs [--out DIR] [--port N] [--mode before|after] [--accounts]
 * Files: <mode>-<lang>-<theme>-<short|all|auto>.png
 * --accounts (M-20261119-015): two Claude accounts through the real menu
 * sections; files <mode>-<lang>-<theme>-accounts-<short|all|choose|team>.png
 * --scenes (M-20261119-051): the owner's menu (the bot's model followed, or
 * Auto), a chosen model with no account or pill, a long name; files
 * <mode>-<lang>-<theme>-scene-<owner|owner-auto|plain|long>.png, and
 * <mode>-<lang>-<theme>-right-column.png: the right column zoomed, with a
 * guide on the text edge and on each icon's centre (their x in
 * <mode>-right-column.json)
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "model-menu")));
const port = Number(arg("--port", "5343"));
const mode = arg("--mode", "after");
const accounts = process.argv.includes("--accounts");
const scenes = process.argv.includes("--scenes");

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
  const base = `http://127.0.0.1:${port}/src/gallery/model-menu.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 420, height: 640 }, deviceScaleFactor: 2 });
  const columns = {};
  for (const lang of ["en", "fr"]) {
    for (const theme of ["light", "dark"]) {
      if (scenes) {
        for (const view of ["owner", "owner-auto", "plain", "long"]) {
          const query = view === "owner-auto" ? "scene=owner&auto=1" : `scene=${view}`;
          await page.goto(`${base}?lang=${lang}&theme=${theme}&${query}`, { waitUntil: "networkidle" });
          await page.waitForTimeout(400);
          await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
          const file = join(outDir, `${mode}-${lang}-${theme}-scene-${view}.png`);
          await page.locator("[data-model-menu]").screenshot({ path: file });
          console.log(file);
          if (view !== "owner") continue;
          // the right column: where each row's text ends and each icon's centre sits
          const measured = await page.evaluate(() => {
            const menu = document.querySelector("[data-model-menu]").getBoundingClientRect();
            const rows = [...document.querySelectorAll("[data-model-panel-list] > *")];
            return rows.map((node) => {
              const text = node.querySelector("[data-model-panel-description]");
              const icons = [...node.querySelectorAll("svg")].map((svg) => {
                const box = svg.getBoundingClientRect();
                return Math.round((menu.right - (box.left + box.width / 2)) * 10) / 10;
              });
              return {
                row: (node.querySelector("[data-model-panel-row]")?.getAttribute("data-model-row-kind") ?? (node.hasAttribute("data-model-panel-all") ? "all" : node.getAttribute("data-model-auto-optimize") !== null ? "optimize" : "other")),
                textEdgeFromRight: text ? Math.round((menu.right - text.getBoundingClientRect().right) * 10) / 10 : null,
                iconCentresFromRight: icons,
              };
            });
          });
          columns[`${lang}-${theme}`] = measured;
          const box = await page.locator("[data-model-menu]").boundingBox();
          const guides = [...new Set(measured.flatMap((entry) => [entry.textEdgeFromRight, ...entry.iconCentresFromRight]).filter((x) => x != null))];
          await page.evaluate(({ guides }) => {
            const menu = document.querySelector("[data-model-menu]");
            const rect = menu.getBoundingClientRect();
            for (const x of guides) {
              const line = document.createElement("div");
              line.setAttribute("data-capture-guide", "");
              line.style.cssText = `position:fixed;top:${rect.top}px;height:${rect.height}px;left:${rect.right - x}px;width:1px;background:rgba(255,0,80,.55);pointer-events:none;z-index:99`;
              document.body.appendChild(line);
            }
          }, { guides });
          const zoom = join(outDir, `${mode}-${lang}-${theme}-right-column.png`);
          const listBox = await page.locator("[data-model-panel-scroll]").boundingBox();
          await page.screenshot({ path: zoom, clip: { x: box.x + box.width - 190, y: box.y, width: 190, height: (listBox ? listBox.y + listBox.height - box.y : box.height) + 4 } });
          console.log(zoom);
        }
        continue;
      }
      if (accounts) {
        for (const view of ["short", "all", "choose", "team"]) {
          const query = view === "short" ? "view=short" : view === "team" ? "view=all&on=team" : "view=all";
          await page.goto(`${base}?lang=${lang}&theme=${theme}&accounts=1&${query}`, { waitUntil: "networkidle" });
          await page.waitForTimeout(400);
          // before the change there is no Account line: the capture shows the plain list
          if (view === "choose" && (await page.locator('[data-model-line="account"]').count()) > 0) await page.locator('[data-model-line="account"]').click();
          await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
          const file = join(outDir, `${mode}-${lang}-${theme}-accounts-${view}.png`);
          await page.locator("[data-model-menu]").screenshot({ path: file });
          console.log(file);
        }
        continue;
      }
      for (const view of ["short", "all", "auto"]) {
        await page.goto(`${base}?lang=${lang}&theme=${theme}&view=${view === "auto" ? "short" : view}${view === "auto" ? "&auto=1" : ""}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(400);
        await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
        const file = join(outDir, `${mode}-${lang}-${theme}-${view}.png`);
        await page.locator("[data-model-menu]").screenshot({ path: file });
        console.log(file);
      }
    }
  }
  if (scenes) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(outDir, `${mode}-right-column.json`), JSON.stringify(columns, null, 2));
  }
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
