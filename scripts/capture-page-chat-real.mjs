#!/usr/bin/env node
/**
 * Lot 5 captures of Pages and chat on the REAL ChatView (gallery
 * src/gallery/page-chat-real.html: real Composer, PageSurface, page cards,
 * real reducer, synthetic data). Headless Chrome only.
 *
 * Drives each shot like a person: scroll the transcript up, open the v1
 * card, optionally Show conversation, type and send, Back to chat. Records
 * what the DOM says (layout attributes, panel and dock geometry, the
 * placeholder and accessible name, the context the send carried, the scroll
 * place and focus after closing) next to the PNGs.
 *
 *   node scripts/capture-page-chat-real.mjs [--tree DIR] [--prefix after] [--out DIR] [--port N]
 *
 * --tree serves another checkout of the app (for example a worktree at the
 * lot's base commit, with this gallery copied in) to take "before" shots of
 * the same flow. SAGAX_CHROMIUM overrides the Chrome binary.
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const tree = resolve(arg("--tree", here));
const prefix = arg("--prefix", "after");
const outDir = resolve(arg("--out", join(here, "docs", "screenshots", "grok-convergence", "real-chatview")));
const port = Number(arg("--port", "5313"));
const chrome = process.env.SAGAX_CHROMIUM || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const PREVIEW = (dark) => `<!doctype html><html><body style="font:16px/1.55 system-ui;margin:0;padding:72px 2rem 2rem;background:${dark ? "#0f1520" : "#fff"};color:${dark ? "#e8edf5" : "#111"}">
<h1 style="margin:0 0 .5rem">Synthetic monthly report</h1><p>Closed tickets, response times and backlog for a synthetic team.</p>
${Array.from({ length: 6 }, (_, i) => `<h2>Section ${i + 1}</h2><p>${"Synthetic figures and notes. ".repeat(18)}</p>`).join("")}</body></html>`;

// width x height: Grok's measured macOS window (1338 x 809), its 700 px
// narrow state, and a 390 px phone.
const shots = [
  { name: "desktop-dark-chat", skin: "pulsatrix", width: 1338, height: 809, open: false },
  { name: "desktop-dark-stage", skin: "pulsatrix", width: 1338, height: 809, open: "stage", send: true, close: true },
  { name: "desktop-light-stage", skin: "daylight", width: 1338, height: 809, open: "stage" },
  { name: "desktop-dark-beside", skin: "pulsatrix", width: 1338, height: 809, open: "beside" },
  { name: "desktop-dark-stage-fr", skin: "pulsatrix", width: 1338, height: 809, open: "stage", lang: "fr" },
  { name: "w700-dark-stage", skin: "pulsatrix", width: 700, height: 809, open: "stage", close: true },
  { name: "w390-light-stage", skin: "daylight", width: 390, height: 844, open: "stage", send: true, close: true },
  { name: "w390-dark-stage", skin: "pulsatrix", width: 390, height: 844, open: "stage" },
];

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
  [join(tree, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: tree, stdio: "ignore", env: { ...process.env, NODE_ENV: "development" } },
);
let browser;
const notes = [];
try {
  const base = `http://127.0.0.1:${port}/src/gallery/page-chat-real.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  for (const shot of shots) {
    const page = await browser.newPage({ viewport: { width: shot.width, height: shot.height }, deviceScaleFactor: 2 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error.message ?? error)));
    await page.route("**/pages/preview/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: PREVIEW(shot.skin !== "daylight") }));
    await page.goto(`${base}?skin=${shot.skin}&lang=${shot.lang ?? "en"}`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-gallery-page-chat-real] [data-composer-dock] textarea");
    // the first card is v1 (older trees have no data-page-card-version)
    await page.waitForSelector('[data-page-card] [data-page-open]:not([disabled])');
    await page.evaluate(() => document.querySelector("[data-page-card]")?.setAttribute("data-capture-v1", ""));
    const note = { file: `${prefix}-${shot.name}.png`, tree: tree === here ? "this worktree" : tree, ...shot };
    // a place in the middle of the transcript, to find again after the page
    note.scrollBefore = await page.evaluate(() => {
      const scroller = document.querySelector("[data-chat-column] .overflow-y-auto, main .overflow-y-auto");
      if (!scroller) return null;
      scroller.scrollTop = Math.max(0, Math.round((scroller.scrollHeight - scroller.clientHeight) / 2));
      scroller.dispatchEvent(new Event("scroll"));
      return scroller.scrollTop;
    });
    note.v1CardState = await page.getAttribute('[data-capture-v1] [data-page-card-state]', "data-page-card-state");
    if (shot.open) {
      await page.evaluate(() => document.querySelector('[data-capture-v1]')?.scrollIntoView({ block: "center" }));
      note.scrollBefore = await page.evaluate(() => document.querySelector("[data-chat-column] .overflow-y-auto, main .overflow-y-auto")?.scrollTop ?? null);
      await page.focus('[data-capture-v1] [data-page-open]');
      await page.keyboard.press("Enter");
      await page.waitForSelector("[data-page-panel] iframe");
      await page.waitForTimeout(400);
      if (shot.open === "beside") {
        await page.click("[data-page-more] > button");
        const item = page.getByRole("menuitem", { name: /Show conversation|Afficher la conversation/ });
        note.besideOffered = (await item.count()) > 0;
        if (note.besideOffered) {
          await item.click();
          await page.waitForSelector("main[data-page-beside]");
        } else {
          await page.keyboard.press("Escape");
        }
        await page.waitForTimeout(300);
      }
      note.layout = await page.evaluate(() => {
        const host = document.querySelector("main");
        const panel = document.querySelector("[data-page-panel]");
        const docks = [...document.querySelectorAll("[data-composer-dock]")];
        const dock = docks.find((node) => node.querySelector("textarea")) ?? docks[0];
        const input = dock?.querySelector("textarea");
        const rect = (node) => node ? (({ x, y, width, height }) => ({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }))(node.getBoundingClientRect()) : null;
        const column = document.querySelector("[data-chat-column]");
        return {
          viewport: { width: innerWidth, height: innerHeight },
          host: rect(host),
          panel: rect(panel),
          chatColumn: rect(column),
          chatInert: column ? column.hasAttribute("inert") : null,
          cover: host?.hasAttribute("data-page-cover") ?? null,
          beside: host?.hasAttribute("data-page-beside") ?? null,
          surfaceMode: panel?.getAttribute("data-page-surface-mode") ?? null,
          docks: docks.length,
          dock: rect(dock),
          dockOnPage: Boolean(dock && panel?.contains(dock)),
          stageChat: dock?.getAttribute("data-page-stage-chat") ?? null,
          placeholder: input?.getAttribute("placeholder") ?? null,
          ariaLabel: input?.getAttribute("aria-label") ?? null,
          closeLabel: document.querySelector("[data-page-close]")?.getAttribute("aria-label") ?? null,
        };
      });
    }
    if (shot.send) {
      const input = page.locator("[data-composer-dock] textarea").first();
      await input.click();
      await input.fill(shot.lang === "fr" ? "Resserre le résumé." : "Tighten the summary.");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);
      note.sent = await page.evaluate(() => window.__pageChatReal.sends.at(-1) ?? null);
    }
    await page.screenshot({ path: join(outDir, note.file), fullPage: false });
    if (shot.close) {
      // Escape from the empty docked composer, else the Back to chat button
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
      if (await page.$("[data-page-panel]")) {
        note.escapeClosed = false;
        await page.click("[data-page-close]");
      } else {
        note.escapeClosed = true;
      }
      await page.waitForSelector("[data-page-panel]", { state: "detached" });
      await page.waitForTimeout(300);
      note.afterClose = await page.evaluate(() => {
        const scroller = document.querySelector("[data-chat-column] .overflow-y-auto, main .overflow-y-auto");
        const active = document.activeElement;
        return {
          scrollTop: scroller?.scrollTop ?? null,
          focus: active?.closest("[data-capture-v1]") ? "page card v1" : active?.tagName ?? null,
          dockInChat: Boolean(document.querySelector("[data-chat-column] [data-composer-dock], main > div [data-composer-dock]")),
        };
      });
      const closedFile = note.file.replace(/\.png$/, "-closed.png");
      await page.screenshot({ path: join(outDir, closedFile), fullPage: false });
      note.closedFile = closedFile;
    }
    note.errors = errors;
    notes.push(note);
    console.log(note.file, JSON.stringify({ layout: note.layout, sent: note.sent, afterClose: note.afterClose, errors }));
    await page.close();
  }
  await writeFile(join(outDir, `${prefix}-capture.json`), JSON.stringify(notes, null, 2) + "\n");
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
