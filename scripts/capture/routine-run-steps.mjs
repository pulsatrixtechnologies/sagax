#!/usr/bin/env node
/**
 * Headless screenshots (real Chrome, DPR 2, no window) of a routine's Runs
 * tab with a run in progress holding ~100 steps: the step list folds the
 * same action into one row with its total, and the header carries no Running
 * badge. The Overview tab is shot beside it as the conforming neighbour.
 * Usage: node scripts/capture/routine-run-steps.mjs --out DIR [--port 5391] [--tag after]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; };
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "routine-run-steps")));
const port = Number(arg("--port", "5391"));
const tag = arg("--tag", "after");
const base = `http://127.0.0.1:${port}/src/gallery`;

const vite = spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" } });
let log = "";
vite.stdout?.on("data", (c) => { log += c; }); vite.stderr?.on("data", (c) => { log += c; });

const mcp = (name, tool_name, resource) => ({ name, input: JSON.stringify({ tool_name, tool_input: { resource } }) });
function steps() {
  const out = [{ id: "s0", at: 1, name: "Skill", ok: true, summary: "psa-service-dispatch", input: JSON.stringify({ skill: "psa-service-dispatch" }) }];
  const rows = [];
  let b = 0, v = 0, c = 0, n = 0;
  while (rows.length < 100) {
    for (let k = 0; k < 3 && b < 38; k++, b++) rows.push({ name: "Bash", summary: `cmd ${b}` });
    if (v < 9) { rows.push(mcp("use_tool", "pulsatrix_connectwise_psa__query", "service.tickets")); v++; }
    if (n < 7) { rows.push({ name: "Read", summary: `notes ${n}` }); n++; }
    if (c < 5 && rows.length % 4 === 0) { rows.push(mcp("use_tool", "pulsatrix_connectwise_psa__write", "service.tickets")); c++; }
    if (b >= 38 && v >= 9 && n >= 7 && c >= 5) break;
  }
  rows.forEach((row, i) => out.push({ id: `s${i + 1}`, at: 2 + i, ok: true, ...row }));
  out.push({ id: "live", at: 999, name: "Bash", summary: "running now" });
  return out;
}

let browser;
try {
  for (let i = 0; i < 240; i++) { try { if ((await fetch(`${base}/routine-page-tabs.html`)).status < 500) break; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 500)); }
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, channel: process.env.SAGAX_CAPTURE_CHANNEL || "chrome" });
  const page = await browser.newPage({ viewport: { width: 420, height: 780 }, deviceScaleFactor: 2 });
  await page.route("**/api/**", (route) => route.fulfill({ json: { webhooks: [], attempts: [], ingress: { available: false }, routines: [], runs: [] } }));
  await page.route("**/activity/item**", (route) => route.fulfill({ json: { item: { id: "run:sample-114", botId: "pepper", status: "running", steps: steps(), stepsTruncated: false, files: [], children: [], canStop: true } } }));
  page.on("pageerror", (e) => console.error("pageerror", e.stack.slice(0, 600)));
  page.on("console", (m) => { if (m.type() === "error") console.error("console", m.text().slice(0, 300)); });
  const name = encodeURIComponent("Connectwise PSA : Service (Dispatch Watch)");
  for (const [skin, label] of [["pulsatrix", "dark"], ["daylight", "light"]]) for (const tab of ["overview", "runs"]) {
    await page.goto(`${base}/routine-page-tabs.html?skin=${skin}&lang=en&history=running&width=400&name=${name}`, { waitUntil: "load" });
    await page.waitForSelector("[data-routine-page-tab]");
    await page.click(`[data-routine-page-tab="${tab}"]`);
    await page.waitForTimeout(900);
    const file = join(outDir, `${tag}-${tab}-${label}.png`);
    await page.screenshot({ path: file });
    if (tab === "runs") console.log(file, "rows:", await page.$$eval("[aria-label] ul li", (n) => n.map((x) => x.textContent).filter(Boolean).length));
  }
} catch (error) { console.error(error); console.error(log.slice(-3000)); process.exitCode = 1; }
finally { await browser?.close(); try { vite.kill("SIGTERM"); } catch { /* gone */ } }
