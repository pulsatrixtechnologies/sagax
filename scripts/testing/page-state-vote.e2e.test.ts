// An anonymous vote on a published page, end to end and headless
// (2026-10-29): a throwaway server answers the reading link with the real
// handlers (server/routes/published-pages.ts) over a temporary store; a real
// Chromium opens the link with no session, the page's own script votes
// through window.sagax.page, and the server keeps it because the page
// declares its vote keys "anyone" and the link is public. A second browser
// (another reader, not signed in) sees the vote; a key the page leaves at
// its default stays closed to both. Nothing touches the person's data.
//
// Needs the built reader script (dist/page-reader.html, `pnpm exec vite
// build`). Without it the test is skipped with a notice; SAGAX_UI_E2E=1
// makes the missing build a failure.
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

import { PublishedPages } from "../../server/pages/published-pages.ts";
import { handlePublishedPagePublic, readerAssetsFrom, type PublicPageOptions } from "../../server/routes/published-pages.ts";
import { removeTempDir } from "../../server/testing/cleanup.ts";
import { ensureUiBrowser } from "./control-omb-ui.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const dist = process.env.SAGAX_PAGES_OPEN_DIST || join(root, "dist");
const built = existsSync(join(dist, "page-reader.html"));
const required = process.env.SAGAX_UI_E2E === "1";
if (!built && !required) console.log("skipping page-state-vote: build the UI (pnpm exec vite build) to run the headless anonymous vote");

