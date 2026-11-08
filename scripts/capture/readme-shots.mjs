#!/usr/bin/env node
/**
 * The README's desktop screenshots (docs/readme/), all headless: the full
 * app on the README fixture (scripts/readme-shots-fixture.ts: fake engines,
 * a disposable home, invented bots and messages, never ~/.sagax), then a few
 * isolated gallery pages (src/gallery) for surfaces the fixture cannot reach
 * without a key or an account, and one short clip of the mascots. Each shot
 * is taken in the dark and the light Pulsatrix skin at 1440x900, 2x.
 * Headless Chromium only: no window opens.
 *
 * Usage: node scripts/capture/readme-shots.mjs [--out DIR] [--only a,b,c]
 *          [--fixture-log FILE] [--gallery-port N]
 *   --fixture-log: reuse a fixture already running (the JSON line it printed)
 *     instead of starting one.
 *   --only: a comma list of shot names (hero, split-view, group, automations,
 *     bot-panel, bot-page, connect-apps, models, appearance, vault-card,
 *     purchase-card, order-card, mascots-clip).
 *   SAGAX_README_UI_PORT=<port> pins the fixture's UI to one port.
 *   SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser.
 * Then: scripts/optimize-readme-shots.sh squeezes the PNGs and builds the GIF.
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "readme"));
const only = arg("--only")?.split(",").map((s) => s.trim()).filter(Boolean);
const wants = (name) => !only || only.includes(name);
const galleryPort = Number(arg("--gallery-port") ?? 5298);
const skins = [
  { id: "pulsatrix", label: "dark", scheme: "dark" },
  { id: "pulsatrix-light", label: "light", scheme: "light" },
];
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const launchOptions = { headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) };

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await sleep(500);
  }
  throw new Error(`no server at ${url}`);
}

/** The fixture: started here, or one already running (--fixture-log). */
async function fixtureInfo() {
  const logPath = arg("--fixture-log");
  if (logPath) {
    const line = (await readFile(logPath, "utf8")).match(/\{"appUrl".*\}/);
    if (!line) throw new Error(`no fixture JSON in ${logPath}`);
    return { info: JSON.parse(line[0]), stop: async () => {} };
  }
  const child = spawn(process.execPath, ["--experimental-strip-types", join(root, "scripts", "readme-shots-fixture.ts")], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  let buffer = "";
  const info = await new Promise((resolveInfo, reject) => {
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const line = buffer.match(/\{"appUrl".*\}/);
      if (line) resolveInfo(JSON.parse(line[0]));
    });
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("exit", (code) => reject(new Error(`fixture exited (${code}) before it was ready`)));
  });
  return { info, stop: async () => { child.kill("SIGTERM"); await sleep(1500); if (child.exitCode === null) child.kill("SIGKILL"); } };
}

const appShots = ["hero", "split-view", "group", "automations", "bot-panel", "connect-apps", "models"];
const galleryShots = ["appearance", "bot-page", "vault-card", "purchase-card", "order-card", "mascots-clip"];

