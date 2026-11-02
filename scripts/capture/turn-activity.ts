// Headless captures of a bot's main chat seen from its panel (2026-10-29):
// Details > Coding and the sheet of the entry, for a Retry whose own turn
// only listed routines, after earlier turns pushed code, hit a usage limit
// and handed work to 27 teammates still waiting on a GO in their own
// conversations. The list and the detail come from the real activity route
// (server/routes/bot-activity.ts, or the copy --route names, to capture the
// code before a change), answered over a throwaway HTTP server; the gallery
// (src/gallery/turn-activity.html) draws them. Headless Chromium only.
//
//   node --experimental-strip-types scripts/capture/turn-activity.ts <outDir> [prefix] [--route <file>] [--lang fr]
//   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

import { json, readBody } from "../../server/harness/http.ts";
import { dispatchRoutes } from "../../server/routes/table.ts";
import type { ActivityMessage, ActivityTask, BotActivityRouteDeps } from "../../server/routes/bot-activity.ts";

const root = resolve(import.meta.dirname, "..", "..");
const args = process.argv.slice(2);
const flag = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args.splice(index, 2)[1] : undefined; };
const routeFile = resolve(flag("--route") ?? join(root, "server/routes/bot-activity.ts"));
const lang = flag("--lang") ?? "fr";
const outDir = resolve(args[0] ?? "captures");
const prefix = args[1] ?? "turn-activity";
mkdirSync(outDir, { recursive: true });

const NOW = Date.now();
const H = 3_600_000;
const earlier = NOW - 6 * H;
const fr = lang.startsWith("fr");
const ask = fr ? "Confie la revue des routines à l'équipe\net attends leur retour" : "Hand the routine review to the team\nand wait for them";
const main: ActivityTask = { threadId: "t-main", title: "hello", createdAt: NOW - 8 * H, updatedAt: NOW - 1_000, busy: true, activity: "working", turnStartedAt: NOW - 33_000, ownerPrincipalId: "jc" };
const history: ActivityMessage[] = [
  { id: "h1", role: "user", kind: "text", at: earlier - 60_000, text: "hello", parentId: null },
  { id: "h2", role: "bot", kind: "activity", at: earlier - 50_000, tool: { name: "Bash", ok: true, summary: "git commit -am wip && git push", input: "{\"command\":\"git commit -am wip && git push\"}" } },
  { id: "h3", role: "bot", kind: "activity", at: earlier - 40_000, tool: { name: "Edit", ok: true, files: ["/srv/app/src/a.ts"] } },
  { id: "h4", role: "user", kind: "text", at: earlier, text: ask, parentId: "h3" },
  { id: "h5", role: "bot", kind: "activity", at: earlier + 10_000, tool: { name: "mcp__agents__handoff", ok: true, summary: fr ? "Délégation à 27 bots" : "Handed to 27 bots" } },
  { id: "h6", role: "bot", kind: "activity", at: earlier + 15_000, tool: { name: "mcp__tailscale__acl_get", ok: false, summary: "Tailscale ACL: 403" } },
  { id: "h7", role: "bot", kind: "activity", at: earlier + 20_000, tool: { name: "Error: Claude stopped with an error (HTTP 400 usage limits)", ok: false } },
  { id: "h8", role: "user", kind: "text", at: NOW - 33_000, text: ask, parentId: "h3" },
  { id: "h9", role: "bot", kind: "activity", at: NOW - 20_000, tool: { name: "mcp__agents__list_routines", summary: "mcp__agents__list_routines" } },
];
const teammates = Array.from({ length: 27 }, (_, index) => ({
  botId: "echo", threadId: `t-echo-${index}`, title: "@echo · work", status: "waiting" as const, startedAt: earlier + 10_000 + index * 1_000,
}));

const deps: BotActivityRouteDeps = {
  bot: (id) => (id === "pepper" ? { id, name: "Pepper", modelSelection: { instanceId: "claude", model: "claude-opus-5-5" } } : id === "echo" ? { id, name: "Echo" } : null),
  tasks: (botId) => (botId === "pepper" ? [main] : []),
  viewerId: () => undefined,
  threadReadable: () => true,
  threadWritable: () => true,
  runs: () => [],
  runSeen: () => true,
  messages: (threadId, limit) => ({ messages: (threadId === "t-main" ? history : []).slice(-limit), hasMore: false }),
  children: (_botId, threadId) => (threadId === "t-main" ? teammates : []),
  personName: () => "JC",
  organization: () => true,
  inRepository: () => false,
  now: () => NOW,
};

const { createBotActivityRoutes } = await import(pathToFileURL(routeFile).href) as typeof import("../../server/routes/bot-activity.ts");
const routes = [createBotActivityRoutes(deps)];
const api = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: { kind: "loopback", scopes: ["admin"] } as never, json, readBody });
  if (!handled) json(res, 404, {});
});
await new Promise<void>((ready) => api.listen(0, "127.0.0.1", ready));
const apiBase = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
const list = await (await fetch(`${apiBase}/api/bots/pepper/activity`)).json();
const { item: detail } = await (await fetch(`${apiBase}/api/bots/pepper/activity/item?threadId=t-main`)).json() as { item: unknown };
api.close();

const port = 5329;
const vite = spawn("pnpm", ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, detached: true,
});
let browser;
try {
  const page = `http://127.0.0.1:${port}/src/gallery/turn-activity.html`;
  const start = Date.now();
  for (;;) {
    try { if ((await fetch(page)).status < 500) break; } catch { /* not up yet */ }
    if (Date.now() - start > 120_000) throw new Error("gallery did not start");
    await new Promise((done) => setTimeout(done, 500));
  }
  browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
  for (const [view, width, height] of [["panel", 420, 520], ["sheet", 1180, 820]] as const) {
    for (const [skin, label] of [["daylight", "light"], ["pulsatrix", "dark"]] as const) {
      const tab = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
      await tab.addInitScript((fixture) => { (window as unknown as { __TURN_FIXTURE__: unknown }).__TURN_FIXTURE__ = fixture; }, { list, detail, now: NOW });
      await tab.goto(`${page}?skin=${skin}&lang=${lang}&view=${view}`, { waitUntil: "load" });
      await tab.waitForSelector("[data-gallery-ready]");
      if (view === "sheet") await tab.waitForSelector("[data-activity-detail]");
      await tab.waitForTimeout(1_200);
      await tab.screenshot({ path: join(outDir, `${prefix}-${view}-${label}.png`) });
      await tab.close();
    }
  }
  console.log(`screenshots in ${outDir}`);
} finally {
  await browser?.close();
  if (vite.pid) { try { process.kill(-vite.pid, "SIGTERM"); } catch { /* gone */ } }
}
