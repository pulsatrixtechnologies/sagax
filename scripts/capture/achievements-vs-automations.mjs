#!/usr/bin/env node
/**
 * Headless screenshots of the Automations page (src/gallery/automations-header.html,
 * the reference) next to the Achievements page (src/gallery/achievements-screen.html),
 * light (pulsatrix-light) and dark (pulsatrix) at a desktop width, then one
 * side-by-side image per skin and per view so the two read as sister pages.
 * Views: Automations List and Calendar; Achievements All, one category picked
 * from Filters, and its settings opened from the ☰ menu. Headless Chromium only:
 * no window opens; the galleries answer /api themselves.
 * Usage: node scripts/capture/achievements-vs-automations.mjs [--out DIR] [--port N] [--prefix after]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "achievements-vs-automations"));
const port = Number(arg("--port") ?? 5294);
const prefix = arg("--prefix") ?? "after";
const skins = [{ id: "pulsatrix-light", label: "light" }, { id: "pulsatrix", label: "dark" }];
const width = 1200;
const height = 760;

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
  // its own process group: stopping the group stops vite too
  detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

let browser;
try {
  const gallery = `http://127.0.0.1:${port}/src/gallery`;
  await waitForServer(`${gallery}/achievements-screen.html`);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  page.on("pageerror", (error) => console.error("page error:", error.stack));
  // what a gallery does not answer itself is not there
  await page.route("**/api/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not in this gallery" }) }));
  const shots = {};
  const automations = async (skin, view, name) => {
    await page.goto(`${gallery}/automations-header.html?view=${view}&width=${width}&height=${height}&skin=${skin}&lang=en`, { waitUntil: "load" });
    await page.waitForSelector("[data-automations-header]");
    await page.waitForTimeout(700);
    const path = join(outDir, `${name}.png`);
    await page.screenshot({ path });
    return path;
  };
  const achievements = async (skin, query, name, before) => {
    await page.goto(`${gallery}/achievements-screen.html?skin=${skin}&lang=en${query}`, { waitUntil: "load" });
    await page.waitForSelector("[data-gallery-open]");
    await page.click("[data-gallery-open]");
    await page.waitForSelector("[data-achievements-screen]");
    await page.waitForTimeout(500);
    if (before) await before(page);
    await page.waitForTimeout(400);
    const path = join(outDir, `${name}.png`);
    await page.screenshot({ path });
    return path;
  };
  for (const { id, label } of skins) {
    shots[`automations-list-${label}`] = await automations(id, "list", `automations-list-${label}`);
    shots[`automations-calendar-${label}`] = await automations(id, "calendar", `automations-calendar-${label}`);
    shots[`achievements-${label}`] = await achievements(id, "", `${prefix}-achievements-${label}`);
    // a category picked from Filters (the new page) or from the pills (the old one)
    shots[`achievements-category-${label}`] = await achievements(id, "", `${prefix}-achievements-category-${label}`, async (p) => {
      if (await p.locator("[data-achievements-filters]").count()) {
        await p.click("[data-achievements-filters] > summary");
        await p.selectOption("[data-achievements-filters] select[data-achievement-category-select]", "mastery");
        await p.keyboard.press("Escape");
        await p.mouse.click(5, height - 5);
      } else if (await p.locator('[data-achievement-category="mastery"]').count()) {
        await p.click('[data-achievement-category="mastery"]');
      }
    });
    // the settings, opened from the header as a person would
    shots[`achievements-settings-${label}`] = await achievements(id, "", `${prefix}-achievements-settings-${label}`, async (p) => {
      if (await p.locator("[data-achievements-menu]").count()) {
        await p.click("[data-achievements-menu] > summary");
        await p.click("[data-achievements-menu-settings]");
      } else {
        await p.click("[data-achievements-settings-button]");
      }
      await p.waitForSelector("[data-achievements-settings-page]");
      // the old page's gear keeps focus after the click: that is what a person saw
    });
  }
  // side by side: Automations on the left, Achievements on the right
  const pairs = [];
  for (const { label } of skins) {
    pairs.push([`automations-list-${label}`, `achievements-${label}`, `${prefix}-side-by-side-${label}`]);
    pairs.push([`automations-list-${label}`, `achievements-category-${label}`, `${prefix}-side-by-side-category-${label}`]);
    pairs.push([`automations-calendar-${label}`, `achievements-settings-${label}`, `${prefix}-side-by-side-settings-${label}`]);
  }
  const compose = await browser.newPage({ viewport: { width: width * 2 + 24, height: height + 48 }, deviceScaleFactor: 1 });
  for (const [left, right, name] of pairs) {
    const data = async (key) => `data:image/png;base64,${(await readFile(shots[key])).toString("base64")}`;
    await compose.setContent(`<body style="margin:0;background:#888;font:600 14px system-ui;color:#fff">
      <div style="display:flex;gap:24px;padding:0">
        <figure style="margin:0"><figcaption style="height:24px;padding:12px 8px 0">Automations (${left.replace("automations-", "")})</figcaption><img src="${await data(left)}" style="width:${width}px;height:${height}px;display:block"></figure>
        <figure style="margin:0"><figcaption style="height:24px;padding:12px 8px 0">Achievements (${prefix}, ${right.replace("achievements-", "") || "all"})</figcaption><img src="${await data(right)}" style="width:${width}px;height:${height}px;display:block"></figure>
      </div></body>`, { waitUntil: "load" });
    await compose.screenshot({ path: join(outDir, `${name}.png`) });
  }
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(error);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* gone */ }
}
