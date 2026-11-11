#!/usr/bin/env node
/**
 * Headless captures for a page's capabilities (#3413 lot 1b).
 * Default launch is channel chrome. CAPTURE_CHROMIUM, when set, is the
 * chromium binary used instead of that channel.
 * Reference set: docs/screenshots/page-capabilities (cited here so the #1386
 * docs-media guard keeps the PNGs on the product branch).
 *  - the publication card with what the page reads (gallery page-viewer.html);
 *  - the reading link's bar with "Reads", the Ask first card and the link
 *    confirmation, light and dark, at 1100, 700 and 390, in English and
 *    French, plus iPhone 14 and iPad, around a test page that
 *    declares `data`, `viewer`, `open` and `files.download` and shows the
 *    answers it gets.
 * The reading link is the real wrapper (server/pages/published-pages-render.ts
 * wrapperDocument), the real sandboxed frame (pageDocument, CSP, sandbox
 * without allow-same-origin) and the real broker (src/page-reader), bundled
 * with esbuild; a small mock server answers the page-data routes.
 * No window on the desktop: headless only. Port 5176 to 5206, never 5173.
 * Usage: node scripts/capture/page-capabilities.mjs [--out DIR] [--port N]
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const outDir = resolve(arg("--out") ?? join(root, "docs/screenshots/page-capabilities"));
const galleryPort = Number(arg("--port") ?? 5190);
const readerPort = galleryPort + 1;
const scratch = resolve(arg("--scratch") ?? join(outDir, ".build"));
await mkdir(outDir, { recursive: true });

const { chromium, devices } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");

// the reading link ---------------------------------------------------------
await build({
  entryPoints: [join(root, "src/page-reader/main.tsx")], bundle: true, format: "esm", outdir: join(scratch, "assets"), entryNames: "pr",
  jsx: "automatic", alias: { "@": join(root, "src") }, loader: { ".svg": "dataurl", ".png": "dataurl", ".woff2": "dataurl" }, logLevel: "error",
});
const render = await import(pathToFileURL(join(root, "server/pages/published-pages-render.ts")).href);
const shared = await import(pathToFileURL(join(root, "shared/published-pages.ts")).href);

const PAGE_ID = "capsPage00001";
const TOKEN = "tok-capabilities";
const CAPS = { data: ["team-board"], viewer: true, open: true, files: ["download"] };
const BOARD = {
  value: { lanes: [
    { id: "todo", title: "To do", cards: [{ title: "Show the work of the coding teams" }, { title: "Weekly board digest" }] },
    { id: "review", title: "In review", cards: [{ title: "Page capabilities, the wrapper" }] },
    { id: "merged", title: "Merged", cards: [{ title: "Page capabilities, the server" }] },
  ] },
  links: ["https://github.com/pulsatrix/sagax/pull/3417"], refs: [],
};
function testPage(lang) {
  const fr = lang === "fr";
  const title = fr ? "Tableau d'équipe, page d'essai" : "Team board, test page";
  const lead = fr
    ? "Déclare les lectures, le lecteur, l'ouverture et un fichier. Chaque ligne est une réponse reçue par message."
    : "Declares data, viewer, open and a file. Every line below is an answer this page got by message.";
  const refresh = fr ? "Rafraîchir" : "Refresh";
  const openOk = fr ? "Ouvrir la demande" : "Open the pull request";
  const openOther = fr ? "Ouvrir une autre adresse" : "Open another address";
  const save = fr ? "Enregistrer note.txt" : "Save note.txt";
  const saved = fr ? "enregistré note.txt" : "saved note.txt";
  return `<!doctype html><html><head><meta charset="utf-8"><title>Capabilities test</title>
<script type="application/sagax-capabilities+json">${JSON.stringify(CAPS)}</script>
<style>:root{color-scheme:light dark}body{font:14px/1.45 system-ui;margin:0;padding:20px}h1{font-size:18px;margin:0 0 4px}
p.m{margin:0 0 14px;opacity:.7}.card{border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:12px;padding:12px 14px;margin:0 0 10px}
.card b{display:block;font-size:12px;opacity:.7;margin-bottom:4px}button,a.l{font:inherit;margin:0 8px 8px 0;padding:6px 12px;border-radius:999px;border:1px solid color-mix(in srgb,currentColor 25%,transparent);background:transparent;color:inherit;cursor:pointer}</style></head>
<body><h1>${title}</h1><p class="m">${lead}</p>
<div class="card"><b>sagax.capabilities</b><span id="caps"></span></div>
<div class="card"><b>sagax.data.read("team-board")</b><span id="data">waiting...</span></div>
<div class="card"><b>sagax.viewer.get()</b><span id="viewer">waiting...</span></div>
<span id="file" hidden></span>
<div><button id="refresh">${refresh}</button><button id="open-ok">${openOk}</button><button id="open-other">${openOther}</button><button id="save-note">${save}</button></div>
<script>
const out=(id,t)=>{document.getElementById(id).textContent=t};
out("caps",JSON.stringify(sagax.capabilities));
const read=(fresh)=>sagax.data.read("team-board",fresh?{fresh:true}:{}).then(v=>out("data",v.lanes.map(l=>l.title+": "+l.cards.length).join(" \u00b7 ")),e=>out("data","refused: "+e.code));
read(false);sagax.data.subscribe("team-board",v=>out("data",v.lanes.map(l=>l.title+": "+l.cards.length).join(" \u00b7 ")+" (updated)"));
sagax.viewer.get().then(v=>out("viewer",v.name+" \u00b7 "+v.role),e=>out("viewer","refused: "+e.code));
document.getElementById("refresh").onclick=()=>read(true);
document.getElementById("open-ok").onclick=()=>sagax.open("https://github.com/pulsatrix/sagax/pull/3417");
document.getElementById("open-other").onclick=()=>sagax.open("https://example.org/somewhere-else?board=To+do+2+In+review+1+Merged+1&owner=ada&token_like=aGVsbG8gd29ybGQgdGhpcyBpcyBkYXRhIHRoYXQgbGVhdmVz&note=the+page+can+put+anything+here#section-3");
document.getElementById("save-note").onclick=()=>sagax.files.download({name:"note.txt",mime:"text/plain",data:btoa("hello")}).then(()=>out("file","${saved}"),e=>out("file","refused: "+e.code));
</script></body></html>`;
}

let askFirst = false;
let approved = false;
const bootFor = (lang) => ({ v: 1, lang, title: "Team board", kind: "html", version: 1, pageId: PAGE_ID, me: { id: "pr_ada", name: "Ada" }, owner: { name: "Ada" }, can: { share: true, annotate: true }, bot: { name: "Ember", color: "#4c8dff" } });
const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === `/pages/view/${TOKEN}`) {
    const lang = url.searchParams.get("lang") === "fr" ? "fr" : "en";
    const html = render.wrapperDocument({ title: "Team board", kind: "html", botName: "Ember", personName: "Ada", frameUrl: `/pages/frame/${TOKEN}?lang=${lang}`, lang,
      reader: { boot: bootFor(lang), assets: { scripts: ["/assets/pr.js"], styles: ["/assets/pr.css"], preloads: [] }, look: null, botHex: "#4c8dff" } });
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(html);
  }
  if (url.pathname === `/pages/frame/${TOKEN}`) {
    const lang = url.searchParams.get("lang") === "fr" ? "fr" : "en";
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": shared.pageCsp("html") });
    return res.end(render.pageDocument({ kind: "html", title: "Team board", content: testPage(lang) }, { reportSize: true, capabilities: CAPS }));
  }
  if (url.pathname.startsWith("/assets/")) {
    try {
      const file = await readFile(join(scratch, url.pathname));
      res.writeHead(200, { "content-type": url.pathname.endsWith(".css") ? "text/css" : "text/javascript" }); return res.end(file);
    } catch { res.writeHead(404); return res.end(); }
  }
  const base = `/api/pages/${PAGE_ID}`;
  if (url.pathname === `${base}/capabilities`) return json(res, 200, { capabilities: CAPS, reads: [{ name: "team-board", label: "The work of your coding teams" }] });
  if (url.pathname === `${base}/data/team-board`) {
    if (askFirst && !approved) return json(res, 409, { error: "Your organization asks you first before this page reads your data.", code: "ask_first", approvalId: "ap_capture", source: "team-board", version: 1 });
    return json(res, 200, { name: "team-board", at: Date.now(), ...BOARD });
  }
  if (url.pathname === `${base}/data-approvals/ap_capture` && req.method === "POST") { approved = true; return json(res, 200, { ok: true }); }
  // what lot 1a's server will answer for "Always allow this site"
  if (url.pathname === `${base}/link-approvals` && req.method === "GET") return json(res, 200, { allowed: false });
  if (url.pathname === `${base}/link-approvals` && req.method === "POST") return json(res, 200, { ok: true });
  if (url.pathname === `${base}/viewer`) return json(res, 200, { name: "Ada", handle: "h_ada", role: "owner", lang: "en" });
  if (url.pathname === `${base}/live`) { res.writeHead(200, { "content-type": "text/event-stream" }); return res.write(`event: presence\ndata: {"people":[]}\n\n`); }
  res.writeHead(404, { "content-type": "application/json" }); res.end("{}");
});
await new Promise((done) => server.listen(readerPort, "127.0.0.1", done));

// the gallery (the publication card) ----------------------------------------
const vite = spawn("pnpm", ["exec", "vite", "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(galleryPort), "--strictPort"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, detached: true,
});
async function waitForServer(url, ms = 180_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* retry */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`gallery did not start at ${url}`);
}

