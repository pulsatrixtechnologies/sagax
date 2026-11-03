// Headless captures of a published page as its reader sees it
// (/pages/view/<token>): the wrapper, its bar and the page in its frame,
// light and dark, for a reader who is not signed in and for the page's own
// person (Share open). A throwaway server answers the reading link with the
// real handlers (server/routes/published-pages.ts) over a temporary store;
// the built reader script comes from SAGAX_STATIC_DIR (default dist/, run
// `pnpm exec vite build` first). Nothing touches the person's data.
// CAPTURE_LANG=en and CAPTURE_SCALE=2 give the README's English, retina shots.
//
//   node --experimental-strip-types scripts/capture/page-reader.ts <outDir> [prefix]
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { chromium, type Page } from "playwright";

import { json, readBody } from "../../server/harness/http.ts";
import { PublishedPages } from "../../server/published-pages.ts";
import type { RequestAuth } from "../../server/auth/request-auth.ts";
import * as routesModule from "../../server/routes/published-pages.ts";
import type { PageViewer, PublicPageOptions } from "../../server/routes/published-pages.ts";
import { PASS } from "../../server/routes/table.ts";
import { PageLive } from "../../server/page-live.ts";

const outDir = resolve(process.argv[2] ?? "captures");
const prefix = process.argv[3] ?? "page-reader";
// CAPTURE_LANG=en: the same report and comments in English (the README);
// CAPTURE_SCALE=2: retina captures.
const EN = process.env.CAPTURE_LANG === "en";
const LOCALE = EN ? "en-US" : "fr-CA";
const SCALE = Number(process.env.CAPTURE_SCALE ?? 1) || 1;
const staticDir = resolve(process.env.SAGAX_STATIC_DIR ?? "dist");
mkdirSync(outDir, { recursive: true });

const OWNER = "pr_owner_capture";
const READER = "pr_reader_capture";
const data = mkdtempSync(join(tmpdir(), "sagax-page-reader-capture-"));
const pages = new PublishedPages(data);

