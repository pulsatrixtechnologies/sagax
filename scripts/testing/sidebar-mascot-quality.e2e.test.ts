// The sidebar's shape mascots are sharp and alive (#5404), in a real browser
// at a device pixel ratio of 2 (a Retina screen), headless, on the gallery's
// shell (every name synthetic): a pinned tile and thirty rows of bots in the
// Fluffy material.
//   - sharpness: the canvas the engine paints holds as many pixels as the
//     screen shows it over. It used to be enlarged 1.6 times by a CSS
//     transform the engine could not see: 104 pixels over 166.
//   - motion: a mascot's drawing changes while one watches; under reduced
//     motion it does not.
//   - cost: however many bots are on screen, no more mascots live at once
//     than the page has seats (shape-alive.ts), and the others wait as stills.
//
// Needs a Chromium for Playwright: its own download, or SAGAX_CAPTURE_CHROME
// (a chrome-headless-shell or Chrome binary). Without one it is skipped with
// a notice; SAGAX_UI_E2E=1 makes the missing browser a failure.
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir } from "../../server/testing/cleanup.ts";
import { ALIVE_SEATS } from "../../src/components/shape-alive.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const executablePath = process.env.SAGAX_CAPTURE_CHROME || (() => {
  try { return chromium.executablePath(); } catch { return ""; }
})();
const available = Boolean(executablePath) && existsSync(executablePath);
const required = process.env.SAGAX_UI_E2E === "1";
if (!available && !required) console.log("skipping sidebar-mascot-quality ui e2e: no Chromium for Playwright (pnpm exec playwright install chromium, or SAGAX_CAPTURE_CHROME)");
const suite = available || required ? describe : describe.skip;

const TILE = "button:has([data-sidebar-tile-labels])";
const ROW = "[data-sidebar-bot-row]";

/** A mascot's canvas: the size it is shown at (transforms included), the pixels it holds, and any enlargement between the two. */
const readCanvas = (selector: string) => {
  const canvas = document.querySelector<HTMLCanvasElement>(`${selector} .shape-mascot canvas`);
  if (!canvas) return null;
  const shown = canvas.getBoundingClientRect().width;
  return { shown, laidOut: canvas.offsetWidth, pixels: canvas.width, needed: shown * window.devicePixelRatio, ratio: canvas.width / (shown * window.devicePixelRatio) };
};

/** A fingerprint of the pixels a mascot's canvas holds. */
const pixels = (selector: string) => {
  const canvas = document.querySelector<HTMLCanvasElement>(`${selector} .shape-mascot canvas`);
  const data = canvas?.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data;
  if (!data) return null;
  let hash = 0;
  for (let i = 0; i < data.length; i += 5) hash = (hash * 31 + data[i]!) | 0;
  return hash;
};

