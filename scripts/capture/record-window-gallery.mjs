/**
 * The record window's gallery for its capture scripts (record-window.mjs,
 * record-window-board-invoice.mjs): the options they share, the gallery's
 * Vite on a free port between 5300 and 5399 (never the owner's 5173), and
 * each capture set beside the mockup's capture of the same state. Headless
 * only: nothing here opens a window.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#2563eb"/></svg>`;
export const WINDOW = "[data-record-window]";
export const skins = [{ id: "pulsatrix", label: "dark" }, { id: "daylight", label: "light" }];

/** --out DIR (else docs/screenshots/<name>), --mockup DIR, --lang fr|en|both */
export function captureOptions(name) {
  const arg = (flag) => { const index = process.argv.indexOf(flag); return index >= 0 ? process.argv[index + 1] : undefined; };
  return {
    outDir: resolve(arg("--out") ?? join(root, "docs", "screenshots", name)),
    mockupDir: arg("--mockup") ? resolve(arg("--mockup")) : undefined,
    langs: (arg("--lang") ?? "both") === "both" ? ["fr", "en"] : [arg("--lang")],
  };
}

async function freePort() {
  for (let candidate = 5300; candidate <= 5399; candidate += 1) {
    const free = await new Promise((done) => {
      const probe = createServer().once("error", () => done(false)).once("listening", () => probe.close(() => done(true)));
      probe.listen(candidate, "127.0.0.1");
    });
    if (free) return candidate;
  }
  throw new Error("no free port between 5300 and 5399");
}

async function waitForServer(url, ms = 180_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

/** The gallery's Vite, started; `stop` ends it by its own process group, `log` is what it said. */
export async function startGallery() {
  const port = await freePort();
  const vite = spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, detached: true,
  });
  let log = "";
  vite.stdout?.on("data", (chunk) => { log += chunk; });
  vite.stderr?.on("data", (chunk) => { log += chunk; });
  const gallery = {
    base: `http://127.0.0.1:${port}/src/gallery/record-window.html`,
    log: () => log,
    stop: () => { try { process.kill(-vite.pid, "SIGTERM"); } catch { /* already gone */ } },
  };
  try {
    await waitForServer(gallery.base);
  } catch (error) {
    gallery.stop();
    throw error;
  }
  return gallery;
}

/** Each capture beside the mockup's capture of the same state (mockupDir/<name>.png), in side-<name>-<skin>-<lang>.png. */
export async function sideBySide(browser, shots, mockupDir, outDir) {
  if (!mockupDir) return;
  const context = await browser.newContext({ viewport: { width: 2700, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  for (const { name, label, lang, path } of shots) {
    const mock = join(mockupDir, `${name}.png`);
    if (!existsSync(mock)) continue;
    const data = async (file) => `data:image/png;base64,${(await readFile(file)).toString("base64")}`;
    await page.setContent(`<!doctype html><body style="margin:0;background:#111;display:flex;gap:24px;padding:24px;align-items:flex-start;font:14px system-ui;color:#ddd">
      <figure style="margin:0;width:1300px"><figcaption style="margin-bottom:8px">Maquette</figcaption><img style="width:1300px" src="${await data(mock)}"></figure>
      <figure style="margin:0;width:1300px"><figcaption style="margin-bottom:8px">Sagax (${label}, ${lang})</figcaption><img style="width:1300px" src="${await data(path)}"></figure></body>`);
    const side = join(outDir, `side-${name}-${label}-${lang}.png`);
    await page.screenshot({ path: side, fullPage: true });
    console.log(side);
  }
  await context.close();
}