const HTML_EN = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Monthly report</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:48rem;margin:2.5rem auto;padding:0 1.25rem;color:#1f2328;background:#fff}
h1{font-size:2rem;margin:0 0 .25rem}.lead{color:#57606a;margin-top:0}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:1.5rem 0}.card{border:1px solid #d0d7de;border-radius:10px;padding:12px}
.card b{display:block;font-size:1.6rem}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #d0d7de;padding:.45rem .5rem;text-align:left}
@media (prefers-color-scheme:dark){body{background:#0d1117;color:#e6edf3}.lead{color:#9198a1}.card,th,td{border-color:#30363d}}</style></head>
<body><h1>Monthly report</h1><p class="lead">What the support team did in October.</p>
<div class="cards"><div class="card"><b>128</b>Requests handled</div><div class="card"><b>96%</b>Resolved on time</div><div class="card"><b>4.7</b>Satisfaction</div></div>
<h2>Highlights</h2><p>Request volume grew 12% over the previous month. The average time to resolution dropped under four hours.</p>
<table><thead><tr><th>Category</th><th>Requests</th><th>Average time</th></tr></thead><tbody>
<tr><td>Workstations</td><td>54</td><td>2 h 40</td></tr><tr><td>Network</td><td>31</td><td>5 h 10</td></tr><tr><td>Accounts and access</td><td>43</td><td>1 h 55</td></tr></tbody></table>
<h2>Next steps</h2><p>Replace the oldest workstations and document the onboarding procedure for new employees.</p>
${"<p>Detailed follow-up notes for the team.</p>".repeat(12)}</body></html>`;
const HTML_FR = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Rapport mensuel</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:48rem;margin:2.5rem auto;padding:0 1.25rem;color:#1f2328;background:#fff}
h1{font-size:2rem;margin:0 0 .25rem}.lead{color:#57606a;margin-top:0}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:1.5rem 0}.card{border:1px solid #d0d7de;border-radius:10px;padding:12px}
.card b{display:block;font-size:1.6rem}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #d0d7de;padding:.45rem .5rem;text-align:left}
@media (prefers-color-scheme:dark){body{background:#0d1117;color:#e6edf3}.lead{color:#9198a1}.card,th,td{border-color:#30363d}}</style></head>
<body><h1>Rapport mensuel</h1><p class="lead">Résumé des activités du mois d'octobre.</p>
<div class="cards"><div class="card"><b>128</b>Demandes traitées</div><div class="card"><b>96 %</b>Résolues à temps</div><div class="card"><b>4,7</b>Satisfaction</div></div>
<h2>Faits saillants</h2><p>Le volume de demandes a augmenté de 12 % par rapport au mois précédent. Le temps moyen de résolution est passé sous la barre des quatre heures.</p>
<table><thead><tr><th>Catégorie</th><th>Demandes</th><th>Délai moyen</th></tr></thead><tbody>
<tr><td>Postes de travail</td><td>54</td><td>2 h 40</td></tr><tr><td>Réseau</td><td>31</td><td>5 h 10</td></tr><tr><td>Comptes et accès</td><td>43</td><td>1 h 55</td></tr></tbody></table>
<h2>Prochaines étapes</h2><p>Renouveler les postes les plus anciens et documenter la procédure d'accueil des nouveaux employés.</p>
${"<p>Notes de suivi détaillées pour l'équipe.</p>".repeat(12)}</body></html>`;
const HTML = EN ? HTML_EN : HTML_FR;

// CAPTURE_KIND=markdown|presentation: the same report in our own Markdown
const KIND = process.env.CAPTURE_KIND === "markdown" || process.env.CAPTURE_KIND === "presentation" ? process.env.CAPTURE_KIND : "html";
const MARKDOWN = KIND === "presentation"
  ? "# Bilan du trimestre\n\nTrois chiffres à retenir.\n\n---\n\n## Demandes\n\n- 128 traitées\n- 96 % à temps\n\n---\n\n## Prochaines étapes\n\n1. Renouveler les postes\n2. Documenter l'accueil"
  : "# Rapport mensuel\n\nRésumé des activités du mois d'octobre.\n\n## Faits saillants\n\n| Catégorie | Demandes |\n|---|---|\n| Postes | 54 |\n| Réseau | 31 |\n\n" + "Notes de suivi détaillées pour l'équipe.\n\n".repeat(30);
// CAPTURE_STATE=1 (#1544): a queue whose rows a signed-in reader takes,
// kept by window.sagax.page for every reader of the link
const QUEUE = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>File À traiter</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:44rem;margin:2rem auto;padding:0 1rem}li{display:flex;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid #d0d7de}
li span{flex:1}button{font:inherit;padding:4px 12px;border-radius:999px;border:1px solid #888;background:transparent;color:inherit;cursor:pointer}small{color:#57606a}</style></head>
<body><h1>File « À traiter »</h1><ul id="q"></ul><script>
var rows=["Imprimante du 2e étage","Accès VPN d'un nouvel employé","Poste lent à la réception"];
function draw(){var q=document.getElementById("q");q.innerHTML="";rows.forEach(function(r,i){var e=window.sagax.page.entry("ticket:"+i);var li=document.createElement("li");
var t=document.createElement("span");t.textContent=r;li.appendChild(t);
if(e&&e.value&&e.value.taken){var s=document.createElement("small");s.textContent="Pris par "+e.name;li.appendChild(s)}
else if(window.sagax.page.canWrite()){var b=document.createElement("button");b.textContent="Prendre";b.setAttribute("data-take",String(i));b.onclick=function(){window.sagax.page.set("ticket:"+i,{taken:true})};li.appendChild(b)}
q.appendChild(li)})}
window.sagax.page.subscribe(draw);window.sagax.page.ready.then(draw);
</script></body></html>`;
const made = pages.propose({ ownerId: OWNER, botId: "bot_capture", threadId: "t_capture", title: process.env.CAPTURE_STATE === "1" ? "File À traiter" : EN ? "Monthly report" : "Rapport mensuel", kind: KIND, content: KIND === "html" ? (process.env.CAPTURE_STATE === "1" ? QUEUE : HTML) : MARKDOWN });
if (!made.ok) throw new Error(made.error);
// CAPTURE_ACCESS=org: a page a reader who is not signed in cannot open (#1486)
pages.publish(made.page.id, { version: 1, access: process.env.CAPTURE_ACCESS === "org" ? "org" : "link", expiresAt: null, by: OWNER });
pages.setInvites(made.page.id, { people: [READER], teams: [] }, OWNER);
const pageId = made.page.id;
// two annotations already there (2026-10-28, Annotate), on the HTML report
if (KIND === "html") {
  const first = EN
    ? pages.addThread(pageId, { by: READER, version: 1, text: "Can we add the comparison with the previous quarter?",
      anchor: { kind: "text", quote: "Request volume grew 12%", prefix: "Highlights", suffix: " over the previous month", path: "body > p:nth-of-type(2)", tag: "p" } })
    : pages.addThread(pageId, { by: READER, version: 1, text: "Peut-on ajouter la comparaison avec le trimestre précédent ?",
      anchor: { kind: "text", quote: "Le volume de demandes a augmenté de 12 %", prefix: "Faits saillants", suffix: " par rapport au mois précédent", path: "body > p:nth-of-type(2)", tag: "p" } });
  if (first.ok) pages.reply(pageId, first.thread.id, { by: OWNER, text: EN ? "Yes, I am asking the bot to add it." : "Oui, je demande au bot de l'ajouter." });
  // the page's bot answers too (page_comments, 2026-10-28)
  if (first.ok) pages.reply(pageId, first.thread.id, { by: "bot:bot_capture", text: EN ? "Done: version 2 compares with the previous quarter." : "C'est fait : la version 2 compare avec le trimestre précédent." });
  pages.addThread(pageId, { by: OWNER, version: 1, text: EN ? "Check the network delay before sending." : "Vérifier le délai du réseau avant l'envoi.",
    anchor: { kind: "element", quote: EN ? "Network 31 5 h 10" : "Réseau 31 5 h 10", prefix: "", suffix: "", path: "body > table > tbody > tr:nth-of-type(2)", tag: "tr" } });
}
const viewPath = pages.path(pages.get(pageId)!.linkId!);

function who(req: IncomingMessage): string {
  return /(?:^|;\s*)who=(\w+)/.exec(String(req.headers.cookie ?? ""))?.[1] ?? "anon";
}
function viewerOf(req: IncomingMessage): PageViewer {
  const name = who(req);
  return name === "owner" ? { principalId: OWNER, computerOwner: false } : name === "reader" ? { principalId: READER, computerOwner: false } : null;
}
function authOf(req: IncomingMessage): RequestAuth {
  const viewer = viewerOf(req);
  return { kind: "session", via: "cookie", scopes: ["client"], session: { id: `s_${who(req)}`, ...(viewer?.principalId ? { principalId: viewer.principalId } : {}) } as never };
}

const options: PublicPageOptions = {
  pages,
  viewer: viewerOf,
  names: () => ({ botName: "Scout", personName: "Page owner" }),
  teamsOf: () => [],
  personName: (id: string) => (id === OWNER ? "Page owner" : id === READER ? "Invited reader" : "Colleague"),
  signInPath: (path: string) => `/auth/oidc/start?client=web&return=${encodeURIComponent(path)}`,
  ...(typeof (routesModule as Record<string, unknown>).readerAssetsFrom === "function"
    ? { readerAssets: () => (routesModule as unknown as { readerAssetsFrom(dir: string): unknown }).readerAssetsFrom(staticDir) } : {}),
} as PublicPageOptions;

const apiRoutes = routesModule.createPublishedPageRoutes({
  pages,
  owner: (auth) => auth.kind === "session" ? auth.session.principalId : undefined,
  isPerson: (auth) => auth.kind === "session" && Boolean(auth.session.principalId),
  origin: (req) => `http://${req.headers.host}`,
  reachable: () => true,
  ...({ reader: (auth: RequestAuth) => auth.kind === "session" && auth.session.principalId ? { principalId: auth.session.principalId, computerOwner: false } : null } as object),
  live: new PageLive(),
  ...({ names: (ids: string[]) => Object.fromEntries(ids.map((id) => [id, id === OWNER ? "Page owner" : id === READER ? "Invited reader" : "Scout"])) } as object),
} as Parameters<typeof routesModule.createPublishedPageRoutes>[0]);

const DIRECTORY = {
  people: [
    { principalId: OWNER, name: "Page owner", login: "owner", email: "owner@example.com" },
    { principalId: READER, name: "Invited reader", login: "reader", email: "reader@example.com" },
    { principalId: "pr_other_capture", name: "Colleague", login: "colleague", email: "colleague@example.com" },
  ],
  teams: [{ id: "team_capture", name: "Soutien technique", members: [READER, "pr_other_capture"], managers: [OWNER] }],
};

const MIME: Record<string, string> = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml" };

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method ?? "GET";
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

async function shot(page: Page, name: string) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(outDir, `${prefix}-${name}.png`) });
  console.log(join(outDir, `${prefix}-${name}.png`));
}

