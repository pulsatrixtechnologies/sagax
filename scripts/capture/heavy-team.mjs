#!/usr/bin/env node
/**
 * Headless screenshots of a Heavy run (#4901, #5089), dark and light: the
 * row while the experts propose (the bot's mascot divided into them, Auto's
 * one line above), while they critique, while the leader writes after they
 * agreed, the row after ("Thought for 26s", the leader's plan and the
 * disputes) and the Thoughts panel. The division itself, frame by frame, is
 * scripts/capture/heavy-division.mjs. Synthetic data and demo accounts
 * only. Real Chrome headless, DPR 2. --look adds the gallery's look
 * parameters to every page (character=shiba, photo=1, shape=cat&color=brown...:
 * every expert is that bot, M-20261127-178), --tag names the files after it,
 * --shots keeps only the shots named.
 * Usage: node scripts/capture/heavy-team.mjs [--out DIR] [--port N] [--look "photo=1"] [--tag photo] [--shots heavy-done-decided,heavy-panel-decided]
 */
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "heavy-team")));
const port = Number(arg("--port", "5389"));
const look = arg("--look", "");
const tag = arg("--tag", "");
const only = arg("--shots", "").split(",").filter(Boolean);
const skins = [{ id: "pulsatrix", label: "dark" }, { id: "daylight", label: "light" }];
const allShots = [
  { name: "heavy-propose-auto", query: "case=propose&auto=risky", header: "Experts proposing · round 1 of 5 · 14s" },
  { name: "heavy-critique", query: "case=critique", header: "Experts critiquing · round 3 of 5 · 14s" },
  { name: "heavy-leader-writing", query: "case=merged", header: "Thought for 14s" },
  { name: "heavy-done-decided", query: "case=done", header: "Thought for 26s" },
  { name: "heavy-panel-decided", query: "case=panel", header: "Thought for 26s", panel: true, open: [2] },
  // M-20261123-040: a seat that refused (HTTP 403), in French: the row, then the panel
  { name: "heavy-refused-fr", query: "case=refused", lang: "fr" },
  { name: "heavy-refused-panel-fr", query: "case=refused-panel", lang: "fr", panel: true },
];
const shots = only.length ? allShots.filter((shot) => only.includes(shot.name)) : allShots;

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
  const base = `http://127.0.0.1:${port}/src/gallery/heavy-team.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 2 });
  // the gallery's `photo=1` bot wears the app's icon as its own picture (an attachment the dev server does not have)
  const photo = await readFile(join(root, "public", "app-icon-192.png"));
  await page.route("**/api/attachments/demo-photo.png", (route) => route.fulfill({ status: 200, contentType: "image/png", body: photo }));
  for (const { id, label } of skins) {
    for (const shot of shots) {
      await page.goto(`${base}?lang=${shot.lang ?? "en"}&skin=${id}&${shot.query}${look ? `&${look}` : ""}`, { waitUntil: "networkidle" });
      await page.waitForSelector("[data-heavy-header]");
      const header = await page.textContent("[data-heavy-header]");
      if (shot.header && header !== shot.header) throw new Error(`${shot.name} (${label}): header reads "${header}", expected "${shot.header}"`);
      if (shot.panel) {
        await page.waitForSelector("[data-thoughts-panel]");
        for (const n of shot.open ?? []) await page.click(`[data-thoughts-agent="${n}"] button`);
      }
      await page.mouse.move(2, 2);
      await page.waitForTimeout(250);
      const file = join(outDir, `${shot.name}${tag ? `-${tag}` : ""}-${label}.png`);
      await page.screenshot({ path: file });
      console.log(file);
    }
  }
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
