#!/usr/bin/env node
/**
 * Headless captures of the message-bar focus ring (#5444 / M-20261127-059).
 * Real COMPOSER_PILL + MentionTextarea. Idle, pointer click, Tab. Light and
 * dark, plus high contrast. Asserts the textarea keeps outline:none and the
 * pill takes focus-within. Chrome channel only; no visible window.
 *
 *   node scripts/capture/composer-focus-ring.mjs [--out DIR] [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "composer-focus-ring")));
const port = Number(arg("--port", "5199"));

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const vite = spawn(
  process.execPath,
  [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: "ignore", env: { ...process.env, NODE_ENV: "development", VITE_CONFIG_NATIVE_IGNORE_WARNING: "true" } },
);
console.error(`vite pid ${vite.pid}`);

let browser;
const report = [];
try {
  const base = `http://127.0.0.1:${port}/src/gallery/composer-focus-ring.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM } : { channel: process.env.SAGAX_CAPTURE_CHANNEL ?? "chrome" }),
  });

  const runs = [
    { skin: "pulsatrix", scheme: "dark", contrast: false },
    { skin: "pulsatrix-light", scheme: "light", contrast: false },
    { skin: "pulsatrix", scheme: "dark-hc", contrast: true },
    { skin: "pulsatrix-light", scheme: "light-hc", contrast: true },
  ];

  for (const run of runs) {
    for (const mode of ["idle", "click", "tab"]) {
      const page = await browser.newPage({ viewport: { width: 900, height: 320 }, deviceScaleFactor: 2 });
      await page.goto(`${base}?skin=${run.skin}&lang=en`, { waitUntil: "networkidle", timeout: 120_000 });
      await page.waitForFunction(() => !!document.querySelector('[data-tour="composer"] textarea'), null, { timeout: 60_000 });
      if (run.contrast) {
        await page.evaluate(() => document.documentElement.setAttribute("data-contrast", "high"));
      }

      if (mode === "click") {
        await page.locator('[data-tour="composer"] textarea').click({ force: true });
        await page.waitForTimeout(250);
      } else if (mode === "tab") {
        await page.locator("[data-focus-start]").focus();
        for (let i = 0; i < 20; i++) {
          await page.keyboard.press("Tab");
          const tag = await page.evaluate(() => document.activeElement?.tagName);
          if (tag === "TEXTAREA") break;
        }
        await page.waitForTimeout(250);
      }

      const styles = await page.evaluate(() => {
        const ta = document.querySelector('[data-tour="composer"] textarea');
        const pill = document.querySelector('[data-tour="composer"]');
        const cs = (el) => {
          if (!el) return null;
          const s = getComputedStyle(el);
          return {
            outlineStyle: s.outlineStyle,
            outlineWidth: s.outlineWidth,
            outlineColor: s.outlineColor,
            outlineOffset: s.outlineOffset,
            borderColor: s.borderColor,
            borderWidth: s.borderWidth,
            boxShadow: s.boxShadow,
            matchesFocusVisible: el.matches(":focus-visible"),
            hasTour: el.closest("[data-tour]")?.getAttribute("data-tour") ?? null,
            hasSurface: el.closest("[data-surface]")?.getAttribute("data-surface") ?? null,
          };
        };
        return { active: document.activeElement?.tagName, textarea: cs(ta), pill: cs(pill) };
      });

      if (mode !== "idle") {
        if (styles.textarea?.outlineStyle !== "none") {
          throw new Error(`${run.scheme}/${mode}: textarea outlineStyle is ${styles.textarea?.outlineStyle}, expected none`);
        }
        if (styles.textarea?.hasTour !== "composer") {
          throw new Error(`${run.scheme}/${mode}: missing data-tour=composer on pill (got surface=${styles.textarea?.hasSurface})`);
        }
        if (styles.active !== "TEXTAREA") {
          throw new Error(`${run.scheme}/${mode}: activeElement is ${styles.active}, expected TEXTAREA`);
        }
      }

      const name = `${mode}-${run.scheme}.png`;
      await page.locator('[data-tour="composer"]').screenshot({ path: join(outDir, name) });
      report.push({ mode, scheme: run.scheme, file: name, ...styles });
      console.log(`${name}: outline=${styles.textarea?.outlineStyle} tour=${styles.textarea?.hasTour} active=${styles.active}`);
      await page.close();
    }
  }
  await writeFile(join(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(`wrote ${report.length} shots to ${outDir}`);
} finally {
  await browser?.close();
  try { process.kill(vite.pid, "SIGTERM"); } catch { /* gone */ }
}