try {
  for (const scheme of (process.env.CAPTURE_SCHEME === "light" || process.env.CAPTURE_SCHEME === "dark" ? [process.env.CAPTURE_SCHEME] : ["light", "dark"]) as Array<"light" | "dark">) {
    for (const person of ["anon", "reader", "owner"] as const) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: SCALE, colorScheme: scheme, locale: LOCALE, extraHTTPHeaders: { "accept-language": LOCALE } });
      await context.addCookies([{ name: "who", value: person, url: base }]);
      const page = await context.newPage();
      page.on("pageerror", (error) => console.error(`[${person}/${scheme}] ${error.message}`));
      await page.goto(`${base}${viewPath}`);
      await page.waitForLoadState("load");
      await page.waitForTimeout(500);
      await shot(page, `${person}-${scheme}`);
      if (person === "anon" && await page.locator("[data-reader-pdf]").count()) {
        // what Download PDF writes: the browser's print of the wrapper
        await page.pdf({ path: join(outDir, `${prefix}-${person}-${scheme}.pdf`), format: "A4", preferCSSPageSize: true });
        console.log(join(outDir, `${prefix}-${person}-${scheme}.pdf`));
      }
      if (process.env.CAPTURE_STATE === "1" && person === "reader") {
        // take a ticket, refresh: it stays taken, with the name
        await page.frames()[1]!.locator("[data-take='0']").click();
        await page.frames()[1]!.waitForSelector("text=Pris par");
        await page.reload();
        await page.waitForTimeout(800);
        await shot(page, `${person}-${scheme}-taken`);
      }
      if (process.env.CAPTURE_STATE === "1" && person === "owner") await shot(page, `${person}-${scheme}-sees-taken`);
      if (process.env.CAPTURE_STATE === "1" && person === "owner" && await page.locator("[data-reader-state]").count()) {
        // Page state (2026-10-29): what readers set, a key made read-only
        await page.locator("[data-reader-state]").click();
        await page.waitForSelector("[data-state-lock]");
        await page.locator("[data-state-lock]").first().click();
        await page.waitForSelector("[data-state-lock][aria-pressed='true']");
        await shot(page, `${person}-${scheme}-state-panel`);
      }
      if (KIND === "markdown" && person === "reader" && await page.locator("[data-reader-annotate]").count()) {
        // a suggested edit (2026-10-28): select words, Suggest an edit, the new words
        await page.locator("[data-reader-annotate]").click();
        await page.waitForSelector("[data-reader-panel]");
        await page.frames()[1]!.evaluate(() => {
          const target = [...document.querySelectorAll("p")].find((p) => p.textContent?.startsWith("Résumé"))!;
          const range = document.createRange();
          range.setStart(target.firstChild!, 0);
          range.setEnd(target.firstChild!, 39);
          getSelection()!.removeAllRanges();
          getSelection()!.addRange(range);
          document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        });
        await page.waitForSelector("[data-reader-draft]");
        await page.locator("[data-reader-suggest]").check();
        await page.locator("[data-reader-replacement]").fill("Résumé des activités du mois d'octobre et de septembre");
        await page.locator("[data-reader-draft] textarea").last().fill("Le rapport couvre les deux mois.");
        await shot(page, `${person}-${scheme}-suggest`);
        await page.locator("[data-reader-draft] button[type=submit]").click();
        await page.waitForSelector("[data-suggestion=open]");
      }
      if (KIND === "markdown" && person === "owner") {
        await page.locator("[data-reader-annotate]").click();
        await page.waitForSelector("[data-suggestion-accept]");
        await shot(page, `${person}-${scheme}-suggestion`);
        await Promise.all([page.waitForNavigation(), page.locator("[data-suggestion-accept]").first().click()]);
        await page.waitForTimeout(600);
        await shot(page, `${person}-${scheme}-accepted`);
      }
      if (KIND === "html" && process.env.CAPTURE_STATE !== "1" && person === "reader" && await page.locator("[data-reader-annotate]").count()) {
        await page.locator("[data-reader-annotate]").click();
        await page.waitForSelector("[data-reader-panel] [data-thread]");
        await shot(page, `${person}-${scheme}-annotate`);
        // a new selection in the page: the composer opens in the panel
        await page.frames()[1]!.evaluate(() => {
          const target = [...document.querySelectorAll("p")].find((p) => p.textContent?.startsWith("Renouveler") || p.textContent?.startsWith("Replace"))!;
          const range = document.createRange();
          range.setStart(target.firstChild!, 0);
          range.setEnd(target.firstChild!, 33);
          getSelection()!.removeAllRanges();
          getSelection()!.addRange(range);
          document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        });
        await page.waitForSelector("[data-reader-draft]");
        await page.locator("[data-reader-draft] textarea").fill(EN ? "Add the timeline." : "Préciser l'échéancier.");
        await shot(page, `${person}-${scheme}-draft`);
      }
      if (person === "owner" && KIND === "html" && process.env.CAPTURE_STATE !== "1") {
        // live: an invited reader has the page open and comments; the
        // owner's bar shows them and the panel takes the comment at once
        const other = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: SCALE, colorScheme: scheme, locale: LOCALE, extraHTTPHeaders: { "accept-language": LOCALE } });
        await other.addCookies([{ name: "who", value: "reader", url: base }]);
        const readerPage = await other.newPage();
        await readerPage.goto(`${base}${viewPath}`);
        await page.waitForSelector("[data-reader-presence]");
        await page.locator("[data-reader-annotate]").click();
        await page.waitForSelector("[data-reader-panel] [data-thread]");
        await readerPage.evaluate(async (id) => {
          await fetch(`/api/pages/${id}/threads`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "Ajouter les chiffres de septembre ?",
            anchor: { kind: "text", quote: "Demandes traitées", prefix: "128", suffix: "96 %", path: "body > div > div", tag: "div" } }) });
        }, pageId);
        await page.waitForFunction(() => document.querySelectorAll("[data-reader-panel] [data-thread]").length === 3);
        await shot(page, `${person}-${scheme}-live`);
        await other.close();
        await page.locator("[data-reader-annotate]").click();
      }
      if (person === "owner") {
        const share = page.locator("[data-reader-share]");
        if (await share.count()) {
          await share.click();
          await page.waitForSelector("[data-page-share-popover]");
          await shot(page, `${person}-${scheme}-share`);
        }
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  server.close();
  rmSync(data, { recursive: true, force: true });
}
