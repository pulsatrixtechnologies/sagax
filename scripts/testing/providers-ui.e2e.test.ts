// Settings > Providers on the real renderer, headless (#4376). The owner on
// the screens of 0.8.119 and 0.8.120: "The sign out is duplicated weirdly",
// "it's not clickable, it's totally wrongly done", "I should be able to
// rename existing one. Api key should be a separate section", "confusing to
// go between two different pages". The page is the Settings gallery
// (src/gallery/settings-pages.html: the real SettingsModal on a stand-in /api
// that keeps renames, keys and model switches in memory), in a headless
// Chromium, with and without an organization, in English and French:
//   - a provider is one row and one target: a click anywhere on it opens its
//     page, its hover covers the whole row, no button overlaps another;
//   - an account is renamed in place and its name shows in the model menu;
//   - the API key section saves, replaces and removes a key;
//   - the models unfold in place, and a switch there is the switch Active
//     models shows.
//
// Needs a Chromium for Playwright: its own download, or SAGAX_CAPTURE_CHROME
// (a Chrome binary, run headless). Without one it is skipped with a notice;
// SAGAX_UI_E2E=1 makes the missing browser a failure. SAGAX_UI_PORT pins the
// gallery's port (any free port otherwise).
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { REPO_ROOT } from "./preview-fixture.ts";

const executablePath = process.env.SAGAX_CAPTURE_CHROME || (() => {
  try { return chromium.executablePath(); } catch { return ""; }
})();
const available = Boolean(executablePath) && existsSync(executablePath);
const required = process.env.SAGAX_UI_E2E === "1";
if (!available && !required) console.log("skipping providers ui e2e: no Chromium for Playwright (pnpm exec playwright install chromium, or SAGAX_CAPTURE_CHROME)");
const suite = available || required ? describe : describe.skip;

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;

const MODES = [
  { name: "without an organization", query: "providers=1&many=1", rows: 9 },
  { name: "with an organization", query: "providers=1&org=1", rows: 2 },
] as const;
const LANGS = [
  { lang: "en", connected: "Connected", page: "Accounts" },
  { lang: "fr", connected: "Connecté", page: "Comptes" },
] as const;

