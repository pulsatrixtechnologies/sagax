/** Headless captures of the delegation card (#2719) in the chat gallery
 * (src/gallery/routine-run-cards.tsx?scene=card): the conversation around
 * two hand-offs (one folded, one still running) beside the finished coding
 * job card (#2148, the conforming neighbour), each card alone, and the card
 * once a row is clicked (the teammate's work open under it, in the chat).
 *
 *   node scripts/capture/delegation-card.mjs --tag after --out /path/to/dir [--port 5203] [--no-click]
 *
 * `--tag before --no-click` captures the component as it was. Needs the
 * gallery deps (vite, playwright) in node_modules; nothing is shown on screen. */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};
const outDir = resolve(arg("--out") ?? join(root, "docs", "screenshots", "delegation-card"));
const port = Number(arg("--port") ?? 5203);
const tag = arg("--tag") ?? "after";
const click = !process.argv.includes("--no-click");
const skins = [
  { id: "pulsatrix-light", label: "light" },
  { id: "pulsatrix", label: "dark" },
];
const WIDTH = 820;
const HEIGHT = 980;

async function waitForServer(url, ms = 120_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery server did not answer at ${url}`);
}

await mkdir(outDir, { recursive: true });
const vite = spawn(
  "pnpm",
  ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, detached: true },
);
vite.stderr.on("data", (chunk) => process.stderr.write(chunk));

let browser;
try {
  const gallery = `http://127.0.0.1:${port}/src/gallery/routine-run-cards.html`;
  await waitForServer(gallery);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  browser = await chromium.launch({
    headless: true,
    ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}),
  });
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 2 });
  page.on("pageerror", (error) => console.error("page error:", error.message));
  for (const skin of skins) {
    await page.goto(`${gallery}?skin=${skin.id}&lang=en&scene=card&width=${WIDTH}&height=${HEIGHT}`, { waitUntil: "load" });
    await page.waitForSelector("[data-routine-run-card]");
    await page.waitForTimeout(500);
    const sample = page.locator("[data-gallery-sample]");
    await sample.screenshot({ path: join(outDir, `${tag}-thread-${skin.label}.png`) });
    await page.locator("[data-coding-job-card]").first().screenshot({ path: join(outDir, `${tag}-neighbour-coding-job-${skin.label}.png`) });
    const runs = page.locator("[data-routine-run-card]");
    await runs.nth(0).screenshot({ path: join(outDir, `${tag}-card-finished-${skin.label}.png`) });
    await runs.nth(1).screenshot({ path: join(outDir, `${tag}-card-running-${skin.label}.png`) });
    if (click) {
      await page.locator('[data-delegation-reveal="tester-work"]').click();
      await page.waitForSelector('[data-delegation-work="tester-work"] [data-activity-conversation]');
      await page.waitForTimeout(1_200);
      await sample.screenshot({ path: join(outDir, `${tag}-clicked-${skin.label}.png`) });
    }
    console.log(`${tag} ${skin.label}: captured in ${outDir}`);
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  try {
    process.kill(-vite.pid, "SIGTERM");
  } catch {
    vite.kill("SIGTERM");
  }
}
