// The composer's model menu with the catalogs the real drivers build from
// recorded engine answers (scripts/testing/fixtures/model-picker), on a
// disposable app server. Prints the preview URL; with --shots DIR it also
// opens the menu in a headless Chromium and saves screenshots there, then
// exits. No engine, account or user configuration is touched.
//
//   node --experimental-strip-types scripts/verify/dev/verify-model-picker-ui.ts [--shots DIR]
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createHttpServer, type IncomingMessage } from "node:http";
import { createServer } from "vite";
import type { InstanceInfo } from "../../../src/state/store.tsx";
import { launchVerificationServer } from "../../control-omb.ts";
import { GROK_EFFORT_LEVELS, grokModelsFromInitialize, readGrokModelCatalog } from "../../../server/drivers/acp/grok.ts";
import { STATIC_CLAUDE_MODELS } from "../../../server/drivers/claude.ts";
import { probeLocalInjects } from "../../../server/drivers/local-inject.ts";

const fixtures = fileURLToPath(new URL("../../testing/fixtures/model-picker/", import.meta.url));
const grokInit = JSON.parse(readFileSync(join(fixtures, "grok-initialize.json"), "utf8"));
const dwarfstar = readFileSync(join(fixtures, "dwarfstar-models.json"), "utf8");

// Grok's catalog as the driver reads it (no config.toml), then the local
// rows the DwarfStar probe adds, labelled by the server's own code.
const grokHome = mkdtempSync(join(tmpdir(), "sagax-picker-grok-"));
const grokCatalog = readGrokModelCatalog({ GROK_HOME: grokHome }, grokModelsFromInitialize(grokInit));
const fakeFetch = (async (url: string | URL) => {
  const href = String(url);
  if (href === "http://127.0.0.1:8002/v1/models") return new Response(dwarfstar, { headers: { "content-type": "application/json" } });
  throw new Error("offline in this preview");
}) as typeof fetch;
const injects = await probeLocalInjects({ HOME: grokHome }, fakeFetch);
rmSync(grokHome, { recursive: true, force: true });

function capabilitiesOf(driver: "grok" | "claude"): InstanceInfo["capabilities"] {
  return driver === "grok"
    ? { images: true, withholdsHostTools: true, effortLevels: GROK_EFFORT_LEVELS }
    : { images: true, withholdsHostTools: true, effortLevels: ["low", "medium", "high", "xhigh", "max"] };
}

const instances: InstanceInfo[] = [
  {
    instanceId: "grok", driverKind: "grokAgent", displayName: "Grok", cliDefault: "grok", access: "subscription",
    snapshot: { state: "available", authenticated: true, version: "1.0.52" },
    models: {
      default: grokCatalog.default,
      options: [
        ...grokCatalog.options,
        ...injects.map((row) => ({ id: row.id, label: row.label, custom: true, local: true, loaded: row.loaded, ...(row.contextWindow ? { contextWindow: row.contextWindow } : {}) })),
      ],
    },
    capabilities: capabilitiesOf("grok"),
  },
  {
    instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude", cliDefault: "claude", access: "subscription",
    snapshot: { state: "available", authenticated: true, version: "2.1.296" },
    models: { default: STATIC_CLAUDE_MODELS.default, options: STATIC_CLAUDE_MODELS.options.map((option) => ({ ...option })) },
    capabilities: capabilitiesOf("claude"),
  },
];

async function drain(req: IncomingMessage): Promise<void> {
  for await (const _chunk of req) { /* the preview keeps no bot */ }
}

const shotsAt = process.argv.indexOf("--shots");
const shotsDir = shotsAt > 0 ? process.argv[shotsAt + 1] : undefined;