suite("the sidebar's shape mascots are sharp and alive", () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "sidebar-mascot-e2e-"));
  let gallery: ViteDevServer | undefined;
  let browser: Browser | undefined;
  let url = "";
  let webgl2 = false;

  async function open(options: { height?: number; reducedMotion?: "reduce" | "no-preference" } = {}): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser!.newContext({ viewport: { width: 1280, height: options.height ?? 860 }, deviceScaleFactor: 2, reducedMotion: options.reducedMotion ?? "no-preference" });
    context.setDefaultTimeout(120_000);
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load" });
    await page.waitForSelector(`${TILE} .shape-mascot`);
    if (webgl2) {
      // every mascot on screen painted by the engine
      await page.waitForFunction(([tile, row]) => [tile, row].every((selector) => (document.querySelector<HTMLCanvasElement>(`${selector} .shape-mascot canvas`)?.width ?? 0) > 1), [TILE, ROW] as const);
    }
    await page.waitForTimeout(800);
    return { context, page };
  }

  /**
   * How many different drawings a mascot shows over two seconds, looked at
   * ten times. A live mascot is redrawn thirty times a second: nearly every
   * look differs. A still is painted once, and again when its row is drawn
   * again: one drawing, two at most.
   */
  async function drawings(page: Page, selector: string): Promise<number> {
    const seen = new Set<number | null>();
    for (let look = 0; look < 10; look += 1) {
      seen.add(await page.evaluate(pixels, selector));
      await page.waitForTimeout(200);
    }
    return seen.size;
  }

  beforeAll(async () => {
    gallery = await createServer({ root, configFile: join(root, "vite.gallery.config.ts"), cacheDir, logLevel: "error", server: { host: "127.0.0.1", port: 0 } });
    await gallery.listen();
    const address = gallery.httpServer!.address();
    const port = typeof address === "object" && address ? address.port : 0;
    url = `http://127.0.0.1:${port}/src/gallery/app-shell-sidebar.html?shapes=30&material=fluffy&skin=pulsatrix-light&lang=en`;
    browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_CAPTURE_CHROME ? { executablePath } : {}) });
    // a throwaway load: Vite optimizes dependencies on the first visit
    const warm = await browser.newPage();
    warm.setDefaultTimeout(300_000);
    await warm.goto(url, { waitUntil: "load" });
    await warm.waitForSelector(".shape-mascot");
    await warm.waitForTimeout(2500);
    webgl2 = await warm.evaluate(() => document.createElement("canvas").getContext("webgl2") !== null);
    await warm.close();
    if (!webgl2) console.log("sidebar-mascot-quality ui e2e: this browser has no WebGL2, the materials are drawn flat; the canvas checks are skipped");
  }, 600_000);

  afterAll(async () => {
    await browser?.close();
    await gallery?.close();
    await removeTempDir(cacheDir);
  });

  it("paints the tile's and a row's mascot with one pixel for each pixel of the screen", async () => {
    const { context, page } = await open();
    try {
      // nothing between the mascot and the sidebar enlarges it: the fill is its laid-out size
      const enlarged = await page.evaluate((selector) => {
        const found: string[] = [];
        for (let el = document.querySelector(`${selector} .shape-mascot`); el && !el.matches("aside, nav, body"); el = el.parentElement) {
          const { transform } = getComputedStyle(el);
          if (transform.startsWith("matrix(") && Number(transform.slice(7).split(",")[0]) > 1.01) found.push(transform);
        }
        return found;
      }, TILE);
      expect(enlarged).toEqual([]);
      if (!webgl2) return;
      for (const selector of [TILE, ROW]) {
        const canvas = await page.evaluate(readCanvas, selector);
        expect(canvas, selector).not.toBeNull();
        // the engine lays its bitmap out on whole device pixels: within one pixel of what is shown
        expect(Math.abs(canvas!.pixels - canvas!.needed), `${selector}: ${canvas!.pixels} pixels shown over ${canvas!.needed}`).toBeLessThanOrEqual(1.5);
        expect(canvas!.ratio, selector).toBeGreaterThan(0.98);
        // shown as it is laid out (a whole number of CSS px in offsetWidth): nothing enlarges it
        expect(Math.abs(canvas!.shown - canvas!.laidOut), selector).toBeLessThanOrEqual(1);
      }
      // the tile's mascot fills its 60 px box: about 83 px across, 166 pixels at a ratio of 2
      expect((await page.evaluate(readCanvas, TILE))!.pixels).toBeGreaterThan(150);
    } finally {
      await context.close();
    }
  });

  it("moves the tile's and a row's mascot, and holds them still under reduced motion", async () => {
    if (!webgl2) return;
    const alive = await open();
    try {
      expect(await drawings(alive.page, TILE), "the tile's mascot").toBeGreaterThanOrEqual(5);
      expect(await drawings(alive.page, ROW), "a row's mascot").toBeGreaterThanOrEqual(5);
      expect(await alive.page.locator(`${TILE} .shape-mascot[data-shape-alive]`).count()).toBe(1);
    } finally {
      await alive.context.close();
    }
    const reduced = await open({ reducedMotion: "reduce" });
    try {
      expect(await drawings(reduced.page, TILE), "the tile's mascot, reduced motion").toBeLessThanOrEqual(2);
      expect(await drawings(reduced.page, ROW), "a row's mascot, reduced motion").toBeLessThanOrEqual(2);
      expect(await reduced.page.locator(".shape-mascot[data-shape-alive]").count()).toBe(0);
    } finally {
      await reduced.context.close();
    }
  });

  it("keeps no more mascots alive than the page has seats, however many are on screen, and none off screen", async () => {
    // a window tall enough to show the thirty bots at once
    const tall = await open({ height: 2400 });
    try {
      const count = () => tall.page.evaluate(() => ({
        onScreen: [...document.querySelectorAll(".shape-mascot")].filter((el) => el.getBoundingClientRect().top < window.innerHeight).length,
        alive: document.querySelectorAll(".shape-mascot[data-shape-alive]").length,
      }));
      const first = await count();
      expect(first.onScreen).toBeGreaterThan(ALIVE_SEATS);
      expect(first.alive).toBe(ALIVE_SEATS);
      // the mascots at rest take turns: after a while, others are alive
      const who = () => tall.page.evaluate(() => [...document.querySelectorAll(".shape-mascot")].map((el, i) => (el.hasAttribute("data-shape-alive") ? i : -1)).filter((i) => i >= 0).join(","));
      const before = await who();
      await tall.page.waitForTimeout(4500);
      expect(await who()).not.toBe(before);
      expect((await count()).alive).toBe(ALIVE_SEATS);
    } finally {
      await tall.context.close();
    }
    const usual = await open();
    try {
      const state = await usual.page.evaluate(() => {
        const all = [...document.querySelectorAll<HTMLElement>(".shape-mascot")];
        const far = all.filter((el) => el.getBoundingClientRect().top > window.innerHeight + 200);
        return { far: far.length, farAlive: far.filter((el) => el.hasAttribute("data-shape-alive")).length };
      });
      expect(state.far).toBeGreaterThan(0);
      expect(state.farAlive).toBe(0);
    } finally {
      await usual.context.close();
    }
  });
});
