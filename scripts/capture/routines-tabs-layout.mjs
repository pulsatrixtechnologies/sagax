#!/usr/bin/env node
/**
 * Headless captures of every Routines tab (Overview, Calendar, Run logs, Webhooks) next to the Memory page's Notes tab
 * (the conforming neighbour), French dark and English light, at 1024, 1280, 1440 and 390 wide (#4701 follow-up). It fails
 * when a tab leaves an empty row under the header (a toolbar holding a lone button), when a tab repeats its own label as
 * a heading, when a control of the page is clipped (past the viewport or its scroller), when a filter control is not
 * 36px tall, when the page scrolls sideways, or when a pointer click on a tab draws a focus ring. Real Chrome headless;
 * no window, no focus taken; mocked data, no server.
 * Usage: node scripts/capture/routines-tabs-layout.mjs [--out DIR] [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; };
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "routines-tabs-layout")));
const port = Number(arg("--port", "5183"));
const height = 800;
const looks = [{ skin: "pulsatrix", scheme: "dark", lang: "fr", tag: "fr-dark" }, { skin: "daylight", scheme: "light", lang: "en", tag: "en-light" }];
const widths = [1024, 1280, 1440, 390];
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

const measure = (tab) => {
  const vw = document.documentElement.clientWidth;
  const problems = [];
  const toolbar = document.querySelector("[data-routines-toolbar]");
  if (toolbar && tab !== "calendar") problems.push("an empty toolbar row under the header");
  if (toolbar && !toolbar.querySelector("[data-automations-range]")) problems.push("a toolbar row with no date control");
  const label = document.querySelector(`[data-page-tab="${tab}"]`)?.textContent?.replace(/\d+$/, "").trim();
  const headings = [...document.querySelectorAll("main h2, main h1")].map((h) => h.textContent?.trim());
  if (tab === "logs" || tab === "webhooks") for (const h of headings.slice(1)) if (h && label && h.toLowerCase() === label.toLowerCase()) problems.push(`the tab repeats its label as a heading: ${h}`);
  if (tab === "webhooks" && document.querySelector("[data-triggers-view] header")) problems.push("webhooks still has its own header");
  const scrollers = (el) => { const out = []; for (let n = el.parentElement; n; n = n.parentElement) { const o = getComputedStyle(n).overflowX; if (o !== "visible") out.push(n); } return out; };
  const controls = [...document.querySelectorAll("main button, main select, main input, main summary, main label")].filter((el) => el.getClientRects().length && !el.closest("[hidden]") && getComputedStyle(el).visibility !== "hidden");
  for (const el of controls) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > vw + 0.5 || r.left < -0.5) problems.push(`clipped by the window: ${el.tagName} ${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30)} ${Math.round(r.left)}..${Math.round(r.right)}`);
    for (const s of scrollers(el)) { const sr = s.getBoundingClientRect(); if (sr.width > 0 && (r.right > sr.right + 0.5 || r.left < sr.left - 0.5)) { problems.push(`clipped by its container: ${el.tagName} ${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30)}`); break; } }
  }
  if (tab === "logs") {
    const bar = document.querySelector("[data-logs-toolbar]");
    for (const el of bar?.querySelectorAll("select, label, summary, button") ?? []) { if (el.matches("[role=radio]") || el.closest("details > div")) continue; /* segmented scope: 36px as a whole; popover fields are the popover's */ const h = Math.round(el.getBoundingClientRect().height); if (h && h !== 36) problems.push(`a log filter control is ${h}px tall: ${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 20)}`); }
    const tops = [...(bar?.children ?? [])].filter((c) => c.getClientRects().length && c.getBoundingClientRect().height > 0).map((c) => Math.round(c.getBoundingClientRect().top));
    if (vw >= 1024 && Math.max(...tops) - Math.min(...tops) > 2) problems.push(`the log filters take more than one row: ${tops.join(",")}`);
    if (bar?.querySelectorAll(":scope > select").length) problems.push("a select sits on the row; they belong in the Filters popover");
    const states = [...(bar?.querySelectorAll("select") ?? [])].filter((x) => /state|status|état/i.test(x.getAttribute("aria-label") || ""));
    if (states.length > 1) problems.push(`${states.length} state selects`);
    const search = bar?.querySelector("label")?.getBoundingClientRect().width ?? 0;
    if (search > 361) problems.push(`the search is ${Math.round(search)}px wide`);
  }
  if (document.documentElement.scrollWidth - vw > 1) problems.push(`the page scrolls sideways by ${document.documentElement.scrollWidth - vw}`);
  return { problems, headings, toolbar: Boolean(toolbar) };
};

let browser;
const errors = [];
try {
  const memory = `http://127.0.0.1:${port}/src/gallery/memory-manager.html`;
  const routines = `http://127.0.0.1:${port}/src/gallery/routines-overview.html`;
  await waitForServer(routines);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, channel: process.env.SAGAX_CAPTURE_CHANNEL || "chrome" });
  const report = [];
  for (const look of looks) for (const width of widths) {
    const open = async (url, ready) => {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: look.scheme });
      page.on("pageerror", (error) => { errors.push(String(error)); });
      await page.goto(url, { waitUntil: "networkidle", timeout: 180_000 });
      await page.locator(ready).first().waitFor({ timeout: 180_000 });
      await page.waitForTimeout(500);
      return page;
    };
    const mem = await open(`${memory}?skin=${look.skin}&lang=${look.lang}&width=${width}&height=${height}&view=notes`, "[data-memory-manager-page]");
    const a = await mem.screenshot();
    await mem.close();
    for (const tab of tabs) {
      const tag = `${tab}-${look.tag}-${width}`;
      const page = await open(`${routines}?skin=${look.skin}&lang=${look.lang}&width=${width}&height=${height}&tab=${tab}`, "[data-routines-tabs]");
      const m = await page.evaluate(measure, tab);
      for (const p of m.problems) errors.push(`${tag}: ${p}`);
      // a pointer click on a tab draws no ring (the app tracks the input modality in main.tsx)
      await page.evaluate(async () => { (await import("/src/lib/input-modality.ts")).trackInputModality(); });
      const target = page.locator(`[data-page-tab="${tab}"]`);
      await target.click();
      await page.waitForTimeout(250);
      const ring = await page.evaluate((name) => { const el = document.querySelector(`[data-page-tab="${name}"]`); const s = getComputedStyle(el); return { width: s.outlineWidth, style: s.outlineStyle, shadow: s.boxShadow }; }, tab);
      if (ring.style !== "none" && parseFloat(ring.width) > 0) errors.push(`${tag}: a pointer click draws a ring ${JSON.stringify(ring)}`);
      report.push({ tag, ...m, ring });
      const b = await page.screenshot();
      const combo = await browser.newPage({ viewport: { width: width * 2 + 24, height }, deviceScaleFactor: 1 });
      await combo.setContent(`<body style="margin:0;background:#777;display:flex;gap:24px"><img src="data:image/png;base64,${a.toString("base64")}"><img src="data:image/png;base64,${b.toString("base64")}"></body>`);
      await combo.screenshot({ path: join(outDir, `${tag}.png`) });
      console.log(tag, m.problems.length ? m.problems.join("; ") : "ok");
      await combo.close();
      await page.close();
    }
  }
  await writeFile(join(outDir, "measures.json"), JSON.stringify(report, null, 2));
  if (errors.length) throw new Error(`differences:\n${[...new Set(errors)].join("\n")}`);
} catch (error) {
  console.error(viteLog.slice(-1500));
  throw error;
} finally {
  await browser?.close().catch(() => {});
  vite.kill("SIGTERM");
}
