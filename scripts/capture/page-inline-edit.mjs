#!/usr/bin/env node
/**
 * Captures of the in-place edit of a page by its selection (#4099): select a
 * passage, the outline, the "Selected text" tag and the composer under it,
 * ask, the bot's new version drawn in place with Undo, Undo; English and
 * French, light and dark. Headless Chrome only, on the real ChatView of the
 * gallery (src/gallery/page-chat-real.html) with a page whose own frame runs
 * the server's real selection bridge (SELECTION_BRIDGE_SOURCE), selected
 * with real mouse and keyboard events.
 *
 * Each shot also draws the reference's rules for the same passage (its
 * roomy note editor, values read from the installed reference's CSS: 360
 * wide, 18 radius, .5 border, 8 padding and gap, 10 under the passage, ring
 * 4 off, 1.5 stroke, 8 radius, accent at 90 and 12 %) in a static page, and
 * puts both side by side with a point by point checklist.
 *
 *   node scripts/capture/page-inline-edit.mjs [--out DIR] [--port N] [--only NAME_PREFIX]
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SELECTION_BRIDGE_SOURCE } from "../../server/pages/published-pages-render.ts";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = resolve(arg("--out", join(here, "docs", "screenshots", "page-inline-edit")));
const port = Number(arg("--port", "5178"));
const only = arg("--only", "");
const chrome = process.env.SAGAX_CHROMIUM || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const WORDS = {
  en: {
    title: "Synthetic monthly report",
    lead: "Closed tickets, response times and backlog for a synthetic team.",
    long: "Over the month the team closed a large number of tickets across every queue, and although the first response time improved a little in the second half, the backlog that carried over from the previous month stayed high enough that a few of the older requests were still waiting on a reply when the period ended.",
    short: "The team closed more tickets and answered faster in the second half, but the older backlog is still not cleared.",
    other: "Synthetic figures and notes for the next section of the report.",
    prompt: "Can you tighten this paragraph?",
  },
  fr: {
    title: "Rapport mensuel synthétique",
    lead: "Billets fermés, délais de réponse et arriéré d'une équipe synthétique.",
    long: "Au cours du mois, l'équipe a fermé un grand nombre de billets dans toutes les files, et même si le premier délai de réponse s'est un peu amélioré en deuxième moitié, l'arriéré reporté du mois précédent est resté assez élevé pour que quelques vieilles demandes attendent encore une réponse à la fin de la période.",
    short: "L'équipe a fermé plus de billets et répondu plus vite en deuxième moitié, mais le vieil arriéré n'est pas encore résorbé.",
    other: "Chiffres et notes synthétiques pour la section suivante du rapport.",
    prompt: "Peux-tu resserrer ce paragraphe ?",
  },
};

const inner = (lang, dark, version) => {
  const w = WORDS[lang];
  return `<!doctype html><html lang="${lang}"><body style="font:16px/1.55 system-ui;margin:0;padding:72px 0 2rem;background:${dark ? "#0f1520" : "#fff"};color:${dark ? "#e8edf5" : "#111"}">
<main style="max-width:680px;margin:0 auto;padding:0 24px"><h1 style="margin:0 0 .5rem">${w.title}</h1><p>${w.lead}</p>
<h2>Section 1</h2><p>${w.other}</p><h2>Section 2</h2><p id="target">${version >= 2 ? w.short : w.long}</p><h2>Section 3</h2><p>${w.other}</p><p>${w.other}</p></main>
<script>${SELECTION_BRIDGE_SOURCE}</script></body></html>`;
};
const wrapper = (version, lang, dark) => `<!doctype html><html><body style="margin:0;height:100vh;background:${dark ? "#0f1520" : "#fff"}"><iframe src="/__inner?v=${version}&lang=${lang}&dark=${dark ? 1 : 0}" style="border:0;width:100%;height:100%" title="page"></iframe></body></html>`;

/** The reference's rules for one passage: what its note editor and ring
 * would be, from the passage's box (page pixels), as a static page. */