async function captureApp(chromium) {
  const { info, stop } = await fixtureInfo();
  const browser = await chromium.launch(launchOptions);
  try {
    {
      // first visit: Vite optimizes dependencies and reloads the page; a throwaway load keeps the first shot from being blank
      const warm = await browser.newPage();
      await warm.goto(info.appUrl, { waitUntil: "load" });
      await warm.waitForSelector("[data-sidebar-bot-row]", { timeout: 90_000 }); await sleep(3000);
      await warm.waitForSelector("[data-sidebar-bot-row]", { timeout: 90_000 });
      await warm.close();
    }
    for (const skin of skins) {
      for (const name of appShots) {
        if (!wants(name)) continue;
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: skin.scheme, locale: "en-US", timezoneId: "America/Toronto" });
        const split = { type: "split", id: "root", dir: "row", children: [{ type: "leaf", id: "main", target: null }, { type: "leaf", id: "side-1", target: { kind: "bot", botId: info.ids.ledger.id } }], sizes: [0.5, 0.5] };
        await context.addInitScript(({ skinId, layout }) => {
          localStorage.setItem("omb-skin", skinId);
          localStorage.setItem("sagax-skin", skinId);
          if (layout) localStorage.setItem("sagax.splitView.layout.v1", JSON.stringify(layout));
        }, { skinId: skin.id, layout: name === "split-view" ? split : null });
        const page = await context.newPage();
        await page.goto(info.appUrl, { waitUntil: "load" });
        await page.waitForSelector("[data-sidebar-bot-row]", { timeout: 90_000 });
        await page.addStyleTag({ content: "[data-achievement-toaster]{display:none !important}" });
        const terms = page.locator("[data-terms-accept]");
        if (await terms.count()) { await terms.click(); await sleep(600); }
        const openBot = async (key) => { await page.click(`[data-sidebar-bot-row="${info.ids[key].id}"]`); await sleep(1200); };
        const expandTools = async () => { const row = page.getByText(/^Used \d+ tools/); if (await row.count()) { await row.first().click(); await sleep(600); } };
        const profileMenu = async (...items) => {
          await page.getByRole("button", { name: "Alex Morgan" }).click();
          for (const item of items) { await sleep(350); await page.getByRole("menuitem", { name: item, exact: true }).click(); }
          await sleep(1200);
        };
        const settingsPage = async (title) => {
          await profileMenu("Settings");
          await page.locator("[data-settings-nav-group] button, nav button").filter({ hasText: title }).first().click();
          await sleep(1200);
        };
        switch (name) {
          case "hero": await openBot("pixel"); await expandTools(); break;
          case "split-view": await openBot("pixel"); await sleep(800); break;
          case "group": {
            await page.click(`[data-sidebar-group-row="${info.groupId}"]`); await sleep(1200);
            const notice = page.getByText("Group conversations use more");
            if (await notice.count()) { await notice.locator("xpath=..").getByRole("button").first().click().catch(() => {}); await sleep(400); }
            break;
          }
          case "automations": {
            await profileMenu("Tools", "Automations");
            await page.getByRole("button", { name: "Next dates" }).click(); await sleep(1200);
            break;
          }
          case "bot-panel": await openBot("pixel"); await page.click("[data-bot-header-pill]"); await sleep(1500); break;
          case "connect-apps": {
            await openBot("nova");
            await page.click("[data-sidebar-connect-apps]"); await sleep(900);
            // since 0.8.6x the panel filters by kind (All, Connectors, MCP servers, Skills) instead of tabs
            const connectors = page.getByRole("button", { name: "Connectors", exact: true });
            if (await connectors.count()) { await connectors.first().click(); await sleep(1500); } else await sleep(1200);
            break;
          }
          case "models": {
            await openBot("nova");
            await settingsPage("Models");
            // the fixture's fake Codex is named "Verification Codex"; a real install reads "Codex"
            await page.evaluate(() => {
              const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
              for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.nodeValue?.includes("Verification Codex")) node.nodeValue = node.nodeValue.replace("Verification Codex", "Codex");
            });
            await sleep(300);
            break;
          }
        }
        await page.screenshot({ path: join(outDir, `${name}-${skin.label}.png`) });
        console.log(`shot ${name}-${skin.label}`);
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await stop();
  }
}

