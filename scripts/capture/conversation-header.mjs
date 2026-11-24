#!/usr/bin/env node
/**
 * Captures of Settings > Appearance > Conversation > "Conversation header"
 * (#4536): the real ChatView (gallery src/gallery/page-chat-real.html) with
 * the centred pill (the default) and with the title at the top left, and the
 * setting's row on the real Appearance page (gallery
 * src/gallery/panel-visibility.html), light and dark. Headless Chrome only.
 *
 *   node scripts/capture/conversation-header.mjs [--out DIR] [--port N] [--lang fr|en]
 *
 * SAGAX_CHROMIUM overrides the Chrome binary. Writes notes.json beside the
 * PNGs with what the DOM says (the bar's alignment, where the name sits).
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = resolve(arg("--out", join(here, "docs", "screenshots", "conversation-header")));
const port = Number(arg("--port", "5347"));
const lang = arg("--lang", "fr");
const chrome = process.env.SAGAX_CHROMIUM || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const KEY = "sagax.conversationHeader.v1";

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const vite = spawn(
  process.execPath,
  [join(here, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: here, stdio: "ignore", env: { ...process.env, NODE_ENV: "development" } },
);
let browser;
const notes = [];
try {
  const origin = `http://127.0.0.1:${port}`;
  await waitForServer(`${origin}/src/gallery/page-chat-real.html`);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  for (const [scheme, skin] of [["light", "daylight"], ["dark", "pulsatrix"]]) {
    for (const choice of ["pill", "title"]) {
      const page = await browser.newPage({ viewport: { width: 1338, height: 809 }, deviceScaleFactor: 2 });
      page.setDefaultTimeout(120_000);
      await page.addInitScript(([key, value]) => {
        if (value === "pill") localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }, [KEY, choice]);
      await page.goto(`${origin}/src/gallery/page-chat-real.html?skin=${skin}&lang=${lang}`, { waitUntil: "networkidle", timeout: 180_000 });
      await page.waitForSelector("[data-gallery-page-chat-real] [data-composer-dock] textarea");
      await page.waitForSelector("[data-chat-header-center] [data-bot-header-pill]");
      // The transcript scrolled a little, so what passes under the bar shows.
      await page.evaluate(() => {
        const scroller = document.querySelector("[data-chat-column] .overflow-y-auto, main .overflow-y-auto");
        if (scroller) {
          scroller.scrollTop = Math.max(0, scroller.scrollTop - 120);
          scroller.dispatchEvent(new Event("scroll"));
        }
      });
      await page.waitForTimeout(300);
      const file = `chat-${choice}-${scheme}.png`;
      await page.screenshot({ path: join(outDir, file) });
      notes.push({
        file,
        choice,
        ...(await page.evaluate(() => {
          const bar = document.querySelector("[data-chat-header-bar]");
          const center = document.querySelector("[data-chat-header-center]");
          const name = document.querySelector("[data-bot-header-pill]");
          const barBox = bar?.getBoundingClientRect();
          const nameBox = name?.getBoundingClientRect();
          return {
            align: center?.getAttribute("data-chat-header-align"),
            plainTitle: name?.hasAttribute("data-chat-title") ?? null,
            nameLeftInBar: barBox && nameBox ? Math.round(nameBox.left - barBox.left) : null,
            nameCentreOffset: barBox && nameBox ? Math.round(nameBox.left + nameBox.width / 2 - (barBox.left + barBox.width / 2)) : null,
            nameBackground: name ? getComputedStyle(name).backgroundColor : null,
            text: name?.textContent?.trim() ?? null,
          };
        })),
      });
      await page.close();
    }
    // The row on the Appearance page (no server behind the gallery: /api answers 404):
    // the default, then the other choice picked by hand.
    const page = await browser.newPage({ viewport: { width: 1338, height: 1200 }, deviceScaleFactor: 2 });
    page.setDefaultTimeout(120_000);
    await page.route((url) => url.pathname.startsWith("/api/"), (route) => route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"not found"}' }));
    await page.goto(`${origin}/src/gallery/panel-visibility.html?skin=${skin}&lang=${lang}`, { waitUntil: "networkidle", timeout: 180_000 });
    const row = page.locator('[data-settings-row="conversationHeader"]');
    await row.waitFor();
    const group = page.locator('[data-settings-group="conversation"]');
    const target = (await group.count()) ? group : row;
    await target.scrollIntoViewIfNeeded();
    await target.screenshot({ path: join(outDir, `settings-default-${scheme}.png`) });
    const before = (await row.innerText()).replace(/\s+/g, " ").trim();
    await row.getByRole("combobox").or(row.getByRole("button")).first().click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(outDir, `settings-choices-${scheme}.png`) });
    const options = await page.getByRole("option").or(page.getByRole("menuitemradio")).allInnerTexts();
    await page.getByRole("option").or(page.getByRole("menuitemradio")).nth(1).click();
    await page.waitForTimeout(250);
    await target.screenshot({ path: join(outDir, `settings-title-${scheme}.png`) });
    notes.push({ file: `settings-*-${scheme}.png`, rowBefore: before, options, rowAfter: (await row.innerText()).replace(/\s+/g, " ").trim(), stored: await page.evaluate((key) => localStorage.getItem(key), KEY) });
    await page.close();
  }
  await writeFile(join(outDir, "notes.json"), `${JSON.stringify(notes, null, 2)}\n`);
  console.log(JSON.stringify(notes, null, 2));
} finally {
  await browser?.close().catch(() => {});
  vite.kill("SIGTERM");
}