function referencePage({ lang, dark, size, rect, prompt, avatar, paragraph, bg, ink, accent }) {
  const left = Math.min(Math.max(8, rect.x), Math.max(8, size.width - 360 - 8));
  const top = rect.y + rect.h + 10;
  const elevated = dark ? "#262a31" : "#fff";
  const border = dark ? "#ffffff24" : "#1c1c1c1f";
  const shadow = "0 2px 6px #1c1c1c1a, 0 10px 24px #1c1c1c1a";
  return `<!doctype html><html lang="${lang}"><body style="margin:0;width:${size.width}px;height:${size.height}px;position:relative;overflow:hidden;background:${bg};color:${ink};font:16px/1.55 system-ui">
<div style="position:absolute;left:${paragraph.x}px;top:${paragraph.y}px;width:${paragraph.w}px">${paragraph.html}</div>
<div data-ref-ring style="position:absolute;box-sizing:border-box;left:${rect.x - 4}px;top:${rect.y - 4}px;width:${rect.w + 8}px;height:${rect.h + 8}px;border:1.5px solid color-mix(in srgb, ${accent} 90%, transparent);background:color-mix(in srgb, ${accent} 12%, transparent);border-radius:8px;border-top-left-radius:0"></div>
<div style="position:absolute;left:${rect.x - 4 - 1.5}px;top:${rect.y - 4 - 18}px;height:18px;padding:0 8px;border-radius:6px 6px 0 0;background:${accent};color:#fff;font:500 11px/18px system-ui;white-space:nowrap">${lang === "fr" ? "Texte sélectionné" : "Selected text"}</div>
<div data-ref-composer style="position:absolute;left:${left}px;top:${top}px;box-sizing:border-box;width:360px;min-height:44px;display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px;padding:8px;border-radius:18px;border:.5px solid ${border};background:${elevated};box-shadow:${shadow};font:14px/20px system-ui;color:${ink}">
  <span style="width:28px;height:28px;border-radius:50%;background:${avatar};flex:none"></span>
  <div style="flex:1 1 0;min-width:0;min-height:28px;box-sizing:border-box;padding:4px;border-radius:14px;font:14px/20px system-ui">${prompt}</div>
  <span style="width:28px;height:28px;border-radius:50%;background:${accent};flex:none;display:flex;align-items:center;justify-content:center"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg></span>
</div></body></html>`;
}

