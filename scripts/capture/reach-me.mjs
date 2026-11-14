#!/usr/bin/env node
/**
 * Headless screenshots of "Me joindre" (2026-10-26): src/gallery/reach-me.html,
 * light and dark: the bot's Overview with the Reach me group by default
 * (push, any hour), set up (text with the person's number, Telegram
 * linking, hours on weekdays), connected (Telegram, Teams not ready) and
 * WhatsApp (the person's own Meta app fields, the code step with the
 * webhook settings, the number proven with the template, a template Meta
 * does not hold in that language: not ready, with the reason).
 * The script answers /api itself; nothing is sent anywhere. Headless
 * Chromium only: no window opens.
 * Usage: node scripts/capture/reach-me.mjs [--out DIR] [--port N] [--lang fr|en]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "reach-me"));
const port = Number(arg("--port") ?? 5293);
const lang = arg("--lang") ?? "fr";
const skins = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];

async function waitForServer(url, ms = 120_000) {
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

try {
  const base = `http://127.0.0.1:${port}/src/gallery/reach-me.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  const page = await browser.newPage({ viewport: { width: 1620, height: 1000 }, deviceScaleFactor: 2 });
  const states = {
    default: { saved: false, settings: { channels: ["push"], hours: { always: true } }, channels: { push: { ready: true, devices: 2 }, sms: { ready: false }, teams: { ready: true }, telegram: { ready: false }, whatsapp: { ready: false } } },
    setup: { saved: true, settings: { channels: ["push", "sms", "telegram"], smsNumber: "+15145550123", hours: { always: false, timeZone: "America/Toronto", ranges: [{ days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00" }] } }, channels: { push: { ready: true, devices: 2 }, sms: { ready: true }, teams: { ready: true }, telegram: { ready: false, username: "cryptic_maison_bot", linking: true }, whatsapp: { ready: false } } },
    connected: { saved: true, settings: { channels: ["telegram", "teams"], hours: { always: true } }, channels: { push: { ready: true, devices: 1 }, sms: { ready: false }, teams: { ready: false, reason: "no Teams connector" }, telegram: { ready: true, connected: true, username: "cryptic_maison_bot" }, whatsapp: { ready: false } } },
    "whatsapp-connect": { saved: true, settings: { channels: ["push", "whatsapp"], hours: { always: true } }, channels: { push: { ready: true, devices: 2 }, sms: { ready: false }, teams: { ready: true }, telegram: { ready: false }, whatsapp: { ready: false, webhookPublic: true, linking: false, replies: false, hasAppSecret: false, windowOpen: false } } },
    "whatsapp-linking": { saved: true, settings: { channels: ["whatsapp"], hours: { always: true } }, channels: { push: { ready: true, devices: 2 }, sms: { ready: false }, teams: { ready: true }, telegram: { ready: false }, whatsapp: { ready: false, linking: true, displayNumber: "+1 555-010-0000", verifiedName: "Boutique Exemple", linkUrl: "https://wa.me/15550100000?text=SAGAX%20K7Q2WX", linkCode: "K7Q2WX", webhookUrl: "https://bots.example.test/reach-me/whatsapp/rmwa_galleryfixture0000", verifyToken: "gallery-verify-fixture", webhookPublic: true, replies: true, hasAppSecret: true, templateName: "sagax_carte", templateLanguage: "fr", hasBusinessAccount: true, templateCheck: { state: "approved", language: "fr", status: "APPROVED", category: "UTILITY", parameters: 1 }, windowOpen: false } } },
    "whatsapp-connected": { saved: true, settings: { channels: ["push", "whatsapp"], hours: { always: false, timeZone: "America/Toronto", ranges: [{ days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00" }] } }, channels: { push: { ready: true, devices: 1 }, sms: { ready: false }, teams: { ready: true }, telegram: { ready: false }, whatsapp: { ready: true, connected: true, linking: false, displayNumber: "+1 555-010-0000", verifiedName: "Boutique Exemple", number: "***0123", webhookUrl: "https://bots.example.test/reach-me/whatsapp/rmwa_galleryfixture0000", verifyToken: "gallery-verify-fixture", webhookPublic: true, replies: true, hasAppSecret: true, templateName: "sagax_carte", templateLanguage: "fr", windowOpen: true } } },
    "whatsapp-template-refused": { saved: true, settings: { channels: ["whatsapp"], hours: { always: true } }, channels: { push: { ready: true, devices: 1 }, sms: { ready: false }, teams: { ready: true }, telegram: { ready: false }, whatsapp: { ready: false, reason: "Your template sagax_carte has no fr version (Meta has en_US, es). Set one of its languages.", connected: true, linking: false, displayNumber: "+1 555-010-0000", verifiedName: "Boutique Exemple", number: "***0123", webhookUrl: "https://bots.example.test/reach-me/whatsapp/rmwa_galleryfixture0000", verifyToken: "gallery-verify-fixture", webhookPublic: true, replies: true, hasAppSecret: true, templateName: "sagax_carte", templateLanguage: "fr", hasBusinessAccount: true, templateCheck: { state: "wrong_language", language: "fr", languages: ["en_US", "es"] }, windowOpen: false } } },
  };
  let state = "default";
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const reply = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname.endsWith("/inbound-mail")) return reply({ available: true, address: "cryptic@bots.acme.example", enabled: true, canChange: true });
    if (url.pathname.endsWith("/reach-me")) return reply(states[state]);
    return reply({ error: "not in this gallery" }, 404);
  });
  for (const { id, label } of skins) {
    for (const name of Object.keys(states)) {
      state = name;
      await page.goto(`${base}?skin=${id}&lang=${lang}`, { waitUntil: "load" });
      await page.waitForSelector("[data-bot-reach-me]");
      await page.waitForTimeout(250);
      await page.locator('[data-gallery-panel="overview"]').screenshot({ path: join(outDir, `reach-me-${name}-${lang}-${label}.png`) });
    }
  }
  await browser.close();
  console.log(`screenshots in ${outDir}`);
} catch (error) {
  console.error(error);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  try { process.kill(-vite.pid, "SIGTERM"); } catch { vite.kill("SIGTERM"); }
}
