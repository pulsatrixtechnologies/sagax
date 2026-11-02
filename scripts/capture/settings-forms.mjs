#!/usr/bin/env node
/**
 * Headless screenshots of the Settings forms gallery (Playwright, no
 * window): each sample of src/gallery/settings-forms.html, then the states
 * a click opens (add a team secret, add a credential, the disk saver's
 * list, Forget an environment), in the dark and the light skin. No server
 * and nothing opens; a mocked fetch and bridge in the gallery answer.
 * Usage: node scripts/capture/settings-forms.mjs [--out DIR] [--port N] [--lang fr] [--prefix before]
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "settings-forms")));
const port = Number(arg("--port", "5293"));
const lang = arg("--lang", "fr");
const prefix = arg("--prefix", "");

const skins = [
  { id: "pulsatrix", label: "dark" },
  { id: "daylight", label: "light" },
];

/** A click inside a sample, then a shot of that sample. The first selector
 * found wins, so the same list works on the old and the new drawing. */
const opened = [
  { name: "org-bots-add-secret", sample: "org-bots", click: ["[data-org-secret-add]"] },
  { name: "credentials-add", sample: "credentials", click: ["[data-credentials-add]", "text=Ajouter un élément"] },
  { name: "computer-care-disk", sample: "computer-care", click: ["text=Analyser"], wait: "[data-disk-saver-preview]" },
  { name: "environments-forget", sample: "environments", click: ['button[aria-label^="Forget "]'] },
];

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

const file = (name, label) => join(outDir, `${prefix ? `${prefix}-` : ""}${name}-${label}.png`);

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/settings-forms.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 2 });
  page.on("pageerror", (error) => console.error("page error:", error.stack));
  for (const { id, label } of skins) {
    await page.goto(`${base}?skin=${id}&lang=${lang}`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-gallery-sample]", { timeout: 30_000 });
    await page.waitForTimeout(800);
    const names = await page.locator("[data-gallery-sample]").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-gallery-sample")));
    for (const name of names) {
      await page.locator(`[data-gallery-sample="${name}"]`).screenshot({ path: file(name, label) });
      console.log("shot", file(name, label));
    }
    for (const step of opened) {
      const sample = page.locator(`[data-gallery-sample="${step.sample}"]`);
      let clicked = false;
      for (const selector of step.click) {
        const target = sample.locator(selector).first();
        if (await target.count()) { await target.click(); clicked = true; break; }
      }
      if (!clicked) { console.log("skip", step.name, "(nothing to click)"); continue; }
      if (step.wait) await sample.locator(step.wait).first().waitFor({ timeout: 10_000 });
      await page.waitForTimeout(300);
      await sample.screenshot({ path: file(step.name, label) });
      console.log("shot", file(step.name, label));
    }
  }
} catch (error) {
  console.error(error);
  console.error(viteLog);
  process.exitCode = 1;
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