const VOTE_PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Vote</title>
<script type="application/sagax-state+json">{"vote:*":"anyone"}</script></head>
<body><h1>Quel jour pour la formation ?</h1>
<p><button id="mardi">Mardi</button> <button id="jeudi">Jeudi</button> <button id="close">Fermer le vote</button></p>
<p id="tally">…</p><p id="status"></p>
<script>
var page=window.sagax.page;
function draw(){var all=page.all(),count={mardi:0,jeudi:0};Object.keys(all).forEach(function(k){if(k.indexOf("vote:")===0&&count[all[k].value]!==undefined)count[all[k].value]++});
document.getElementById("tally").textContent="mardi="+count.mardi+" jeudi="+count.jeudi+" can="+page.canWrite("vote:"+page.me())+" me="+(page.me()?"yes":"no")}
function vote(day){page.set("vote:"+page.me(),day).then(function(){document.getElementById("status").textContent="ok"},function(e){document.getElementById("status").textContent="refused: "+e.message})}
document.getElementById("mardi").onclick=function(){vote("mardi")};
document.getElementById("jeudi").onclick=function(){vote("jeudi")};
document.getElementById("close").onclick=function(){page.set("closed",true).then(function(){document.getElementById("status").textContent="ok"},function(e){document.getElementById("status").textContent="refused: "+e.message})};
page.subscribe(draw);page.ready.then(draw);
</script></body></html>`;

const MIME: Record<string, string> = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml" };

(built || required ? it : it.skip)("a reader not signed in votes on a public page that allows it, and another reader sees the vote", async () => {
  if (!built) throw new Error("Run pnpm exec vite build before the page-state-vote check");
  const { chromium } = await import("playwright");
  const data = mkdtempSync(join(tmpdir(), "sagax-page-state-vote-"));
  let server: Server | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const pages = new PublishedPages(data);
    const made = pages.propose({ ownerId: "pr_owner_e2e", botId: "bot_e2e", threadId: "t_e2e", title: "Vote", kind: "html", content: VOTE_PAGE });
    if (!made.ok) throw new Error(made.error);
    pages.publish(made.page.id, { version: 1, access: "link", expiresAt: null, by: "pr_owner_e2e" });
    const viewPath = pages.path(pages.get(made.page.id)!.linkId!);
    const options: PublicPageOptions = {
      pages,
      viewer: () => null,
      names: () => ({ botName: "Scout", personName: "Page owner" }),
      readerAssets: () => readerAssetsFrom(dist),
    };
    const handle = (req: IncomingMessage, res: ServerResponse) => {
      const path = new URL(req.url ?? "/", "http://x").pathname;
      if (handlePublishedPagePublic(options, req, res, path, req.method ?? "GET")) return;
      if (path.startsWith("/assets/")) {
        try {
          const body = readFileSync(join(dist, path.replace(/\.\./g, "")));
          res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
          res.end(body);
          return;
        } catch { /* below */ }
      }
      res.writeHead(404);
      res.end();
    };
    server = createServer(handle);
    await new Promise<void>((done) => server!.listen(0, "127.0.0.1", done));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    // the Chrome for Testing the other UI checks use (the test home has no Playwright cache)
    const chrome = process.env.SAGAX_CHROMIUM || (await ensureUiBrowser()).chrome;
    browser = await chromium.launch({ headless: true, ...(chrome ? { executablePath: chrome } : {}) });

    const open = async () => {
      const context = await browser!.newContext({ locale: "fr-CA", extraHTTPHeaders: { "accept-language": "fr-CA" } });
      const tab = await context.newPage();
      const errors: string[] = [];
      tab.on("pageerror", (error) => errors.push(error.message));
      await tab.goto(`${base}${viewPath}`);
      const frame = tab.frameLocator("iframe");
      await expect.poll(async () => frame.locator("#tally").textContent(), { timeout: 15_000 }).toContain("me=yes");
      return { context, frame, errors };
    };

    // the first reader, not signed in: may vote (the page says anyone)
    const first = await open();
    await expect.poll(async () => first.frame.locator("#tally").textContent()).toBe("mardi=0 jeudi=0 can=true me=yes");
    await first.frame.locator("#mardi").click();
    await expect.poll(async () => first.frame.locator("#status").textContent(), { timeout: 10_000 }).toBe("ok");
    await expect.poll(async () => first.frame.locator("#tally").textContent()).toContain("mardi=1 jeudi=0");
    // a key the page leaves at its default: refused, on the server too
    await first.frame.locator("#close").click();
    await expect.poll(async () => first.frame.locator("#status").textContent(), { timeout: 10_000 }).toBe("refused: Connectez-vous pour modifier cette page.");
    expect(pages.state(made.page.id).closed).toBeUndefined();

    // the server kept one vote, as Anonyme, under a hash of the browser's id
    const stored = Object.entries(pages.state(made.page.id));
    expect(stored).toHaveLength(1);
    expect(stored[0]![1]).toMatchObject({ value: "mardi" });
    expect(stored[0]![1].by).toMatch(/^anon:[\w-]{16}$/);

    // a second reader, another browser: sees the vote, votes too, own key
    const second = await open();
    await expect.poll(async () => second.frame.locator("#tally").textContent(), { timeout: 10_000 }).toContain("mardi=1 jeudi=0");
    await second.frame.locator("#jeudi").click();
    await expect.poll(async () => second.frame.locator("#tally").textContent(), { timeout: 10_000 }).toContain("mardi=1 jeudi=1");
    expect(Object.keys(pages.state(made.page.id))).toHaveLength(2);

    // the refresh keeps it for the first reader
    const firstTab = first.context.pages()[0]!;
    await firstTab.reload();
    await expect.poll(async () => first.frame.locator("#tally").textContent(), { timeout: 15_000 }).toContain("mardi=1 jeudi=1");

    // once public links are off, the page reads as the organization's: the
    // same browser cannot vote
    pages.setPolicy({ linkSharing: false });
    const refused = await firstTab.evaluate(async (path) => (await fetch(path, { method: "PUT", headers: { "content-type": "application/json", "x-sagax-reader": "z".repeat(22) }, body: JSON.stringify({ key: "vote:late", value: "mardi" }) })).status, viewPath.replace("/pages/view/", "/pages/state/"));
    expect(refused).toBe(404);
    expect(first.errors).toEqual([]);
    expect(second.errors).toEqual([]);
  } finally {
    await browser?.close();
    await new Promise<void>((done) => (server ? server.close(() => done()) : done()));
    await removeTempDir(data);
  }
}, 120_000);