async function captureGallery(chromium) {
  const vite = spawn("pnpm", ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(galleryPort), "--strictPort"], {
    cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, detached: true,
  });
  let log = "";
  vite.stdout?.on("data", (chunk) => { log += chunk; });
  vite.stderr?.on("data", (chunk) => { log += chunk; });
  const base = `http://127.0.0.1:${galleryPort}/src/gallery`;
  let browser;
  try {
    await waitForServer(`${base}/vault-card.html`);
    browser = await chromium.launch(launchOptions);
    for (const skin of skins) {
      // the galleries' fixtures are French; the README reads English, so
      // the few words on a card are swapped before the shot
      const WORDS = [
        ["Osprey", "Nova"], ["Portail Exemple", "Example portal"], ["Exemple travail", "Example work"], ["Exemple admin", "Example admin"], ["Travail", "Work"], ["Perso", "Personal"],
        ["Boutique Exemple", "Example Store"], ["Câble USB-C", "USB-C cable"], ["Chargeur 65 W", "65 W charger"], ["Boutique Audio", "Audio Shop"],
        ["Casque sans fil, réduction de bruit", "Wireless headphones, noise cancelling"], ["Postes Canada", "Canada Post"], ["Retenu au dépôt, adresse à confirmer", "Held at the depot, address to confirm"],
      ];
      const english = (page) => page.evaluate((words) => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) for (const [from, to] of words) if (node.nodeValue?.includes(from)) node.nodeValue = node.nodeValue.replaceAll(from, to);
      }, WORDS);
      const shoot = async (name, url, selector, viewport, ready, index = 0, style) => {
        if (!wants(name)) return;
        const context = await browser.newContext({ viewport, deviceScaleFactor: 2, colorScheme: skin.scheme, locale: "en-US" });
        const page = await context.newPage();
        // the galleries draw fake data; nothing answers /api here
        await page.route("**/api/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not in this gallery" }) }));
        await page.goto(url, { waitUntil: "load" });
        await page.waitForSelector(ready ?? selector, { timeout: 60_000 });
        await english(page);
        if (style) await page.addStyleTag({ content: style });
        await sleep(1200);
        await page.locator(selector).nth(index).screenshot({ path: join(outDir, `${name}-${skin.label}.png`), animations: "disabled" });
        console.log(`shot ${name}-${skin.label}`);
        await context.close();
      };
      // the Appearance section of the bot's page (the editor is a page since 0.8.59, no dialog)
      await shoot("appearance", `${base}/appearance-editor.html?skin=${skin.id}&lang=en&character=shape&color=teal`, "[data-bot-profile-page]", { width: 1440, height: 1000 }, "[data-bot-profile-page] [data-mascot-stage]");
      // the bot page (fills the main area in the app) with a fictional bot and rich stand-in data
      await shoot("bot-page", `${base}/bot-profile.html?skin=${skin.id}&lang=en`, "[data-bot-profile-page]", { width: 1440, height: 1000 });
      await shoot("vault-card", `${base}/vault-card.html?skin=${skin.id}&lang=en&state=pending`, "[data-gallery-card] > *", { width: 820, height: 900 }, "[data-gallery-card]");
      await shoot("purchase-card", `${base}/outbound-cards.html?skin=${skin.id}&lang=en&only=purchase`, "[data-outbound-card]", { width: 820, height: 1400 });
      await shoot("order-card", `${base}/outbound-cards.html?skin=${skin.id}&lang=en&only=purchase`, "[data-outbound-card]", { width: 820, height: 1400 }, undefined, 3);
      if (skin.label === "dark" && wants("mascots-clip")) {
        // a short clip of the Shapes set playing a move: the raw video lands
        // beside the PNGs; optimize-readme-shots.sh turns it into the GIF.
        const videoDir = join(outDir, ".video");
        await rm(videoDir, { recursive: true, force: true });
        const context = await browser.newContext({ viewport: { width: 1068, height: 172 }, deviceScaleFactor: 1, colorScheme: "dark", recordVideo: { dir: videoDir, size: { width: 1068, height: 172 } } });
        const page = await context.newPage();
        await page.route("**/api/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
        await page.goto(`${base}/shape-set.html?skin=pulsatrix&move=notify&size=120`, { waitUntil: "load" });
        await page.waitForSelector("[data-shape]");
        await sleep(9000);
        const video = page.video();
        await context.close();
        const path = await video?.path();
        if (path) { await rename(path, join(outDir, "mascots-clip.webm")); console.log("clip mascots-clip.webm"); }
        await rm(videoDir, { recursive: true, force: true });
      }
    }
  } finally {
    await browser?.close();
    try { process.kill(-vite.pid, "SIGTERM"); } catch { /* already gone */ }
    if (process.exitCode) console.error(log.slice(-2000));
  }
}

await mkdir(outDir, { recursive: true });
const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
if (appShots.some(wants)) await captureApp(chromium);
if (galleryShots.some(wants)) await captureGallery(chromium);
