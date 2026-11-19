#!/usr/bin/env node
/**
 * #4910: headless captures of a bot's form answered one question at a time
 * (src/gallery/pinned-card.html?case=form-wizard): the card at its first
 * step, a follow-up opened under its answer, the review, the same card as
 * an old bot wrote it (no `when`), and the conforming neighbour (the
 * AskUserQuestion card). Run it in the old tree with `--mode before` for
 * the stacked card it replaces (same fixtures, no interaction).
 * Synthetic data only. Headless Chromium: no window opens. Own Vite port
 * (never 5173).
 * Usage: node scripts/capture/question-wizard.mjs [--out DIR] [--port N] [--mode before|after]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const mode = arg("--mode") ?? "after";
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "question-wizard"));
const port = Number(arg("--port") ?? 5291);

async function waitForServer(url, ms = 180_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const viteBin = join(root, "node_modules", "vite", "bin", "vite.js");
const vite = spawn(process.execPath, [viteBin, "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

let browser;
let failed = false;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/pinned-card.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const executablePath = process.env.SAGAX_VERIFY_BROWSER_CHROME;
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  for (const skin of ["midnight", "daylight"]) {
    for (const lang of ["en", "fr"]) {
      const theme = skin === "midnight" ? "dark" : "light";
      const open = async (which) => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
        page.on("pageerror", (error) => { failed = true; console.log(`ERROR ${which}: ${String(error?.stack ?? error).slice(0, 600)}`); });
        await page.goto(`${base}?${new URLSearchParams({ skin, lang, case: which })}`, { waitUntil: "load" });
        await page.waitForSelector("[data-ask-card]");
        await page.waitForTimeout(600);
        return page;
      };
      const shot = async (page, name) => {
        const file = join(outDir, `${name}-${theme}-${lang}.png`);
        await page.locator('[data-shot="chat"]').screenshot({ path: file });
        console.log(file);
      };
      const choice = (page, text) => page.locator("[data-question-sheet]").first().locator("[data-ask-choice]", { hasText: text }).first();
      const wizard = (page, id) => page.locator(`[data-question-sheet] [data-wizard-action="${id}"]`).first();
      const pick = {
        en: { enter: "Enter it", usual: "The usual one", meals: "Meals", scheduled: "As scheduled", ticket: "Enter a ticket" },
        fr: { enter: "Saisir", usual: "Le billet habituel", meals: "Repas", scheduled: "Comme prévu", ticket: "Un numéro de billet" },
      }[lang];

      const page = await open("form-wizard");
      if (mode === "before") {
        await shot(page, "before-form");
        await page.close();
        continue;
      }
      await shot(page, "after-step1");
      await choice(page, pick.enter).click();
      await page.locator("[data-form-followup] input").first().fill("1");
      await page.waitForTimeout(200);
      await shot(page, "after-followup");
      await wizard(page, "next").click();
      await choice(page, pick.ticket).click();
      await page.locator("[data-form-followup] textarea").first().fill("4512");
      await page.waitForTimeout(200);
      await shot(page, "after-followup-text");
      await wizard(page, "next").click();
      await choice(page, pick.meals).click();
      await page.waitForTimeout(300);
      await shot(page, "after-review");
      await page.close();

      const old = await open("form-wizard-old");
      await shot(old, "after-old-card");
      await old.close();

      const neighbour = await open("question");
      await shot(neighbour, "neighbour-question");
      await neighbour.close();
    }
  }
} catch (error) {
  failed = true;
  console.error(error);
  console.error(log.slice(-2000));
} finally {
  await browser?.close();
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* gone */ }
}
process.exit(failed ? 1 : 0);
