// Headless captures of a published page's bar in its person's look
// (2026-10-29): three people with three looks (skin, variant, bot accent),
// light and dark by the reader's system, and a phone's width. Each look is
// read the way the app reads it (src/lib/page-look-sync.ts): a probe
// wearing the skin, in a page that loads the built app stylesheet. A
// throwaway server answers the reading links with the real handlers over a
// temporary store; nothing touches the person's data. Run
// `pnpm exec vite build` first.
//
//   node --experimental-strip-types scripts/capture/page-bar-theme.ts <outDir> [prefix]
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright";

import { json, readBody } from "../../server/harness/http.ts";
import { PublishedPages } from "../../server/pages/published-pages.ts";
import type { RequestAuth } from "../../server/auth/request-auth.ts";
import * as routesModule from "../../server/routes/published-pages.ts";
import type { PageViewer, PublicPageOptions } from "../../server/routes/published-pages.ts";
import { PASS } from "../../server/routes/table.ts";
import { PageLive } from "../../server/pages/page-live.ts";
import { PAGE_LOOK_TOKENS } from "../../src/lib/page-look.ts";

const outDir = resolve(process.argv[2] ?? "captures");
const prefix = process.argv[3] ?? "page-bar";
const staticDir = resolve(process.env.SAGAX_STATIC_DIR ?? "dist");
mkdirSync(outDir, { recursive: true });

const READER = "pr_reader_capture";
const data = mkdtempSync(join(tmpdir(), "sagax-page-bar-capture-"));
const pages = new PublishedPages(data) as PublishedPages & { setLook?: (owner: string, look: unknown) => unknown };

/** Three people, three looks: the skin's light and dark siblings, a variant, the bot accent. */
const PEOPLE = [
  { id: "pr_owner_a", name: "Owner A", look: { light: "pulsatrix-light", dark: "pulsatrix" }, botAccent: false, bot: { name: "Scout", color: "blue", look: { character: "owl" } } },
  { id: "pr_owner_b", name: "Owner B", look: { light: "atelier", dark: "foundry", tint: "green" }, botAccent: false, bot: { name: "Pixel", color: "green", look: { character: "shape", shape: "star", skins: { shape: "glossy" } } } },
  { id: "pr_owner_c", name: "Owner C", look: { light: "daylight", dark: "midnight" }, botAccent: true, bot: { name: "Coral", color: "pink", look: { character: "crab" } } },
] as const;

const HTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Rapport mensuel</title></head>
<body><div class="page-header"><p class="eyebrow">Octobre</p><h1>Rapport mensuel</h1><p class="lead">Résumé des activités du mois.</p></div>
<div class="grid-3"><div class="card stat-card"><div class="card-content"><p class="stat-label">Demandes traitées</p><p class="stat-value">128</p></div></div>
<div class="card stat-card"><div class="card-content"><p class="stat-label">Résolues à temps</p><p class="stat-value">96 %</p></div></div>
<div class="card stat-card"><div class="card-content"><p class="stat-label">Satisfaction</p><p class="stat-value">4,7</p></div></div></div>
<h2>Faits saillants</h2><p>Le volume de demandes a augmenté de 12 % par rapport au mois précédent.</p>
<table class="table"><thead><tr><th>Catégorie</th><th>Demandes</th></tr></thead><tbody><tr><td>Postes de travail</td><td>54</td></tr><tr><td>Réseau</td><td>31</td></tr></tbody></table></body></html>`;

const links = new Map<string, string>();
for (const person of PEOPLE) {
  const made = pages.propose({ ownerId: person.id, botId: `bot_${person.id}`, threadId: `t_${person.id}`, title: "Rapport mensuel d'octobre", kind: "html", content: HTML });
  if (!made.ok) throw new Error(made.error);
  pages.publish(made.page.id, { version: 1, access: "link", expiresAt: null, by: person.id });
  pages.setInvites(made.page.id, { people: [READER], teams: [] }, person.id);
  links.set(person.id, pages.path(pages.get(made.page.id)!.linkId!));
}

function who(req: IncomingMessage): string {
  return /(?:^|;\s*)who=(\w+)/.exec(String(req.headers.cookie ?? ""))?.[1] ?? "anon";
}
function viewerOf(req: IncomingMessage): PageViewer {
  const name = who(req);
  return name === "anon" ? null : { principalId: name === "reader" ? READER : name, computerOwner: false };
}
function authOf(req: IncomingMessage): RequestAuth {
  const viewer = viewerOf(req);
  return { kind: "session", via: "cookie", scopes: ["client"], session: { id: `s_${who(req)}`, ...(viewer?.principalId ? { principalId: viewer.principalId } : {}) } as never };
}
const personOf = (id: string | undefined) => PEOPLE.find((person) => person.id === id);

const options = {
  pages,
  viewer: viewerOf,
  names: (page: { ownerId?: string }) => ({ botName: personOf(page.ownerId)?.bot.name ?? "Scout", personName: personOf(page.ownerId)?.name ?? "Owner" }),
  bot: (page: { ownerId?: string }) => {
    const bot = personOf(page.ownerId)?.bot;
    return bot ? { color: bot.color, look: bot.look } : null;
  },
  teamsOf: () => [],
  personName: (id: string) => personOf(id)?.name ?? (id === READER ? "Invited reader" : "Colleague"),
  readerAssets: () => routesModule.readerAssetsFrom(staticDir),
} as unknown as PublicPageOptions;

const apiRoutes = routesModule.createPublishedPageRoutes({
  pages,
  owner: (auth) => auth.kind === "session" ? auth.session.principalId : undefined,
  isPerson: (auth) => auth.kind === "session" && Boolean(auth.session.principalId),
  origin: (req) => `http://${req.headers.host}`,
  reachable: () => true,
  ...({ reader: (auth: RequestAuth) => auth.kind === "session" && auth.session.principalId ? { principalId: auth.session.principalId, computerOwner: false } : null } as object),
  live: new PageLive(),
  ...({ names: (ids: string[]) => Object.fromEntries(ids.map((id) => [id, personOf(id)?.name ?? "Invited reader"])) } as object),
} as Parameters<typeof routesModule.createPublishedPageRoutes>[0]);

