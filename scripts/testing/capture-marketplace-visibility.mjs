// Headless capture of the Marketplaces visibility UI (light + dark), no app
// server needed: the component makes no /api call. Run: node this.mjs <outDir>
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { mountPreview } from "./preview-fixture.ts";

const outDir = resolve(process.argv[2] ?? ".omb-scratch/marketplace-visibility");
mkdirSync(outDir, { recursive: true });

// No /api calls are made by MarketplacesSection; the proxy target is unused.
const preview = await mountPreview({ info: { url: "http://127.0.0.1:9" } }, {
  entry: "/scripts/testing/marketplaces-visibility-preview.tsx",
  route: "/__marketplace-visibility.html",
  title: "Marketplace visibility",
  logLevel: "error",
});

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 760, height: 720 }, deviceScaleFactor: 2 });
  await page.goto(preview.previewUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-plugins-marketplaces]");
  await page.waitForSelector("[data-marketplace-add-visibility]");
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => { document.documentElement.setAttribute("data-theme", value); }, theme);
    await page.waitForTimeout(150);
    const file = `${outDir}/marketplaces-${theme}.png`;
    await page.locator("[data-plugins-marketplaces]").screenshot({ path: file });
    console.log(`wrote ${file}`);
  }
} finally {
  await browser.close();
  await preview.close();
}