suite("Settings > Providers on the real renderer (#4376)", () => {
  let vite: ViteDevServer | undefined;
  let browser: Browser | undefined;
  let base = "";

  beforeAll(async () => {
    const port = Number(process.env.SAGAX_UI_PORT ?? 0);
    vite = await createServer({
      root: REPO_ROOT,
      configFile: join(REPO_ROOT, "vite.gallery.config.ts"),
      logLevel: "error",
      server: { host: "127.0.0.1", port, strictPort: port > 0 },
    });
    await vite.listen();
    base = `http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}/src/gallery/settings-pages.html`;
    browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_CAPTURE_CHROME ? { executablePath } : {}) });
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    await vite?.close();
  });

  async function open(query: string, lang = "en", width = 1100): Promise<Page> {
    const page = await browser!.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${base}?section=providers&lang=${lang}&${query}`);
    await page.waitForSelector("[data-providers-page] [data-provider], [data-provider-page] [data-settings-group]", { timeout: 120_000 });
    // every stand-in answer in (instances, accounts, keys, the bots link)
    await page.waitForLoadState("networkidle");
    return page;
  }

  /** The point a click lands on: what the page puts on top there. */
  const topAt = (page: Page, x: number, y: number) => page.evaluate(([px, py]) => {
    const element = document.elementFromPoint(px!, py!);
    return {
      row: element?.closest("[data-provider]")?.getAttribute("data-provider") ?? null,
      open: Boolean(element?.closest("[data-provider-open]")),
      action: Boolean(element?.closest("[data-provider-row-action]")),
    };
  }, [x, y]);

  for (const mode of MODES) {
    for (const words of LANGS) {
      describe(`${mode.name}, ${words.lang}`, () => {
        it("each provider is one row and one target: any point of it opens its page, an action sits on top and overlaps nothing", async () => {
          const page = await open(mode.query, words.lang);
          try {
            await expect.poll(() => page.locator("[data-providers-active] > [data-provider]").count(), { timeout: 60_000 }).toBeGreaterThanOrEqual(mode.rows);
            const ids = await page.$$eval("[data-providers-active] > [data-provider]", (rows) => rows.map((row) => row.getAttribute("data-provider")!));
            // no second line under a row: a row is its target, its words and at most one action
            expect(await page.$$("[data-providers-active] [data-provider-line]"), "no line of its own under a row").toHaveLength(0);
            for (const count of await page.$$eval("[data-providers-active] > [data-provider]", (rows) => rows.map((row) => row.querySelectorAll("button").length))) expect(count).toBeLessThanOrEqual(2);
            for (const id of ids) {
              const row = page.locator(`[data-providers-active] > [data-provider="${id}"]`);
              await row.scrollIntoViewIfNeeded();
              const box = (await row.boundingBox())!;
              const action = await row.locator("[data-provider-row-action]").count() ? await row.locator("[data-provider-row-action]").boundingBox() : null;
              const middle = box.y + box.height / 2;
              for (const x of [box.x + 6, box.x + 30, box.x + 90, box.x + box.width / 2, box.x + box.width - 8]) {
                if (action && x >= action.x - 2 && x <= action.x + action.width + 2) continue;
                expect(await topAt(page, x, middle), `${id} at x=${Math.round(x - box.x)}`).toEqual({ row: id, open: true, action: false });
              }
              for (const y of [box.y + 4, box.y + box.height - 4]) expect(await topAt(page, box.x + box.width / 2, y), `${id} edge`).toEqual({ row: id, open: true, action: false });
              if (action) {
                expect(await topAt(page, action.x + action.width / 2, action.y + action.height / 2), `${id}: the action is on top`).toEqual({ row: id, open: false, action: true });
                for (const text of await row.locator("[data-provider-summary], .font-medium").all()) {
                  const inner = await text.boundingBox();
                  if (inner) expect(overlaps(inner, action), `${id}: the action covers no words`).toBe(false);
                }
              }
              // the hover covers the whole row: the row itself takes it, every part of it inside
              await page.mouse.move(box.x + box.width / 2, middle);
              const hovered = await row.evaluate((li) => {
                const own = li.getBoundingClientRect();
                const inside = [...li.querySelectorAll("*")].every((child) => {
                  const r = child.getBoundingClientRect();
                  return r.width === 0 || (r.left >= own.left - 0.5 && r.right <= own.right + 0.5 && r.top >= own.top - 0.5 && r.bottom <= own.bottom + 0.5);
                });
                return { background: getComputedStyle(li).backgroundColor, inside };
              });
              expect(hovered.background, `${id} hover`).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
              expect(hovered.inside, `${id}: nothing outside the hovered row`).toBe(true);
            }
            // a click on the words opens the provider's page
            // a click on the words (they let it through to the row's target) opens the provider's page
            const first = page.locator(`[data-providers-active] > [data-provider="${ids[0]}"] .font-medium`).first();
            await first.scrollIntoViewIfNeeded();
            const words = (await first.boundingBox())!;
            await page.mouse.click(words.x + 4, words.y + words.height / 2);
            await page.waitForSelector(`[data-provider-page="${ids[0]}"]`);
          } finally {
            await page.close();
          }
        }, 180_000);

        it("on a provider's page no button overlaps another, and the sections say their names", async () => {
          const page = await open(`${mode.query}&subPage=providers.provider:openai`, words.lang);
          try {
            await expect.poll(() => page.locator('[data-provider-page="openai"]').innerText(), { timeout: 60_000 }).toContain(words.page);
            const boxes = (await page.$$eval('[data-provider-page="openai"] button', (buttons) => buttons
              .filter((button) => button.checkVisibility())
              .map((button) => { const r = button.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })))
              .filter((box) => box.width > 0 && box.height > 0);
            for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i]!, boxes[j]!), `buttons ${i} and ${j}`).toBe(false);
          } finally {
            await page.close();
          }
        }, 120_000);
      });
    }
  }

  it("renames an account on a solo server: the new name stays on the page and shows in the model menu", async () => {
    const page = await open("providers=1&subPage=providers.provider:anthropic");
    try {
      await page.click('[data-account-rename="account:claude"]');
      await page.fill('[data-account-name-input="account:claude"]', "Work plan");
      await page.keyboard.press("Enter");
      await expect.poll(() => page.locator('[data-account-name="account:claude"]').innerText()).toBe("Work plan");
      // back to the list and in again: still there
      await page.keyboard.press("Escape");
      await page.click('[data-providers-active] > [data-provider="anthropic"] [data-provider-open]');
      await expect.poll(() => page.locator('[data-account-name="account:claude"]').innerText()).toBe("Work plan");
      // the model chip of the chat names the account in use the same way
      await page.goto(`${base}?picker=chip&providers=1`);
      await expect.poll(() => page.locator("[data-model-account]").first().textContent(), { timeout: 60_000 }).toContain("Work plan");
    } finally {
      await page.close();
    }
  }, 180_000);

  it("renames an account in an organization for this person (French)", async () => {
    const page = await open("providers=1&org=1&subPage=providers.provider:openai", "fr");
    try {
      await page.click('[data-account-name="account:codex"]');
      await page.fill('[data-account-name-input="account:codex"]', "Mon forfait");
      await page.keyboard.press("Enter");
      await expect.poll(() => page.locator('[data-account-name="account:codex"]').innerText()).toBe("Mon forfait");
    } finally {
      await page.close();
    }
  }, 120_000);

  it("the API key section saves, replaces and removes a key (solo: the server's key)", async () => {
    const page = await open("providers=1&subPage=providers.provider:anthropic");
    const section = page.locator('[data-settings-group="provider-key"]');
    try {
      await expect.poll(() => section.innerText()).toContain("A key is saved");
      // the server's key is the person's own on a solo server (provider-rows.ts): its form
      await section.locator("[data-provider-change-key]").click();
      await section.locator('[data-personal-provider-key-input="anthropic"]').fill("sk-ant-test-1234");
      await section.getByRole("button", { name: "Save", exact: true }).click();
      await expect.poll(() => section.innerText()).toContain("ending in 1234");
      const remove = section.locator('[data-provider-action="remove"] button');
      await remove.click();
      await remove.click();
      await expect.poll(() => section.innerText()).toContain("No key saved");
      await section.locator("[data-provider-add-key-open]").click();
      await section.locator('[data-provider-key-dialog="anthropic"] input').fill("sk-ant-test-5678");
      await page.keyboard.press("Enter");
      await expect.poll(() => section.innerText()).toContain("A key is saved");
    } finally {
      await page.close();
    }
  }, 120_000);

  it("the API key section saves, replaces and removes a key (organization: the person's own)", async () => {
    const page = await open("providers=1&org=1&subPage=providers.provider:openai");
    const section = page.locator('[data-settings-group="provider-key"]');
    try {
      await expect.poll(() => section.innerText()).toContain("ending in demo");
      await section.locator("[data-provider-change-key]").click();
      await section.locator('[data-personal-provider-key-input="openai"]').fill("sk-test-1234");
      await section.getByRole("button", { name: "Save", exact: true }).click();
      await expect.poll(() => section.innerText()).toContain("ending in 1234");
      const remove = section.locator('[data-provider-action="remove"] button');
      await remove.click();
      await remove.click();
      await expect.poll(() => section.innerText()).toContain("No key saved");
    } finally {
      await page.close();
    }
  }, 120_000);

  for (const mode of MODES) {
    it(`the models unfold in place and a switch there is Active models' switch (${mode.name})`, async () => {
      const page = await open(`${mode.query}&subPage=providers.provider:anthropic`);
      try {
        const models = page.locator('[data-provider-models="anthropic"]');
        await models.locator("button[aria-expanded]").click();
        await expect.poll(() => page.locator('[data-provider-page="anthropic"]').count(), "still on the provider's page").toBe(1);
        const first = models.locator("[data-model-switch]").first();
        const id = (await first.getAttribute("data-model-switch"))!;
        await expect.poll(() => first.getAttribute("data-model-offer")).toBe("on");
        await first.locator("button[role=switch]").click();
        await expect.poll(() => first.getAttribute("data-model-offer")).toBe("personOff");
        // Settings > Models > Active models shows the same switch off
        await page.locator("nav button, [role=navigation] button, aside button").filter({ hasText: /^Models$/ }).first().click();
        const same = page.locator(`[data-model-switches="anthropic"] [data-model-switch="${id}"]`);
        await expect.poll(() => same.getAttribute("data-model-offer"), { timeout: 30_000 }).toBe("personOff");
      } finally {
        await page.close();
      }
    }, 120_000);
  }
});
