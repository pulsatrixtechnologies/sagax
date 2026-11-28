#!/usr/bin/env node
/**
 * Headless screenshots of the record window (M-20261127-101): the ticket
 * window in each tab (Notes, Schedule, Time & expenses, Configurations,
 * Attachments), the note being written, the Schedule's + menu and its
 * completed entries, the window narrow (one column), a company's window in
 * each tab and a contact's (M-20261127-140), the company drawn from its card
 * alone (a console with no section for it), and the frame's shared pieces,
 * dark and light, French and English. With
 * `--mockup DIR`, each ticket capture is also set beside the mockup's capture
 * of the same state (DIR/<name>.png), in `side-<name>-<skin>-<lang>.png`.
 * Synthetic data only (src/gallery/record-window.html). Headless Chrome: no
 * window opens, never the owner's port 5173.
 * Usage: node scripts/capture/record-window.mjs [--out DIR] [--mockup DIR] [--lang fr|en|both] [--only ticket|account]
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { MARK, WINDOW, captureOptions, sideBySide, skins, startGallery } from "./record-window-gallery.mjs";

const { outDir, mockupDir, langs } = captureOptions("record-window");
const only = (() => { const index = process.argv.indexOf("--only"); return index >= 0 ? process.argv[index + 1] : undefined; })();

let browser;
let gallery;
try {
  gallery = await startGallery();
  const { base } = gallery;
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const shots = [];
  for (const lang of langs) {
    for (const { id, label } of skins) {
      const context = await browser.newContext({ viewport: { width: 1320, height: 940 }, deviceScaleFactor: 2 });
      const page = await context.newPage();
      await page.route("https://desk.example/mark.svg", (route) => route.fulfill({ contentType: "image/svg+xml", body: MARK }));
      page.on("pageerror", (error) => console.error("page error:", String(error).slice(0, 400)));
      const shot = async (name, locator) => {
        const path = join(outDir, `${name}-${label}-${lang}.png`);
        await page.waitForTimeout(250);
        await (locator ?? page.locator(WINDOW).first()).screenshot({ path, animations: "disabled" });
        shots.push({ name, label, lang, path });
        console.log(path);
      };
      const open = async (kind = "ticket", viewport) => {
        if (viewport) await page.setViewportSize(viewport);
        const scene = kind === "company" || kind === "contact" ? kind : "ticket";
        await page.goto(`${base}?${new URLSearchParams({ skin: id, lang, scene })}`);
        await page.waitForSelector(`[data-gallery-chat] [data-record-link="${kind}"]`, { timeout: 60_000 });
        await page.locator(`[data-record-link="${kind}"]`).first().click();
        await page.waitForSelector(`${WINDOW}[data-record-state="card"]`, { timeout: 15_000 });
      };
      const tab = async (name) => {
        await page.locator(`[data-record-tab="${name}"]`).click();
        await page.waitForSelector(`[data-record-ticket-tab="${name}"]`, { timeout: 10_000 });
      };
      if (only !== "account") {
        await open();
        await page.waitForSelector("[data-record-note]", { timeout: 15_000 });
        await shot("ticket-notes");
        await page.locator("[data-record-note-new]").click();
        await shot("ticket-notes-compose");
        await page.keyboard.press("Escape");
        await tab("plan");
        await page.waitForSelector("[data-plan-row]", { timeout: 15_000 });
        await shot("ticket-plan");
        await page.locator("[data-record-plan] [data-record-add]").click();
        await shot("ticket-plan-addmenu");
        await page.keyboard.press("Escape");
        await page.locator("[data-record-show-done]").click();
        await shot("ticket-plan-done");
        await tab("time");
        await page.waitForSelector("[data-record-entry]", { timeout: 15_000 });
        await shot("ticket-time");
        await page.locator("[data-record-entry] [data-billing]").first().click();
        await shot("ticket-time-billing");
        await page.keyboard.press("Escape");
        await tab("configurations");
        await shot("ticket-configurations");
        await tab("attachments");
        await page.waitForSelector("[data-record-attachment]", { timeout: 15_000 });
        await shot("ticket-attachments");
        await page.locator('[data-record-company-card] [data-record-company-link]').click();
        await page.waitForSelector(`${WINDOW}[data-record-window="nimbus_desk/company"][data-record-state="card"]`, { timeout: 15_000 });
        await shot("company-from-ticket");
        await open("ticket", { width: 720, height: 900 });
        await page.waitForSelector("[data-record-note]", { timeout: 15_000 });
        await shot("ticket-narrow");
        await page.setViewportSize({ width: 1320, height: 940 });
      }
      if (only !== "ticket") {
        // a company's window, each tab; then a contact opened from it, each tab, and back
        const account = async (name) => {
          await page.locator(`[data-record-window-tabs] [data-record-tab="${name}"]`).click();
          await page.waitForSelector(`[data-record-account-tab="${name}"] [data-record-tab-panel], [data-record-account-tab="${name}"] [data-record-profile]`, { timeout: 30_000 });
          await page.waitForFunction(() => !document.querySelector("[data-record-account-tab] [role=status]")?.textContent?.match(/Chargement|Loading/), null, { timeout: 10_000 }).catch(() => {});
        };
        await open("company");
        await page.waitForSelector("[data-record-profile=company] [data-record-tiles]", { timeout: 15_000 });
        await shot("company-sheet");
        for (const name of ["notes", "contacts", "tickets", "activities", "projects", "opportunities", "agreements", "configurations", "attachments", "sites", "finance", "data"]) {
          await account(name);
          await shot(`company-${name}`);
        }
        await account("contacts");
        await page.locator("[data-record-tab-panel=contacts] [data-record-add-entry=contact]").click();
        await shot("company-contacts-new");
        await page.keyboard.press("Escape");
        await account("sheet");
        await page.locator("[data-record-key-contacts] [data-record-ref-link]").first().click();
        await page.waitForSelector(`${WINDOW}[data-record-window="nimbus_desk/contact"] [data-record-profile=contact] [data-record-tiles]`, { timeout: 15_000 });
        await shot("contact-sheet");
        for (const name of ["tickets", "activities", "configurations", "attachments", "notes", "history"]) {
          await account(name);
          await shot(`contact-${name}`);
        }
        await page.locator("[aria-label=Retour], [aria-label=Back]").first().click();
        await page.waitForSelector(`${WINDOW}[data-record-window="nimbus_desk/company"]`, { timeout: 15_000 });
        await page.goto(`${base}?${new URLSearchParams({ skin: id, lang, scene: "ticket", console: "old" })}`);
        await page.waitForSelector(`[data-gallery-chat] [data-record-link="company"]`, { timeout: 60_000 });
        await page.locator(`[data-record-link="company"]`).first().click();
        await page.waitForSelector("[data-record-profile=company] [data-record-facts-pod]", { timeout: 15_000 });
        await shot("company-from-card");
        await page.setViewportSize({ width: 720, height: 900 });
        await open("company");
        await page.waitForSelector("[data-record-profile=company] [data-record-tiles]", { timeout: 15_000 });
        await shot("company-narrow");
        await page.setViewportSize({ width: 1320, height: 940 });
      }
      await page.goto(`${base}?${new URLSearchParams({ skin: id, lang, scene: "frame" })}`);
      await page.waitForSelector("[data-gallery-frame] [data-record-grid]", { timeout: 60_000 });
      await shot("frame");
      await context.close();
    }
  }
  // the mockup's capture beside each one, in one image
  await sideBySide(browser, shots, mockupDir, outDir);
} catch (error) {
  console.error(String(error?.stack ?? error));
  console.error(gallery?.log().slice(-2000) ?? "");
  process.exitCode = 1;
} finally {
  await browser?.close();
  gallery?.stop();
}
