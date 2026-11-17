#!/usr/bin/env node
/**
 * Headless captures of the Routines header against the Memory page's (2026-11-17): Memory and each Routines tab side by
 * side, with guide lines at Memory's left edge, its title baseline and its close X drawn on both. French dark and
 * English light, at 1920, 1460, 1280, 764 and 390 wide. It fails when, from 764 up, a Routines tab's title starts
 * anywhere but Memory's left edge, its X is not where Memory's is, its content does not start and end on the header's
 * edges, or the page scrolls sideways. No window, no focus taken; mocked data, no server.
 * Usage: node scripts/capture/routines-header.mjs [--out DIR] [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; };
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "routines-header")));
const port = Number(arg("--port", "5182"));
const height = 900;
const looks = [{ skin: "pulsatrix", scheme: "dark", lang: "fr", tag: "fr-dark" }, { skin: "daylight", scheme: "light", lang: "en", tag: "en-light" }];
const widths = [1920, 1460, 1280, 764, 390];
const tabs = ["overview", "calendar", "logs", "webhooks"];

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Vite gallery did not start at ${url}`);
}

const vite = spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" } });
let viteLog = "";
vite.stdout?.on("data", (c) => { viteLog += c; });
vite.stderr?.on("data", (c) => { viteLog += c; });

// What a page's header and content say about their edges, in page pixels.
const measure = () => {
  const box = (element) => { if (!element) return null; const r = element.getBoundingClientRect(); return { left: Math.round(r.left * 10) / 10, right: Math.round(r.right * 10) / 10, top: r.top, bottom: r.bottom }; };
  const header = document.querySelector("[data-page-header]");
  const icon = box(header?.querySelector("[data-page-title] svg"));
  const title = box(header?.querySelector("[data-page-title] h1"));
  const actions = [...(header?.querySelectorAll("[data-page-actions] button, [data-page-actions] summary") ?? [])];
  const close = box(actions.at(-1));
  const toolbar = box(header?.querySelector("[data-page-toolbar]"));
  // The calendar's right rail: where its content ends (its sections' padding taken off), against the header's X
  const rail = document.querySelector("[data-right-rail]");
  const railContent = rail ? Math.max(...[...rail.querySelectorAll(":scope > section")].map((el) => el.getBoundingClientRect().right - parseFloat(getComputedStyle(el).paddingRight))) : null;
  return { railContent, icon, title, close, toolbar, headerRect: box(header), scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
};
const contentEdges = () => {
  const el = document.querySelector("[data-routines-overview]") ?? document.querySelector('section[aria-label]:not([data-page-header])') ?? document.querySelector("[data-triggers-view] > div") ?? document.querySelector("[data-routines-grid]");
  if (!el) return null;
  // the element's own padding is its margin to the page: what it draws is inside it
  const r = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  return { left: Math.round((r.left + parseFloat(style.paddingLeft)) * 10) / 10, right: Math.round((r.right - parseFloat(style.paddingRight)) * 10) / 10 };
};

let browser;
const errors = [];
try {
  const memory = `http://127.0.0.1:${port}/src/gallery/memory-manager.html`;
  const routines = `http://127.0.0.1:${port}/src/gallery/routines-overview.html`;
  await waitForServer(routines);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM, headless: true } : { headless: true });
  const report = [];
  for (const look of looks) {
    for (const width of widths) {
      const open = async (url, ready) => {
        const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: look.scheme });
        page.on("pageerror", (error) => { errors.push(String(error)); });
        await page.goto(url, { waitUntil: "networkidle" });
        await page.locator(ready).first().waitFor();
        await page.waitForTimeout(500);
        return page;
      };
      const mem = await open(`${memory}?skin=${look.skin}&lang=${look.lang}&width=${width}&height=${height}&view=notes`, "[data-memory-manager-page]");
      const m = await mem.evaluate(measure);
      for (const tab of tabs) {
        const page = await open(`${routines}?skin=${look.skin}&lang=${look.lang}&width=${width}&height=${height}&tab=${tab}`, "[data-routines-tabs]");
        const r = await page.evaluate(measure);
        const c = await page.evaluate(contentEdges);
        const tag = `${tab} ${look.tag} ${width}`;
        report.push({ tag, memory: { icon: m.icon?.left, close: m.close?.right, closeTop: m.close?.top, titleBottom: m.title?.bottom }, routines: { icon: r.icon?.left, close: r.close?.right, closeTop: r.close?.top, titleBottom: r.title?.bottom, content: c } });
        if (width >= 764) {
          if (Math.abs(r.icon.left - m.icon.left) > 1) errors.push(`${tag}: the title starts at ${r.icon.left}, Memory's at ${m.icon.left}`);
          if (Math.abs(r.close.right - m.close.right) > 1 || Math.abs(r.close.top - m.close.top) > 1) errors.push(`${tag}: the X is at ${r.close.right}/${r.close.top}, Memory's at ${m.close.right}/${m.close.top}`);
          if (Math.abs(r.title.bottom - m.title.bottom) > 1) errors.push(`${tag}: the title's baseline is ${r.title.bottom}, Memory's ${m.title.bottom}`);
          if (c && tab !== "calendar" && (Math.abs(c.left - r.icon.left) > 1 || Math.abs(c.right - (r.headerRect.right - (r.headerRect.right - r.close.right))) > 1)) errors.push(`${tag}: the content spans ${c.left} to ${c.right}, the header ${r.icon.left} to ${r.close.right}`);
        }
        if (r.railContent !== null && Math.abs(r.railContent - r.close.right) > 1) errors.push(`${tag}: the calendar's side panel ends at ${r.railContent}, the header's X at ${r.close.right}`);
        if (r.scrollX > 1) errors.push(`${tag}: the page scrolls sideways by ${r.scrollX}`);
        // guide lines at Memory's measurements, on both pages
        const lines = { left: m.icon.left, right: m.close.right, base: m.title.bottom };
        const draw = (target) => target.evaluate(({ left, right, base }) => {
          const line = (css) => { const d = document.createElement("div"); d.style.cssText = `position:fixed;z-index:99999;pointer-events:none;background:#ff2bd6;${css}`; document.body.append(d); };
          line(`left:${left}px;top:0;bottom:0;width:1px`); line(`left:${right}px;top:0;bottom:0;width:1px`); line(`top:${base}px;left:0;right:0;height:1px`);
        }, lines);
        await draw(page); await draw(mem);
        const a = await mem.screenshot();
        const b = await page.screenshot();
        const combo = await browser.newPage({ viewport: { width: width * 2 + 24, height }, deviceScaleFactor: 1 });
        await combo.setContent(`<body style="margin:0;background:#777;display:flex;gap:24px"><img src="data:image/png;base64,${a.toString("base64")}"><img src="data:image/png;base64,${b.toString("base64")}"></body>`);
        const file = join(outDir, `${tab}-${look.tag}-${width}.png`);
        await combo.screenshot({ path: file });
        console.log(file);
        await combo.close();
        await page.close();
        // the Memory page keeps its lines for the next tab, so reload it clean
        await mem.reload({ waitUntil: "networkidle" });
        await mem.locator("[data-memory-manager-page]").first().waitFor();
        await mem.waitForTimeout(300);
      }
      await mem.close();
    }
  }
  await writeFile(join(outDir, "measures.json"), JSON.stringify(report, null, 2));
  if (errors.length) throw new Error(`header differences:\n${errors.join("\n")}`);
} catch (error) {
  console.error(viteLog.slice(-1500));
  throw error;
} finally {
  await browser?.close().catch(() => {});
  vite.kill("SIGTERM");
}