let browser;
try {
  const chromiumPath = process.env.CAPTURE_CHROMIUM;
  browser = await chromium.launch(chromiumPath
    ? { executablePath: chromiumPath, headless: true }
    : { channel: "chrome", headless: true });
  const shoot = async (page, name) => { const file = join(outDir, `${name}.png`); await page.screenshot({ path: file }); console.log(file); };

  // the reading link. CAPTURE_PROBE_ONLY runs the one click below and skips the shots.
  if (process.env.CAPTURE_PROBE_ONLY !== "1") {
  for (const scheme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 640 }, deviceScaleFactor: 2, colorScheme: scheme });
    const page = await context.newPage();
    page.on("pageerror", (error) => console.error("page error:", error.stack));
    if (process.env.CAPTURE_DEBUG) page.on("console", (message) => console.error("console:", message.text()));
    if (process.env.CAPTURE_DEBUG) await page.addInitScript(() => addEventListener("message", (e) => console.log("MSG", e.origin, String(JSON.stringify(e.data)).slice(0, 90))));
    const frame = () => page.frameLocator("iframe");
    // 1. the page got its answers; the bar shows what it may read
    askFirst = false;
    await page.goto(`http://127.0.0.1:${readerPort}/pages/view/${TOKEN}`, { waitUntil: "load" });
    if (process.env.CAPTURE_DEBUG) { await page.waitForTimeout(3000); console.error("frame text:", await frame().locator("body").innerText().catch((e) => String(e))); await page.screenshot({ path: join(outDir, "debug.png") }); }
    await frame().locator("#data", { hasText: "To do: 2" }).waitFor({ timeout: 15_000 });
    await frame().locator("#viewer", { hasText: "Ada" }).waitFor();
    await page.locator("[data-reader-caps]").click();
    await page.waitForSelector("[data-page-caps-panel]");
    await shoot(page, `reader-reads-${scheme}`);
    // 2. a link that no data answer named waits for a click
    await page.keyboard.press("Escape");
    await frame().locator("#open-other").click();
    await page.waitForSelector("[data-cap-link]");
    await shoot(page, `reader-link-confirm-${scheme}`);
    await context.close();

    // 3. the organization asks first
    askFirst = true;
    approved = false;
    const ask = await browser.newContext({ viewport: { width: 1100, height: 640 }, deviceScaleFactor: 2, colorScheme: scheme });
    const askPage = await ask.newPage();
    await askPage.goto(`http://127.0.0.1:${readerPort}/pages/view/${TOKEN}`, { waitUntil: "load" });
    await askPage.waitForSelector("[data-cap-approval]");
    await askPage.waitForTimeout(300);
    await shoot(askPage, `reader-ask-first-${scheme}`);
    // a card ignores clicks for 600 ms after it appears
    await askPage.waitForTimeout(700);
    await askPage.locator("[data-cap-allow]").click();
    await askPage.frameLocator("iframe").locator("#data", { hasText: "To do: 2" }).waitFor({ timeout: 15_000 });
    await ask.close();

    // 4. a narrow window
    approved = false;
    const narrow = await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2, colorScheme: scheme });
    const narrowPage = await narrow.newPage();
    await narrowPage.goto(`http://127.0.0.1:${readerPort}/pages/view/${TOKEN}`, { waitUntil: "load" });
    await narrowPage.waitForSelector("[data-cap-approval]");
    await narrowPage.waitForTimeout(300);
    await shoot(narrowPage, `reader-narrow-ask-first-${scheme}`);
    await narrow.close();
    // 5. the link card with its whole address, narrow
    askFirst = false;
    const narrowLink = await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2, colorScheme: scheme });
    const narrowLinkPage = await narrowLink.newPage();
    await narrowLinkPage.goto(`http://127.0.0.1:${readerPort}/pages/view/${TOKEN}`, { waitUntil: "load" });
    await narrowLinkPage.frameLocator("iframe").locator("#data", { hasText: "To do: 2" }).waitFor({ timeout: 15_000 });
    await narrowLinkPage.frameLocator("iframe").locator("#open-other").click();
    await narrowLinkPage.waitForSelector("[data-cap-link]");
    await narrowLinkPage.waitForTimeout(300);
    await shoot(narrowLinkPage, `reader-narrow-link-confirm-${scheme}`);
    await narrowLink.close();
    askFirst = false;
  }

  // 700, French, iPhone and iPad, light and dark, beside the same reader states
  const extra = [
    { tag: "700", lang: "en", size: { width: 700, height: 900 } },
    { tag: "fr", lang: "fr", size: { width: 1100, height: 640 } },
    { tag: "fr-700", lang: "fr", size: { width: 700, height: 900 } },
    { tag: "iphone", lang: "en", size: { device: "iPhone 14" } },
    { tag: "iphone-fr", lang: "fr", size: { device: "iPhone 14" } },
    { tag: "ipad", lang: "en", size: { device: "iPad (gen 7)" } },
  ];
  const readerContext = async (scheme, lang, size) => {
    const preset = size.device ? devices[size.device] : null;
    if (size.device && !preset) throw new Error(`unknown device ${size.device}`);
    const options = preset
      ? { ...preset, colorScheme: scheme, locale: lang === "fr" ? "fr-CA" : "en-CA" }
      : { viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2, colorScheme: scheme, locale: lang === "fr" ? "fr-CA" : "en-CA" };
    const context = await browser.newContext({ ...options, acceptDownloads: true });
    const page = await context.newPage();
    page.on("pageerror", (error) => console.error("page error:", error.stack));
    return { context, page };
  };
  for (const scheme of ["light", "dark"]) {
    for (const shot of extra) {
      askFirst = false;
      approved = false;
      const opened = await readerContext(scheme, shot.lang, shot.size);
      const frame = opened.page.frameLocator("iframe");
      await opened.page.goto(`http://127.0.0.1:${readerPort}/pages/view/${TOKEN}?lang=${shot.lang}`, { waitUntil: "load" });
      await frame.locator("#data", { hasText: "To do: 2" }).waitFor({ timeout: 15_000 });
      await opened.page.locator("[data-reader-caps]").click();
      await opened.page.locator("[data-cap-file]").waitFor({ timeout: 8_000 });
      await shoot(opened.page, `reader-${shot.tag}-reads-${scheme}`);
      await opened.page.keyboard.press("Escape");
      await frame.locator("#open-other").click();
      await opened.page.waitForSelector("[data-cap-link]");
      await opened.page.waitForTimeout(200);
      await shoot(opened.page, `reader-${shot.tag}-link-confirm-${scheme}`);
      await opened.context.close();

      askFirst = true;
      approved = false;
      const ask = await readerContext(scheme, shot.lang, shot.size);
      await ask.page.goto(`http://127.0.0.1:${readerPort}/pages/view/${TOKEN}?lang=${shot.lang}`, { waitUntil: "load" });
      await ask.page.waitForSelector("[data-cap-approval]");
      await ask.page.waitForTimeout(250);
      await shoot(ask.page, `reader-${shot.tag}-ask-first-${scheme}`);
      await ask.context.close();
      askFirst = false;
    }
  }
  }

  // one real click: the browser download is the proof a load cannot save
  {
    askFirst = false;
    approved = false;
    const context = await browser.newContext({ viewport: { width: 1100, height: 640 }, colorScheme: "light" });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${readerPort}/pages/view/${TOKEN}?lang=en`, { waitUntil: "load" });
    const frame = page.frameLocator("iframe");
    await frame.locator("#data", { hasText: "To do: 2" }).waitFor({ timeout: 15_000 });
    const downloadPromise = page.waitForEvent("download", { timeout: 4_000 }).catch(() => null);
    await frame.locator("#save-note").click();
    const download = await downloadPromise;
    await frame.locator("#file").filter({ hasText: /.+/ }).waitFor({ timeout: 8_000 }).catch(() => undefined);
    const status = await frame.locator("#file").innerText().catch(() => "");
    console.log(`FILE probe en light name=${download ? download.suggestedFilename() : "none"} status=${JSON.stringify(status)}`);
    if (!download || (status !== "saved note.txt" && status !== "enregistré note.txt")) {
      throw new Error(`file probe failed name=${download ? download.suggestedFilename() : "none"} status=${JSON.stringify(status)}`);
    }
    if (download) await download.cancel().catch(() => undefined);
    await context.close();
  }

  if (process.env.CAPTURE_PROBE_ONLY !== "1") {
  // the publication card, next to its neighbour (a page that declares nothing)
  await waitForServer(`http://127.0.0.1:${galleryPort}/src/gallery/page-viewer.html`);
  const cards = [
    { lang: "en", tag: "", width: 820, height: 420 },
    { lang: "en", tag: "-700", width: 700, height: 520 },
    { lang: "en", tag: "-390", width: 390, height: 720 },
    { lang: "fr", tag: "-fr", width: 820, height: 420 },
    { lang: "fr", tag: "-fr-700", width: 700, height: 520 },
    { lang: "en", tag: "-iphone", device: "iPhone 14" },
    { lang: "fr", tag: "-iphone-fr", device: "iPhone 14" },
    { lang: "en", tag: "-ipad", device: "iPad (gen 7)" },
  ];
  for (const scheme of ["light", "dark"]) {
    for (const card of cards) {
      const preset = card.device ? devices[card.device] : null;
      const context = await browser.newContext(preset
        ? { ...preset, colorScheme: scheme, locale: card.lang === "fr" ? "fr-CA" : "en-CA" }
        : { viewport: { width: card.width, height: card.height }, deviceScaleFactor: 2, colorScheme: scheme, locale: card.lang === "fr" ? "fr-CA" : "en-CA" });
      const page = await context.newPage();
      for (const [name, query] of [["card-declares", "caps=1"], ["card-neighbour", ""]]) {
        await page.goto(`http://127.0.0.1:${galleryPort}/src/gallery/page-viewer.html?lang=${card.lang}&skin=pulsatrix&view=card&status=published&${query}`, { waitUntil: "load" });
        await page.waitForSelector("[data-page-card]");
        await page.waitForTimeout(400);
        const file = join(outDir, `${name}${card.tag}-${scheme}.png`);
        await page.locator("[data-page-card]").screenshot({ path: file });
        console.log(file);
      }
      await context.close();
    }
  }
  }
} finally {
  await browser?.close();
  server.close();
  try { process.kill(-vite.pid, "SIGTERM"); } catch { /* already gone */ }
}
