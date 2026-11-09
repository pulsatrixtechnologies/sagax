#!/usr/bin/env node
/**
 * #3214: headless screenshots of the card pinned over the composer with what
 * the bot waits on: one question, two (with "1 of 2"), the folded line, an
 * approval next to a question; light and dark, 1440 and 390 wide; and the
 * existing transcript cards as the "before" reference.
 * Synthetic data only. Headless Chrome: no window opens.
 * Usage: node scripts/capture/pinned-card.mjs [--out DIR] [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "pinned-card"));
const port = Number(arg("--port") ?? 5240);
const CASES = ["question", "two", "collapsed", "approval"];
const SKINS = ["daylight", "midnight"];
const WIDTHS = [1440, 390];

async function waitForServer(url, ms = 180_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const vite = spawn("pnpm", ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" },
  detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/`;
  await waitForServer(`${base}pinned-card.html`);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}),
  });
  const found = {};
  // before: the transcript's own cards, as they are today
  for (const skin of SKINS) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await page.goto(`${base}question-cards.html?${new URLSearchParams({ skin, lang: "fr" })}`, { waitUntil: "load" });
    await page.waitForSelector("[data-ask-card]");
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(outDir, `before-question-cards-${skin}.png`), fullPage: false });
    await page.goto(`${base}approval-card.html?${new URLSearchParams({ skin, lang: "fr", card: "command" })}`, { waitUntil: "load" });
    await page.waitForSelector('[data-shot="approval-card"]');
    await page.waitForTimeout(400);
    await page.locator('[data-shot="approval-card"]').screenshot({ path: join(outDir, `before-approval-card-${skin}.png`) });
    await page.close();
  }
  // after: the pinned card, every case, both skins, both widths; English once
  const runs = [];
  for (const skin of SKINS) for (const width of WIDTHS) for (const which of CASES) runs.push({ lang: "fr", skin, width, which });
  runs.push({ lang: "en", skin: "daylight", width: 1440, which: "two" });
  for (const run of runs) {
    const page = await browser.newPage({ viewport: { width: run.width, height: run.width < 600 ? 760 : 640 }, deviceScaleFactor: 2 });
    const query = new URLSearchParams({ skin: run.skin, lang: run.lang, case: run.which, width: String(run.width) });
    await page.goto(`${base}pinned-card.html?${query}`, { waitUntil: "load" });
    await page.waitForSelector("[data-pinned-waiting]");
    await page.waitForTimeout(500);
    const name = `${run.which}-${run.width}-${run.skin}-${run.lang}`;
    await page.locator('[data-shot="chat"]').screenshot({ path: join(outDir, `${name}.png`) });
    found[name] = {
      state: await page.locator("[data-pinned-waiting]").getAttribute("data-pinned-waiting"),
      title: await page.locator("[data-pinned-title], [data-pinned-folded-line]").first().textContent(),
      stepper: await page.locator("[data-approval-stepper]").count() ? await page.locator("[data-approval-stepper]").textContent() : null,
      choices: await page.locator("[data-pinned-waiting] [data-ask-choice]").count(),
    };
    // the regression in the browser: a scroll keeps the card, an answer removes it
    if (run.which === "question" && run.width === 1440 && run.skin === "daylight") {
      await page.mouse.wheel(0, 2000);
      await page.waitForTimeout(200);
      found[name].afterScroll = await page.locator("[data-pinned-waiting]").count();
      await page.locator("[data-pinned-waiting] [data-ask-choice]").first().click();
      await page.waitForTimeout(400);
      found[name].afterAnswer = await page.locator('[data-pinned-waiting] [data-ask-card="pending"]').count();
      found[name].decisions = await page.evaluate(() => window.__decisions.map((action) => action.type));
      await page.locator('[data-shot="chat"]').screenshot({ path: join(outDir, `${name}-answered.png`) });
    }
    await page.close();
  }
  await writeFile(join(outDir, "found.json"), `${JSON.stringify(found, null, 2)}\n`);
  await writeFile(join(outDir, "README.md"), `# Pinned waiting card (#3214)

Synthetic gallery captures of the card pinned over the composer with what the
bot waits on: one question, two ("1 of 2" with arrows), the folded one-line
form, an approval next to a question. Light (daylight) and dark (midnight),
1440 and 390 wide, French with one English reference. \`before-*\` are the
transcript's existing question and approval cards, for comparison.
Generated by \`node scripts/capture/pinned-card.mjs\`. No real person data.
`);
  console.log(`screenshots in ${outDir}`);
  console.log(JSON.stringify(found));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (log) console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* already gone */ }
}