async function waitForServer(url, ms = 180_000) {
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
const shots = ["en", "fr"].flatMap((lang) => [{ lang, skin: "daylight", dark: false }, { lang, skin: "pulsatrix", dark: true }]);
try {
  const base = `http://127.0.0.1:${port}/src/gallery/page-chat-real.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  for (const shot of shots.filter((entry) => !only || `${entry.lang}-${entry.dark ? "dark" : "light"}`.startsWith(only))) {
    const scheme = shot.dark ? "dark" : "light";
    const tag = `${shot.lang}-${scheme}`;
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    page.setDefaultTimeout(120_000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error.message ?? error)));
    await page.route("**/pages/preview/**", (route) => {
      const version = Number(/\/(\d+)$/.exec(new URL(route.request().url()).pathname)?.[1] ?? 1);
      return route.fulfill({ status: 200, contentType: "text/html", body: wrapper(version, shot.lang, shot.dark) });
    });
    await page.route("**/__inner*", (route) => {
      const url = new URL(route.request().url());
      return route.fulfill({ status: 200, contentType: "text/html", body: inner(url.searchParams.get("lang") ?? "en", url.searchParams.get("dark") === "1", Number(url.searchParams.get("v") ?? 1)) });
    });
    await page.addInitScript(() => { window.__heard = []; window.addEventListener("message", (event) => { try { window.__heard.push(JSON.stringify(event.data).slice(0, 160)); } catch { /* not plain */ } }); });
    // a cold Vite on a busy machine can be slow to bundle the gallery: ask again
    for (let attempt = 0; ; attempt += 1) {
      await page.goto(`${base}?skin=${shot.skin}&lang=${shot.lang}&versions=1`, { waitUntil: "networkidle", timeout: 180_000 });
      const ready = await page.waitForSelector('[data-page-card] [data-page-open]:not([disabled])', { timeout: 60_000 }).then(() => true).catch(() => false);
      if (ready) break;
      if (attempt >= 3) throw new Error("the gallery did not draw the page card");
    }
    await page.focus('[data-page-card] [data-page-open]');
    await page.keyboard.press("Enter");
    await page.waitForSelector("[data-page-panel] iframe");
    await page.waitForTimeout(600);
    const note = { tag, errors, checks: {} };
    const innerFrame = () => page.frames().filter((frame) => !frame.isDetached() && frame.url().includes("/__inner")).at(-1);
    for (let i = 0; i < 50 && !innerFrame(); i += 1) await page.waitForTimeout(100);
    const frame = innerFrame();
    const target = await frame.evaluate(() => {
      const r = document.getElementById("target").getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    const frameBox = await page.locator("[data-page-viewer-frame], [data-page-panel] iframe").first().boundingBox();

    // a person who sees nothing select again: the same triple click, up to twice more
    note.retries = [];
    const composerShows = async (label) => {
      for (let attempt = 0; ; attempt += 1) {
        const shown = await page.waitForSelector("[data-page-selection-composer]", { timeout: 4_000 }).then(() => true).catch(() => false);
        if (shown) return;
        note.retries.push(label);
        if (attempt >= 2) {
          await page.screenshot({ path: join(outDir, `debug-${tag}.png`) });
          throw new Error(`no composer after ${label}`);
        }
        await page.mouse.click(frameBox.x + target.x + 60, frameBox.y + target.y + 12, { clickCount: 3 });
      }
    };
    // 1. a real triple click selects the paragraph; the outline, the tag and the composer come
    await page.mouse.click(frameBox.x + target.x + 60, frameBox.y + target.y + 12, { clickCount: 3 });
    await page.waitForSelector("[data-page-selection-composer='ready'] textarea", { timeout: 15_000 }).catch(async (error) => {
      note.heard = await page.evaluate(() => window.__heard);
      note.frames = page.frames().map((entry) => entry.url());
      console.log(JSON.stringify({ heard: note.heard, frames: note.frames, target, frameBox }));
      throw error;
    });
    note.checks.focusInField = await page.evaluate(() => document.activeElement?.closest("[data-page-selection-composer]") !== null);
    await page.keyboard.type(WORDS[shot.lang].prompt);
    await page.waitForTimeout(300);
    const geometry = await page.evaluate(() => {
      const rect = (node) => node ? (({ x, y, width, height }) => ({ x, y, w: width, h: height }))(node.getBoundingClientRect()) : null;
      const cs = (node) => node ? getComputedStyle(node) : null;
      const composer = document.querySelector("[data-page-selection-composer]");
      const ring = document.querySelector("[data-page-selection-outline]");
      const send = document.querySelector("[data-page-selection-send]");
      return {
        composer: rect(composer), ring: rect(ring), tag: rect(document.querySelector("[data-page-selection-tag]")), send: rect(send),
        composerStyle: composer && { width: cs(composer).width, radius: cs(composer).borderRadius, border: cs(composer).borderTopWidth, padding: cs(composer).padding, gap: cs(composer).gap, minHeight: cs(composer).minHeight },
        ringStyle: ring && { radius: cs(ring).borderRadius, stroke: cs(ring).borderTopWidth, color: cs(ring).borderTopColor, fill: cs(ring).backgroundColor },
        avatar: rect(composer?.querySelector("span")), field: rect(composer?.querySelector("textarea")),
        accent: getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim(),
        bg: getComputedStyle(document.body).backgroundColor,
      };
    });
    note.geometry = geometry;
    await page.screenshot({ path: join(outDir, `select-${tag}.png`) });

    // the reference's rules for the same passage, beside ours
    const passage = await page.evaluate(() => {
      const r = document.querySelector("[data-page-selection-outline]").getBoundingClientRect();
      return { x: r.x + 4, y: r.y + 4, w: r.width - 8, h: r.height - 8 };
    });
    const clip = {
      x: Math.max(0, Math.floor(Math.min(geometry.ring.x, geometry.composer.x) - 24)),
      y: Math.max(0, Math.floor(geometry.ring.y - 40)),
      width: 0, height: 0,
    };
    clip.width = Math.min(1280 - clip.x, Math.ceil(Math.max(geometry.ring.x + geometry.ring.w, geometry.composer.x + geometry.composer.w) + 24 - clip.x));
    clip.height = Math.min(800 - clip.y, Math.ceil(geometry.composer.y + geometry.composer.h + 24 - clip.y));
    await page.screenshot({ path: join(outDir, `crop-ours-${tag}.png`), clip });
    const ink = shot.dark ? "#e8edf5" : "#111";
    const ref = await browser.newPage({ viewport: { width: clip.width, height: clip.height }, deviceScaleFactor: 2 });
    const avatarColor = "#3aa876";
    const paragraphHtml = `<p style="margin:0">${WORDS[shot.lang].long}</p>`;
    await ref.setContent(referencePage({
      lang: shot.lang, dark: shot.dark, size: { width: clip.width, height: clip.height },
      rect: { x: passage.x - clip.x, y: passage.y - clip.y, w: passage.w, h: passage.h },
      prompt: WORDS[shot.lang].prompt, avatar: avatarColor, paragraph: { x: passage.x - clip.x, y: passage.y - clip.y, w: passage.w, html: paragraphHtml },
      bg: shot.dark ? "#0f1520" : "#fff", ink, accent: geometry.accent || "#1680f3",
    }));
    const refGeometry = await ref.evaluate(() => {
      const rect = (node) => (({ x, y, width, height }) => ({ x, y, w: width, h: height }))(node.getBoundingClientRect());
      return { composer: rect(document.querySelector("[data-ref-composer]")), ring: rect(document.querySelector("[data-ref-ring]")) };
    });
    await ref.screenshot({ path: join(outDir, `crop-reference-${tag}.png`) });
    await ref.close();
    const dx = (a, b) => Math.round(Math.abs(a - b) * 10) / 10;
    const ours = { composer: { ...geometry.composer, x: geometry.composer.x - clip.x, y: geometry.composer.y - clip.y }, ring: { ...geometry.ring, x: geometry.ring.x - clip.x, y: geometry.ring.y - clip.y } };
    // the composer's height follows its content (our avatar and field, the reference's): width, left, top and the ring are compared
    note.vsReference = {
      composerLeft: dx(ours.composer.x, refGeometry.composer.x), composerTop: dx(ours.composer.y, refGeometry.composer.y), composerWidth: dx(ours.composer.w, refGeometry.composer.w),
      composerHeight: { ours: Math.round(ours.composer.h), reference: Math.round(refGeometry.composer.h) },
      ringLeft: dx(ours.ring.x, refGeometry.ring.x), ringTop: dx(ours.ring.y, refGeometry.ring.y), ringWidth: dx(ours.ring.w, refGeometry.ring.w), ringHeight: dx(ours.ring.h, refGeometry.ring.h),
    };
    const sbs = await browser.newPage({ viewport: { width: clip.width * 2 + 48, height: clip.height + 96 }, deviceScaleFactor: 2 });
    const data = async (file) => `data:image/png;base64,${(await (await import("node:fs/promises")).readFile(join(outDir, file))).toString("base64")}`;
    const label = (text) => `<div style="font:600 13px system-ui;margin:0 0 8px;color:${shot.dark ? "#cdd6e4" : "#333"}">${text}</div>`;
    await sbs.setContent(`<body style="margin:0;padding:16px;background:${shot.dark ? "#06090f" : "#eef0f3"};display:flex;gap:16px">
<div>${label("Reference (rules and values read from the installed reference)")}<img src="${await data(`crop-reference-${tag}.png`)}" style="display:block;width:${clip.width}px"/></div>
<div>${label("Sagax (this change)")}<img src="${await data(`crop-ours-${tag}.png`)}" style="display:block;width:${clip.width}px"/></div></body>`);
    await sbs.screenshot({ path: join(outDir, `side-by-side-${tag}.png`) });
    await sbs.close();

    // 2. Enter sends: an ordinary message with the page and the passage; the bot's new version lands in place, with Undo
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    note.sent = await page.evaluate(() => window.__pageChatReal.sends.at(-1) ?? null);
    await page.evaluate(() => window.__pageChatReal.publish());
    await page.waitForSelector("[data-page-edit-undo]");
    await page.waitForTimeout(700);
    note.editedFrameSrc = await page.evaluate(() => document.querySelector("[data-page-viewer-frame]")?.getAttribute("src") ?? null);
    note.undoLine = await page.evaluate(() => document.querySelector("[data-page-edit-undo]")?.textContent?.trim() ?? null);
    await page.screenshot({ path: join(outDir, `edited-${tag}.png`) });

    // 3. Undo: the version asked about is drawn again
    await page.click("[data-page-edit-undo-button]");
    await page.waitForFunction(() => !document.querySelector("[data-page-edit-undo]"));
    await page.waitForTimeout(700);
    note.undoneFrameSrc = await page.evaluate(() => document.querySelector("[data-page-viewer-frame]")?.getAttribute("src") ?? null);
    note.undoCalls = await page.evaluate(() => window.__pageChatReal.sends.filter((entry) => entry && entry.api));
    await page.screenshot({ path: join(outDir, `undone-${tag}.png`) });

    // Escape in the page, a click elsewhere, and a keyboard selection
    const frame2 = innerFrame();
    await page.mouse.click(frameBox.x + target.x + 60, frameBox.y + target.y + 12, { clickCount: 3 });
    await composerShows("afterEscapeInPage");
    await frame2.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await page.waitForFunction(() => !document.querySelector("[data-page-selection-ask]"));
    await page.waitForTimeout(400);
    note.checks.escapeInPageDismisses = true;
    await page.mouse.click(frameBox.x + target.x + 60, frameBox.y + target.y + 12, { clickCount: 3 });
    await composerShows("afterEscapeInField");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("[data-page-selection-ask]"));
    await page.waitForTimeout(400);
    note.checks.escapeInFieldDismisses = true;
    note.checks.pageStillOpen = (await page.$("[data-page-panel]")) !== null;
    await page.mouse.click(frameBox.x + target.x + 60, frameBox.y + target.y + 12, { clickCount: 3 });
    await composerShows("afterClickOutside");
    await page.mouse.click(frameBox.x + 8, frameBox.y + frameBox.height - 8);
    await page.waitForFunction(() => !document.querySelector("[data-page-selection-ask]"));
    await page.waitForTimeout(400);
    note.checks.clickOutsideDismisses = true;
    // keyboard selection: put the caret at the start of the paragraph, Shift and the arrows
    await page.mouse.click(frameBox.x + target.x + 200, frameBox.y + target.y + 12);
    await page.waitForTimeout(500);
    await innerFrame().evaluate(() => { const p = document.getElementById("target"); window.focus(); getSelection().collapse(p.firstChild, 0); });
    // headless Chrome does not turn Shift and an arrow key into a selection change
    // (the browser's editing commands are not run for scripted keys): the same
    // change is made as the browser makes it, one character at a time, with no
    // pointer and no Shift keyup, so only the frame's selection watch can report it
    await innerFrame().evaluate(() => { for (let i = 0; i < 24; i += 1) getSelection().modify("extend", "forward", "character"); });
    await page.waitForSelector("[data-page-selection-composer]", { timeout: 5000 }).then(() => { note.checks.keyboardSelectionOpens = true; }).catch(async () => {
      note.checks.keyboardSelectionOpens = false;
      note.keyboardDebug = { selected: await innerFrame().evaluate(() => String(getSelection()).slice(0, 60)), active: await innerFrame().evaluate(() => document.hasFocus()), heard: (await page.evaluate(() => window.__heard)).slice(-4) };
    });
    await page.screenshot({ path: join(outDir, `keyboard-${tag}.png`) });
    notes.push(note);
    console.log(tag, JSON.stringify({ vsReference: note.vsReference, checks: note.checks, sent: note.sent?.dataContext?.page?.selection ? "selection sent" : note.sent, errors }));
    await page.close();
  }
  await writeFile(join(outDir, "capture.json"), JSON.stringify(notes, null, 2) + "\n");
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
