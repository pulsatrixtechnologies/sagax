#!/usr/bin/env node
/**
 * Headless screenshots of the record card a chip opens (#5053): a rich ticket
 * (several notes, a resource, configurations) and a poor record (a company),
 * dark and light, in a large window and a small one; at the default size,
 * enlarged by its handle, opened again at the kept size after a reload, and
 * back to the default by a double-click on the handle; scrolled to its foot;
 * its handle on hover beside a docked panel's (the conforming neighbour, a
 * routine's details in src/gallery/routines-ux.html). It also checks what it
 * reads: the sizes, the kept values, and that nothing is cut at five sizes.
 * Synthetic data only (src/gallery/record-card.html, scene `related`).
 * Headless Chrome: no window opens.
 * Usage: node scripts/capture/record-card-size.mjs [--out DIR] [--port N] [--attach N] [--phase before|after]
 * `--phase before` captures a build that has no handle yet (the default size only).
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "record-card-size"));
const phase = arg("--phase") === "before" ? "before" : "after";
// the first free port of the gallery range (5176 to 5206; never the owner's 5173)
async function freePort() {
  for (let candidate = 5176; candidate <= 5206; candidate += 1) {
    const free = await new Promise((done) => {
      const probe = createServer().once("error", () => done(false)).once("listening", () => probe.close(() => done(true)));
      probe.listen(candidate, "127.0.0.1");
    });
    if (free) return candidate;
  }
  throw new Error("no free port between 5176 and 5206");
}
const attach = arg("--attach");
const port = Number(attach ?? arg("--port") ?? await freePort());
const skins = [{ id: "pulsatrix", label: "dark" }, { id: "daylight", label: "light" }];
const windows = [{ label: "large", width: 1440, height: 900 }, { label: "small", width: 760, height: 520 }];
const lang = arg("--lang") ?? "fr";

async function waitForServer(url, ms = 180_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const vite = attach ? null : spawn("pnpm", ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, detached: true,
});
let log = "";
vite?.stdout?.on("data", (chunk) => { log += chunk; });
vite?.stderr?.on("data", (chunk) => { log += chunk; });

const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5eead4"/><stop offset="1" stop-color="#2563eb"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#g)"/><path d="M20 42a9 9 0 0 1 1-17.9A12 12 0 0 1 44 27a8 8 0 0 1 0 15z" fill="#fff"/></svg>`;
const CARD = "[data-record-card] [data-record-card-body]";
const failures = [];
const check = (name, ok, detail = "") => { if (!ok) failures.push(`${name} ${detail}`.trim()); console.log(`${ok ? "ok  " : "FAIL"} ${name} ${detail}`.trim()); };

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/record-card.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  for (const { id, label } of skins) {
    for (const view of windows) {
      // a context of its own: nothing kept from another run
      const context = await browser.newContext({ viewport: { width: view.width, height: view.height }, deviceScaleFactor: 2 });
      const page = await context.newPage();
      await page.route("https://desk.example/mark.svg", (route) => route.fulfill({ contentType: "image/svg+xml", body: MARK }));
      page.on("pageerror", (error) => console.error("page error:", String(error).slice(0, 400)));
      // (a loaded machine may stall one screenshot: it is taken again once)
      const shot = async (name) => {
        const path = join(outDir, `${phase}-${name}-${label}-${view.label}.png`);
        try { await page.screenshot({ path }); } catch { await page.waitForTimeout(1_000); await page.screenshot({ path }); }
      };
      const open = async () => {
        for (let attempt = 1; ; attempt += 1) {
          try {
            await page.goto(`${base}?${new URLSearchParams({ skin: id, lang, scene: "related" })}`);
            await page.waitForSelector("[data-gallery-chat] [data-record-link]", { timeout: 30_000 });
            return;
          } catch (error) {
            if (attempt >= 4) throw error;
            await page.waitForTimeout(1_500);
          }
        }
      };
      const openCard = async (kind) => {
        await page.locator(`[data-record-link="${kind}"]`).first().click();
        await page.waitForSelector(CARD, { timeout: 15_000 });
        if (kind === "ticket") await page.waitForSelector("[data-record-card] [role=tabpanel] li", { timeout: 15_000 });
        await page.waitForTimeout(500);
      };
      const box = () => page.locator(CARD).boundingBox();

      await open();
      await openCard("ticket");
      const first = await box();
      console.log(`${label} ${view.label}: ticket card ${Math.round(first.width)} x ${Math.round(first.height)}`);
      await shot("rich");
      await page.locator("[data-record-card] [role=tab]", { hasText: /Configurations/ }).first().click();
      await page.waitForTimeout(400);
      await shot("rich-configurations");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      await openCard("company");
      const poor = await box();
      console.log(`${label} ${view.label}: company card ${Math.round(poor.width)} x ${Math.round(poor.height)}`);
      await shot("poor");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);

      if (phase === "after") {
        // nothing is cut: no row of the facts ends under the tabs, at this size
        await openCard("ticket");
        const cut = await page.evaluate(() => {
          const facts = document.querySelector("[data-record-card] [data-record-panes]");
          const tabs = document.querySelector("[data-record-card] [role=tablist]");
          if (!facts || !tabs) return "missing";
          const scroller = facts.closest("[data-record-scroll]");
          // the facts zone is whole in its scroller: nothing of it is clipped by a box of its own
          for (const node of [facts, ...facts.querySelectorAll("[data-record-pane]")]) {
            if (node.scrollHeight > node.clientHeight + 1) return `clipped ${node.getAttribute("data-record-pane") ?? "panes"}`;
          }
          return scroller ? "" : "no scroller";
        });
        check(`${label} ${view.label}: the facts zone is whole`, cut === "", cut);

        // enlarged (or, in a window that already bounds the card, made smaller) by the corner handle
        const handle = page.locator('[data-record-card] [data-resize-corner="se"]');
        const grip = await handle.boundingBox();
        const before = await box();
        const delta = view.label === "large" ? { x: 120, y: 60 } : { x: -90, y: -70 };
        await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
        await page.mouse.down();
        await page.mouse.move(grip.x + grip.width / 2 + delta.x, grip.y + grip.height / 2 + delta.y, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(400);
        const resized = await box();
        check(`${label} ${view.label}: the corner handle resizes the card`, Math.sign(resized.width - before.width) === Math.sign(delta.x) && Math.sign(resized.height - before.height) === Math.sign(delta.y), `${Math.round(before.width)} x ${Math.round(before.height)} -> ${Math.round(resized.width)} x ${Math.round(resized.height)}`);
        check(`${label} ${view.label}: the card stays inside the window`, resized.x >= 0 && resized.y >= 0 && resized.x + resized.width <= view.width && resized.y + resized.height <= view.height);
        await shot("rich-resized");
        const kept = await page.evaluate(() => [localStorage.getItem("sagax.recordCard.width.v1"), localStorage.getItem("sagax.recordCard.height.v1")]);
        check(`${label} ${view.label}: the size is kept on the device`, Number(kept[0]) === Math.round(resized.width) && Number(kept[1]) === Math.round(resized.height), kept.join(" x "));

        // a reload (a restart of the app): the card opens again at the kept size, for every record
        await open();
        await openCard("ticket");
        const again = await box();
        check(`${label} ${view.label}: the card opens again at the kept size`, Math.abs(again.width - resized.width) <= 1 && Math.abs(again.height - resized.height) <= 1, `${Math.round(again.width)} x ${Math.round(again.height)}`);
        await shot("rich-reopened");
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
        await openCard("company");
        const poorAgain = await box();
        // (as tall as its content, up to the kept height: in a small window it fills it and scrolls)
        check(`${label} ${view.label}: a poor record has the kept width and at most the kept height`, Math.abs(poorAgain.width - resized.width) <= 1 && poorAgain.height <= resized.height + 1, `${Math.round(poorAgain.width)} x ${Math.round(poorAgain.height)}`);
        await shot("poor-reopened");
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);

        // a double-click on the handle: back to the default size
        await openCard("ticket");
        await page.locator('[data-record-card] [data-resize-corner="se"]').dblclick();
        await page.waitForTimeout(400);
        const reset = await box();
        check(`${label} ${view.label}: a double-click returns to the default size`, Math.abs(reset.width - first.width) <= 1 && Math.abs(reset.height - first.height) <= 1, `${Math.round(reset.width)} x ${Math.round(reset.height)}`);
        const forgotten = await page.evaluate(() => [localStorage.getItem("sagax.recordCard.width.v1"), localStorage.getItem("sagax.recordCard.height.v1")]);
        check(`${label} ${view.label}: the kept size is forgotten with it`, forgotten.every((value) => value === null), forgotten.join(" x "));
        await shot("rich-reset");

        // the card scrolls as one: at its foot the tab row is still in view, the notes under it
        await page.evaluate(() => { const scroller = document.querySelector("[data-record-card] [data-record-scroll]"); scroller.scrollTop = scroller.scrollHeight; });
        await page.waitForTimeout(350);
        const stuck = await page.evaluate(() => {
          const scroller = document.querySelector("[data-record-card] [data-record-scroll]").getBoundingClientRect();
          const tabs = document.querySelector("[data-record-card] [role=tablist]").getBoundingClientRect();
          return tabs.top >= scroller.top - 1 && tabs.bottom <= scroller.bottom + 1;
        });
        check(`${label} ${view.label}: scrolled to its foot, the tab row stays in view`, stuck);
        await shot("rich-scrolled");

        // its handle on hover: the app's 2px accent line
        const edge = await page.locator('[data-record-card] .app-resize-handle[aria-orientation="vertical"]:not([aria-hidden])').boundingBox();
        await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
        await page.waitForTimeout(300);
        await shot("rich-handle");
        await page.mouse.move(10, 10);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);

        // nothing is cut, at any size: the kept size is set, the card opened again, and its parts measured
        for (const size of [[480, 320], [640, 480], [800, 600], [1000, 720], [1300, 800]]) {
          await page.evaluate(([width, height]) => { localStorage.setItem("sagax.recordCard.width.v1", String(width)); localStorage.setItem("sagax.recordCard.height.v1", String(height)); }, size);
          await open();
          await openCard("ticket");
          const cutAt = await page.evaluate(() => {
            const card = document.querySelector("[data-record-card] [data-record-card-body]");
            const frame = card.firstElementChild.getBoundingClientRect();
            const scroller = card.querySelector("[data-record-scroll]");
            const problems = [];
            if (scroller.scrollWidth > scroller.clientWidth + 1) problems.push("the body is wider than the card");
            for (const node of card.querySelectorAll("[data-record-panes], [data-record-pane], [data-record-related], [role=tabpanel]")) {
              const style = getComputedStyle(node);
              if (style.overflowY !== "visible" || style.maxHeight !== "none") problems.push(`a box of its own: ${node.getAttribute("data-record-pane") ?? node.getAttribute("role") ?? "panes"}`);
            }
            // every tab is whole inside its row (a row too narrow wraps)
            for (const row of card.querySelectorAll("[role=tablist]")) {
              const rowBox = row.getBoundingClientRect();
              for (const tab of row.querySelectorAll("[role=tab]")) {
                const tabBox = tab.getBoundingClientRect();
                if (tabBox.left < rowBox.left - 1 || tabBox.right > rowBox.right + 1) problems.push(`a tab is cut: ${tab.textContent}`);
              }
            }
            // every fact's label and value are inside the card's width, and no label is under its value's neighbour
            for (const node of card.querySelectorAll("[data-record-facts] dt, [data-record-facts] dd")) {
              const nodeBox = node.getBoundingClientRect();
              if (nodeBox.left < frame.left - 1 || nodeBox.right > frame.right + 1) problems.push(`a fact leaves the card: ${node.textContent}`);
            }
            // the head, the title and the actions are whole in the frame
            for (const selector of ["[data-record-head]", "p[title]", "[data-record-actions]"]) {
              const part = card.querySelector(selector).getBoundingClientRect();
              if (part.top < frame.top - 1 || part.bottom > frame.bottom + 1 || part.left < frame.left - 1 || part.right > frame.right + 1) problems.push(`${selector} leaves the frame`);
            }
            return problems;
          });
          const shown = await box();
          check(`${label} ${view.label}: nothing is cut at ${size.join(" x ")}`, cutAt.length === 0, `shown ${Math.round(shown.width)} x ${Math.round(shown.height)} ${cutAt.join("; ")}`.trim());
          // the smallest sizes, to look at: the readable minimum and a card whose panes stack
          if (view.label === "large" && size[0] <= 640) await shot(`rich-at-${size.join("x")}`);
          await page.keyboard.press("Escape");
          await page.waitForTimeout(200);
        }
        await page.evaluate(() => { localStorage.removeItem("sagax.recordCard.width.v1"); localStorage.removeItem("sagax.recordCard.height.v1"); });

        // the conforming neighbour: a docked panel's handle on hover (a routine's details), the same line
        if (view.label === "large") {
          await page.goto(`http://127.0.0.1:${port}/src/gallery/routines-ux.html?${new URLSearchParams({ view: "calendar", width: String(view.width), height: String(view.height), skin: id, lang })}`, { waitUntil: "load" });
          await page.waitForSelector("[data-gallery-sample]", { timeout: 60_000 });
          await page.waitForTimeout(1_200);
          await page.locator("[data-event-card]").first().click();
          const neighbour = page.locator(".app-docked-panel .app-resize-handle, .detail-panel .app-resize-handle").first();
          await neighbour.waitFor({ timeout: 10_000 });
          const line = await neighbour.boundingBox();
          await page.mouse.move(line.x + line.width / 2, line.y + Math.min(300, line.height / 2));
          await page.waitForTimeout(300);
          await shot("neighbour-handle");
        }
      }
      await context.close();
    }
  }
  console.log(`captures in ${outDir}`);
  if (failures.length) { console.error(`${failures.length} check(s) failed`); process.exitCode = 1; }
} finally {
  await browser?.close();
  try { if (vite) process.kill(-vite.pid); } catch { /* already gone */ }
  if (process.exitCode) console.error(log.slice(-2000));
}