const controller = new AbortController();
const cancel = () => controller.abort();
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);
let fixture: Awaited<ReturnType<typeof launchVerificationServer>> | undefined;
let ui: Awaited<ReturnType<typeof createServer>> | undefined;
const httpServer = createHttpServer();
try {
  fixture = await launchVerificationServer(process.env, controller.signal);
  controller.signal.throwIfAborted();
  ui = await createServer({
    root: fileURLToPath(new URL("../../..", import.meta.url)),
    cacheDir: fileURLToPath(new URL("../../../.omb-scratch/model-picker-preview-vite", import.meta.url)),
    server: { middlewareMode: { server: httpServer }, hmr: { server: httpServer }, proxy: { "/api": { target: fixture.info.url } } },
    plugins: [{ name: "isolated-model-picker", configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split("?")[0];
        const json = (value: unknown, status = 200) => { res.statusCode = status; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(value)); };
        if (path === "/api/instances" && req.method === "GET") return json({ instances });
        if (path?.startsWith("/api/instances/")) return json({ instances });
        // The preview bot lives only in the page: its model changes are accepted and dropped.
        if (path?.startsWith("/api/bots/preview-quasar")) {
          void drain(req).then(() => json({ ok: true }));
          return;
        }
        if (path !== "/__model-picker.html") return next();
        void server.transformIndexHtml(req.url!, '<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sagax · Model picker preview</title></head><body><div id="root"></div><script type="module" src="/scripts/testing/model-picker-preview.tsx"></script></body></html>')
          .then((html) => { res.setHeader("content-type", "text/html"); res.end(html); }).catch(next);
      });
    } }],
  });
  controller.signal.throwIfAborted();
  httpServer.on("request", ui.middlewares);
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => {
      httpServer.removeListener("error", reject);
      resolve();
    });
  });
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("Preview server has no TCP address");
  const previewUrl = `http://127.0.0.1:${address.port}/__model-picker.html`;
  console.log(JSON.stringify({ ...fixture.info, previewUrl }));
  if (shotsDir) {
    await takeShots(previewUrl, shotsDir);
  } else {
    await new Promise<void>((resolve) => {
      if (controller.signal.aborted) return resolve();
      controller.signal.addEventListener("abort", () => resolve(), { once: true });
    });
  }
} finally {
  const httpClosed = new Promise<void>((resolve) => {
    httpServer.close(() => resolve());
    httpServer.closeAllConnections();
  });
  try {
    await fixture?.close();
  } finally {
    try {
      await ui?.close();
    } finally {
      try {
        await httpClosed;
      } finally {
        process.removeListener("SIGINT", cancel);
        process.removeListener("SIGTERM", cancel);
      }
    }
  }
}

/** Open the composer's menu in each theme and save what it shows. */
async function takeShots(previewUrl: string, dir: string): Promise<void> {
  const { chromium } = await import("playwright");
  mkdirSync(dir, { recursive: true });
  // PLAYWRIGHT_CHROMIUM: a Chromium already on this machine, when the pinned one is not downloaded.
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
  try {
    const shots: Array<{ name: string; query: string; steps?: (page: import("playwright").Page) => Promise<void> }> = [
      { name: "menu-dark", query: "skin=midnight" },
      { name: "menu-light", query: "skin=atelier" },
      { name: "menu-claude-dark", query: "skin=midnight&instance=claude&model=claude-opus-5-5&effort=medium" },
      { name: "menu-en-dark", query: "skin=midnight&lang=en" },
      { name: "effort-submenu-dark", query: "skin=midnight", steps: async (page: import("playwright").Page) => { await page.click("[data-model-settings-effort]"); } },
      { name: "effort-submenu-grok45-light", query: "skin=atelier&model=grok-4.5", steps: async (page: import("playwright").Page) => { await page.click("[data-model-settings-effort]"); } },
      { name: "model-submenu-dark", query: "skin=midnight", steps: async (page: import("playwright").Page) => { await page.click("[data-model-settings-model]"); } },
      { name: "menu-haiku-dark", query: "skin=midnight&instance=claude&model=claude-haiku-4-5" },
    ];
    for (const shot of shots) {
      const page = await browser.newPage({ viewport: { width: 1100, height: 820 }, deviceScaleFactor: 2 });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      await page.goto(`${previewUrl}?${shot.query}`);
      try {
        await page.waitForSelector('[data-tour="model"]', { timeout: 20_000 });
        // the app's first loads settle (bots, config; the event stream never idles)
        await page.waitForTimeout(1_500);
        await page.waitForSelector('[data-tour="model"]', { timeout: 20_000 });
      } catch (error) {
        await page.screenshot({ path: join(dir, `${shot.name}-failed.png`) });
        throw new Error(`${shot.name}: the model chip never showed (${errors.join(" | ") || "no page error"})`, { cause: error });
      }
      try {
        await page.click('[data-tour="model"]', { timeout: 10_000 });
        await page.waitForSelector("[data-model-menu]", { timeout: 10_000 });
      } catch (error) {
        await page.screenshot({ path: join(dir, `${shot.name}-failed.png`) });
        throw new Error(`${shot.name}: the menu did not open (${errors.join(" | ") || "no page error"})`, { cause: error });
      }
      if (shot.steps) await shot.steps(page);
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(dir, `${shot.name}.png`) });
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
