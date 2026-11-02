#!/usr/bin/env node
/**
 * Headless screenshots of release notes as a centred modal (gallery data only).
 * Usage: node scripts/capture-release-notes-modal.mjs [--out DIR] [--port N]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const outDir = resolve(
  arg("--out") ??
    "/private/tmp/claude-501/-Users-jencryzthers/34ab7233-17d7-4f08-bd9d-b814b29fdefd/scratchpad/release-notes-shots",
);
const port = Number(arg("--port") ?? 5357);
const skins = [
  { id: "pulsatrix-light", label: "light" },
  { id: "pulsatrix", label: "dark" },
];
const shots = [
  { name: "whats-new", view: "notes", wait: '[data-release-notes="current"]' },
  { name: "browse", view: "browse", wait: '[data-release-notes="browse"]' },
];

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {
      /* retry */
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

const viteBin = join(root, "node_modules", ".bin", "vite");
const vite = spawn(
  viteBin,
  ["--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "development" },
    detached: true,
  },
);
let log = "";
vite.stdout?.on("data", (chunk) => {
  log += chunk;
});
vite.stderr?.on("data", (chunk) => {
  log += chunk;
});

const stop = () => {
  try {
    if (vite.pid) process.kill(-vite.pid, "SIGTERM");
  } catch {
    /* already gone */
  }
};
process.on("exit", stop);
process.on("SIGINT", () => {
  stop();
  process.exit(130);
});

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/windows-a.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.SAGAX_VERIFY_BROWSER_CHROME
      ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME }
      : process.env.SAGAX_CHROMIUM
        ? { executablePath: process.env.SAGAX_CHROMIUM }
        : {}),
  });

  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  });
  page.on("pageerror", (error) => console.error("page error:", error.message));

  for (const skin of skins) {
    for (const shot of shots) {
      await page.goto(`${base}?view=${shot.view}&skin=${skin.id}&lang=en`, { waitUntil: "load" });
      await page.waitForSelector(shot.wait, { timeout: 30_000 });
      await page.waitForTimeout(800);
      const path = join(outDir, `${shot.name}-${skin.label}.png`);
      await page.screenshot({ path });
      console.log(`wrote ${path}`);
    }
  }
  await page.close();
} catch (error) {
  console.error(error);
  console.error(log.slice(-4000));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  stop();
}
