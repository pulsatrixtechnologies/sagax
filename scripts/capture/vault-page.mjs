#!/usr/bin/env node
/**
 * Headless screenshots of Settings > Vault (#4094) from
 * src/gallery/settings-pages.html: the page empty and with an item of each
 * kind, each tab, the New item menu, the new login dialog (empty, then
 * valid), the edit dialog and the import dialog; French and English, light
 * and dark, 1280 and 390 px wide. Headless Chrome only: no window opens; the
 * gallery answers /api itself.
 * Usage: node scripts/capture/vault-page.mjs [--out DIR] [--port N] [--prefix before|after]
 *   [--only state,state] (SAGAX_VERIFY_BROWSER_CHROME=<chromium> for another browser)
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "vault-page")));
const port = Number(arg("--port", "5341"));
const prefix = arg("--prefix", "after");
const only = arg("--only", "").split(",").filter(Boolean);
const skins = [{ id: "pulsatrix-light", label: "light" }, { id: "pulsatrix", label: "dark" }];
const widths = [1280, 390];

// The first selector found is used: the page before #4094 (an "Add an
// item" pill, a "..." menu, inline forms) and after it (one New item menu,
// dialogs) are both shot by the same states.
const click = async (page, selectors) => {
  for (const selector of selectors) {
    const target = page.locator(selector).first();
    if (await target.count()) {
      await target.click();
      await page.waitForTimeout(350);
      return true;
    }
  }
  return false;
};
const openNew = (page) => click(page, ["[data-vault-new] button", "[data-vault-menu]"]);
const newLogin = async (page) => {
  if (await page.locator("[data-vault-new]").count()) {
    await openNew(page);
    return click(page, ['[data-bot-profile-add-item="login"]']);
  }
  return click(page, ["[data-credentials-add]"]);
};
const fill = async (page) => {
  const form = page.locator("[data-credential-form]").first();
  const set = async (label, value) => {
    const field = form.getByLabel(label, { exact: true }).first();
    if (await field.count()) await field.fill(value);
  };
  for (const [en, fr, value] of [
    ["Website", "Site web", "docs.example.com"],
    ["Sites", "Sites", "docs.example.com"],
    ["Name", "Nom", "Docs portal"],
    ["Username or email", "Nom d'utilisateur ou courriel", "alex@example.com"],
    ["User name or email", "Nom d'utilisateur ou courriel", "alex@example.com"],
    ["Password", "Mot de passe", "correct-horse"],
  ]) {
    await set(en, value);
    await set(fr, value);
  }
  await page.waitForTimeout(250);
};
const STATES = [
  { id: "page-empty", query: "vault=empty", page: true },
  { id: "page-all", query: "vault=full&tab=all", page: true },
  { id: "page-logins", query: "vault=full&tab=logins", page: true },
  { id: "page-payments", query: "vault=full&tab=payments", page: true },
  { id: "page-contacts", query: "vault=full&tab=contacts", page: true },
  { id: "menu-new", query: "vault=full", act: openNew },
  { id: "dialog-new-login-empty", query: "vault=full", act: newLogin },
  { id: "dialog-new-login-valid", query: "vault=full", act: async (page) => { await newLogin(page); await fill(page); } },
  { id: "dialog-edit", query: "vault=full", act: async (page) => {
    await click(page, ['[data-credential-item="v-1"] [data-vault-manage]', '[data-credential-item="v-1"] button']);
    await click(page, ["[data-vault-edit]", '[data-credential-detail] button:text-is("Edit")', '[data-credential-detail] button:text-is("Modifier")']);
  } },
  { id: "dialog-manage", query: "vault=full", act: (page) => click(page, ['[data-credential-item="v-1"] [data-vault-manage]', '[data-credential-item="v-1"] button']) },
  { id: "dialog-import", query: "vault=full", act: async (page) => {
    await openNew(page);
    await click(page, ['[data-bot-profile-add-item="import"]', "[data-credentials-import]"]);
  } },
].filter((state) => only.length === 0 || only.includes(state.id));

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const vite = spawn(
  process.execPath,
  [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" } },
);
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/settings-pages.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : { channel: "chrome" }) });
  for (const lang of ["fr", "en"]) {
    for (const skin of skins) {
      for (const width of widths) {
        const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2, colorScheme: skin.label });
        page.on("pageerror", (error) => console.error("page error:", error.message));
        for (const state of STATES) {
          await page.goto(`${base}?section=credentials&skin=${skin.id}&lang=${lang}&${state.query}`, { waitUntil: "networkidle" });
          await page.waitForSelector("[data-credentials-settings]", { timeout: 30_000 });
          await page.waitForTimeout(600);
          if (state.page) {
            // the whole page, not the 700px window
            await page.addStyleTag({ content: '[aria-labelledby="app-settings-title"]{height:auto!important;max-height:none!important}[aria-labelledby="app-settings-title"] [data-settings-pane]{overflow:visible!important}[aria-labelledby="app-settings-title"] nav{overflow:visible!important}.fixed.inset-0{position:static!important;min-height:100vh;align-items:flex-start!important}' });
            await page.waitForTimeout(300);
          }
          if (state.act) await state.act(page);
          const file = join(outDir, `${prefix}-${state.id}-${lang}-${skin.label}-${width}.png`);
          // a clip of the window, not an element shot: the store's retries
          // keep re-rendering, so an element never counts as stable
          const box = state.page ? await page.locator('[role="dialog"][aria-labelledby="app-settings-title"]').boundingBox() : null;
          await page.screenshot({ path: file, animations: "disabled", ...(box ? { fullPage: true, clip: box } : {}) });
          console.log("shot", file);
        }
        await page.close();
      }
    }
  }
} catch (error) {
  console.error(error);
  if (log) console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  vite.kill("SIGTERM");
}
