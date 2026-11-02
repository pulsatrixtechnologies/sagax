#!/usr/bin/env node
/**
 * Settings > Conversation threads, the three modes (one conversation, in the
 * chat header, in the sidebar): headless captures of the sidebar and of the
 * chat header's thread control (src/gallery/sidebar.html), light and dark,
 * comfortable and compact, with a room and a person's conversation beside
 * the bots. Then the row alignment check: in every capture, each row's
 * avatar and name (bot, room, person) start on the same x, within 1px; the
 * script fails otherwise. Headless Chromium only: no window opens.
 * Usage: node scripts/capture/sidebar-thread-modes.mjs [--out DIR] [--port N] [--no-measure]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "sidebar-thread-modes"));
const port = Number(arg("--port") ?? 5293);
const measure = !process.argv.includes("--no-measure");
const skins = [{ id: "daylight", label: "light" }, { id: "pulsatrix", label: "dark" }];
const modes = ["one", "header", "sidebar"];
const densities = ["comfortable", "compact"];
const TOLERANCE = 1;

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

/** Each listed row's avatar and name x, by kind. */
async function rowColumns(page) {
  return page.evaluate(() => {
    const rows = [
      ...[...document.querySelectorAll("[data-sidebar-bot-row]")].map((row) => ({ kind: "bot", id: row.getAttribute("data-sidebar-bot-row"), row })),
      ...[...document.querySelectorAll("[data-sidebar-group-row]")].map((row) => ({ kind: row.hasAttribute("data-people-dm") ? "person" : "room", id: row.getAttribute("data-sidebar-group-row"), row })),
    ];
    return rows.map(({ kind, id, row }) => {
      const avatar = row.querySelector("[data-sidebar-row-avatar]")?.getBoundingClientRect();
      const name = row.querySelector("[data-sidebar-row-name]")?.getBoundingClientRect();
      return { kind, id, avatar: avatar ? Math.round(avatar.left * 10) / 10 : null, name: name ? Math.round(name.left * 10) / 10 : null };
    }).filter((entry) => entry.avatar !== null && entry.name !== null);
  });
}

const vite = spawn("pnpm", ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, detached: true,
});
let log = "";
vite.stdout?.on("data", (chunk) => { log += chunk; });
vite.stderr?.on("data", (chunk) => { log += chunk; });

const report = [];
const misaligned = [];
try {
  const base = `http://127.0.0.1:${port}/src/gallery/sidebar.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  for (const mode of modes) {
    for (const density of densities) {
      for (const { id, label } of skins) {
        // a fresh context per capture: each starts from its own stored mode
        const context = await browser.newContext({ viewport: { width: 760, height: 1015 }, deviceScaleFactor: 2 });
        const page = await context.newPage();
        await page.goto(`${base}?skin=${id}&lang=fr&threads=${mode}&density=${density}&rooms=1`, { waitUntil: "load" });
        await page.waitForSelector("[data-sidebar-bot-row]");
        await page.waitForTimeout(500);
        const name = `${mode}-${density}-${label}`;
        await page.locator("[data-gallery]").screenshot({ path: join(outDir, `sidebar-${name}.png`) });
        await page.locator("[data-gallery-header]").screenshot({ path: join(outDir, `header-${name}.png`) });
        if (measure) {
          const columns = await rowColumns(page);
          const kinds = new Set(columns.map((entry) => entry.kind));
          for (const key of ["avatar", "name"]) {
            const xs = columns.map((entry) => entry[key]);
            const spread = Math.max(...xs) - Math.min(...xs);
            if (spread > TOLERANCE) misaligned.push({ capture: name, column: key, spread, rows: columns });
          }
          report.push({ capture: name, kinds: [...kinds], rows: columns });
        }
        await context.close();
      }
    }
  }
  await browser.close();
  if (measure) await writeFile(join(outDir, "alignment.json"), JSON.stringify({ tolerancePx: TOLERANCE, report, misaligned }, null, 2));
  console.log(`screenshots in ${outDir}`);
  if (misaligned.length) {
    console.error(`row alignment off by more than ${TOLERANCE}px:`);
    for (const entry of misaligned) console.error(`  ${entry.capture} ${entry.column}: ${entry.spread}px ${JSON.stringify(entry.rows.map((row) => [row.kind, row[entry.column]]))}`);
    process.exitCode = 1;
  } else if (measure) {
    console.log("rows aligned: avatar and name on one column in every capture");
  }
} catch (error) {
  console.error(error);
  console.error(log.slice(-2000));
  process.exitCode = 1;
} finally {
  try { process.kill(-vite.pid, "SIGTERM"); } catch { vite.kill("SIGTERM"); }
}