const DIRECTORY = {
  people: [...PEOPLE.map((person) => ({ principalId: person.id, name: person.name, login: person.id, email: `${person.id}@example.com` })),
    { principalId: READER, name: "Invited reader", login: "reader", email: "reader@example.com" }],
  teams: [],
};

const appCss = readdirSync(join(staticDir, "assets")).find((file) => /^index-.*\.css$/.test(file));
const MIME: Record<string, string> = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp" };

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method ?? "GET";
  if (path === "/probe") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html><head><link rel="stylesheet" href="/assets/${appCss}"></head><body></body></html>`);
    return;
  }
  if (routesModule.handlePublishedPagePublic(options, req, res, path, method)) return;
  if (path === "/api/org/directory") return json(res, 200, DIRECTORY);
  if (path === "/api/org") return json(res, 200, { org: { identity: { kind: "perspicax" } } });
  if (path.startsWith("/api/")) {
    const answered = await apiRoutes({ req, res, url, path, method, auth: authOf(req), json, readBody });
    if (answered !== PASS) return;
    return json(res, 404, { error: "no route" });
  }
  if (path.startsWith("/assets/")) {
    try {
      const body = readFileSync(join(staticDir, path.replace(/\.\./g, "")));
      res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
      res.end(body);
      return;
    } catch { /* below */ }
  }
  res.writeHead(404);
  res.end();
}

const server = createServer((req, res) => { void handle(req, res).catch((error) => { console.error(error); res.writeHead(500); res.end(); }); });
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const browser = await chromium.launch(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM, headless: true } : { headless: true });

try {
  // each person's look, as their app would send it (PUT /api/pages/look)
  if (typeof pages.setLook === "function" && appCss) {
    const probe = await (await browser.newContext()).newPage();
    await probe.goto(`${base}/probe`);
    await probe.waitForLoadState("load");
    for (const person of PEOPLE) {
      const read = (skin: string) => probe.evaluate(({ skin, tint, names }) => {
        const element = document.createElement("div");
        element.dataset.skin = skin;
        if (tint) element.dataset.skinTint = tint;
        document.body.appendChild(element);
        const style = getComputedStyle(element);
        const out: Record<string, string> = {};
        for (const name of names) {
          const value = style.getPropertyValue(name).trim();
          if (value) out[name] = value;
        }
        element.remove();
        return out;
      }, { skin, tint: "tint" in person.look ? person.look.tint : undefined, names: [...PAGE_LOOK_TOKENS] });
      // what PUT /api/pages/look keeps (the store checks it the same way)
      pages.setLook(person.id, { light: await read(person.look.light), dark: await read(person.look.dark), skin: person.look.light, botAccent: person.botAccent });
    }
    await probe.context().close();
  }

  const scenes: Array<{ person: (typeof PEOPLE)[number]; scheme: "light" | "dark"; width: number; height: number; tag: string }> = [];
  for (const person of PEOPLE) for (const scheme of ["light", "dark"] as const) scenes.push({ person, scheme, width: 1280, height: 720, tag: "" });
  for (const scheme of ["light", "dark"] as const) scenes.push({ person: PEOPLE[1], scheme, width: 390, height: 760, tag: "-phone" });

  for (const scene of scenes) {
    const context = await browser.newContext({ viewport: { width: scene.width, height: scene.height }, colorScheme: scene.scheme, locale: "fr-CA", extraHTTPHeaders: { "accept-language": "fr-CA" }, deviceScaleFactor: 2 });
    await context.addCookies([{ name: "who", value: scene.person.id, url: base }]);
    const page = await context.newPage();
    page.on("pageerror", (error) => console.error(`[${scene.person.id}/${scene.scheme}] ${error.message}`));
    await page.goto(`${base}${links.get(scene.person.id)}`);
    await page.waitForLoadState("load");
    await page.waitForTimeout(900);
    const file = join(outDir, `${prefix}-${scene.person.id.replace("pr_", "")}-${scene.scheme}${scene.tag}.png`);
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width: scene.width, height: Math.min(scene.height, scene.tag ? 420 : 300) } });
    console.log(file);
    if (!scene.tag && scene.person === PEOPLE[0]) {
      // Share open, in the same look
      const share = page.locator("[data-reader-share]");
      if (await share.count()) {
        await share.click();
        await page.waitForSelector("[data-page-share-popover]");
        await page.waitForTimeout(300);
        const open = join(outDir, `${prefix}-${scene.person.id.replace("pr_", "")}-${scene.scheme}-share.png`);
        await page.screenshot({ path: open });
        console.log(open);
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
  rmSync(data, { recursive: true, force: true });
}
