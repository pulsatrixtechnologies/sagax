// Published pages through the real server (server/index.ts wiring): the
// reading link is answered before the auth gate with the sandbox CSP and no
// cookie, publish and revoke go through the person's API, and a revoked
// link is gone. The proposal is written to the fixture's own data folder,
// as the bot's card route would.
import { expect, it } from "vitest";

import { launchVerificationServer } from "../../scripts/control-omb.ts";
import { PublishedPages } from "./published-pages.ts";

it("serves a published page in its wrapper and sandboxed frame, and stops at once when it is revoked", async () => {
  const fixture = await launchVerificationServer();
  try {
    const url = fixture.info.url;
    const pages = new PublishedPages(fixture.info.dataDir);
    const made = pages.propose({ botId: "b1", threadId: "t1", title: "Rapport", kind: "html", content: "<!doctype html><p>Bonjour</p><script>fetch('/api/config')</script>" });
    if (!made.ok) throw new Error(made.error);
    const id = made.page.id;
    const api = async (path: string, method = "GET", body?: unknown) => {
      const init: RequestInit = body === undefined ? { method } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
      const response = await fetch(`${url}${path}`, init);
      return { status: response.status, body: await response.json() as any };
    };
    // nothing to read before the person publishes
    expect((await api(`/api/pages/${id}`)).body.page).toMatchObject({ status: "draft" });
    // the app previews it through the wrapper, never a srcdoc
    const previewPath: string = (await api(`/api/pages/${id}/versions/1`)).body.version.previewPath;
    const preview = await fetch(`${url}${previewPath}`);
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-security-policy")).toContain(`/pages/preview-frame/${id}/1;`);
    const previewFrame = /<iframe src="([^"]+)"/.exec(await preview.text())![1]!.replace(/&amp;/g, "&");
    expect((await fetch(`${url}${previewFrame}`, { headers: { "sec-fetch-dest": "iframe" } })).status).toBe(200);
    const published = await api(`/api/pages/${id}/publish`, "POST", { version: 1, access: "link", expiresAt: null });
    expect(published.status).toBe(200);
    const path: string = published.body.page.path;
    const wrapper = await fetch(`${url}${path}`, { headers: { origin: "https://elsewhere.example" } });
    expect(wrapper.status).toBe(200);
    expect(wrapper.headers.get("set-cookie")).toBeNull();
    expect(wrapper.headers.get("content-security-policy")).toContain(`/pages/frame/${path.slice("/pages/view/".length)};`);
    const body = await wrapper.text();
    expect(body).toContain("never enter a password here");
    const frameSrc = /<iframe src="([^"]+)"/.exec(body)![1]!.replace(/&amp;/g, "&");
    // never as a top-level document
    expect((await fetch(`${url}${frameSrc}`, { headers: { "sec-fetch-dest": "document" } })).status).toBe(404);
    const frame = await fetch(`${url}${frameSrc}`, { headers: { "sec-fetch-dest": "iframe" } });
    expect(frame.status).toBe(200);
    const csp = frame.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/; sandbox allow-scripts$/);
    expect(csp).not.toContain("allow-same-origin");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(frame.headers.get("set-cookie")).toBeNull();
    expect(frame.headers.get("access-control-allow-origin")).toBeNull();
    expect(await frame.text()).toContain("<p>Bonjour</p>");
    expect((await api(`/api/pages/${id}/revoke`, "POST", {})).status).toBe(200);
    expect((await fetch(`${url}${path}`)).status).toBe(404);
    expect((await fetch(`${url}${frameSrc}`, { headers: { "sec-fetch-dest": "iframe" } })).status).toBe(404);
  } finally {
    await fixture.close();
  }
}, 120_000);

it("lot R8 through the real server: rename, the person's edit (secrets out), comments, annotation preview and the public-link switch", async () => {
  const fixture = await launchVerificationServer();
  try {
    const url = fixture.info.url;
    const pages = new PublishedPages(fixture.info.dataDir);
    const made = pages.propose({ botId: "b1", threadId: "t1", title: "Rapport", kind: "markdown", content: "# Titre" });
    if (!made.ok) throw new Error(made.error);
    const id = made.page.id;
    const api = async (path: string, method = "GET", body?: unknown) => {
      const init: RequestInit = body === undefined ? { method } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
      const response = await fetch(`${url}${path}`, init);
      return { status: response.status, body: await response.json() as any };
    };
    expect((await api(`/api/pages/${id}`, "PATCH", { title: "Bilan" })).body.page.title).toBe("Bilan");
    const edited = await api(`/api/pages/${id}/versions`, "POST", { kind: "presentation", content: "# Un\n\nghp_abcdefghijklmnopqrstuvwxyz0123456789\n\n---\n\n# Deux" });
    expect(edited.status).toBe(201);
    const source = await api(`/api/pages/${id}/versions/${edited.body.version}/source`);
    expect(source.body.version.kind).toBe("presentation");
    expect(source.body.content).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    expect((await api(`/api/pages/${id}/comments`, "POST", { text: "Plus court" })).status).toBe(201);
    expect((await api(`/api/pages/${id}/comments`)).body.comments).toHaveLength(1);
    // the annotation preview: the frame runs only the nonce'd annotation script
    const preview = await fetch(`${url}/pages/preview/${id}/${edited.body.version}?annotate=1`);
    const frameSrc = /<iframe src="([^"]+)"/.exec(await preview.text())![1]!.replace(/&amp;/g, "&");
    expect(frameSrc).toContain("&a=1");
    const frame = await fetch(`${url}${frameSrc}`, { headers: { "sec-fetch-dest": "iframe" } });
    expect(frame.headers.get("content-security-policy")).toMatch(/script-src 'nonce-[^']+'/);
    expect(await frame.text()).toContain("sagax-page-annotation");
    // the switch: this computer's owner is its admin
    expect((await api("/api/admin/pages/policy", "PUT", { linkSharing: false })).body).toEqual({ linkSharing: false, readerComments: true });
    expect((await api(`/api/pages/${id}/publish`, "POST", { version: edited.body.version, access: "link", expiresAt: null })).status).toBe(403);
    expect((await api(`/api/pages/${id}/publish`, "POST", { version: edited.body.version, access: "org", expiresAt: null })).status).toBe(200);
  } finally {
    await fixture.close();
  }
}, 120_000);

it("with the UI served (desktop, container), a page's preview and link answer the page, and an unknown page address is a 404, never the app (0.8.11)", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const ui = mkdtempSync(join(tmpdir(), "sagax-pages-ui-"));
  writeFileSync(join(ui, "index.html"), "<!doctype html><title>SAGAX APP SHELL</title>");
  const fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, undefined, [], undefined, ui);
  try {
    const url = fixture.info.url;
    // the UI is served: an app route is the app shell
    expect(await (await fetch(`${url}/settings`)).text()).toContain("SAGAX APP SHELL");
    const pages = new PublishedPages(fixture.info.dataDir);
    const made = pages.propose({ botId: "b1", threadId: "t1", title: "Demo", kind: "html", content: "<!doctype html><p>Contenu de la page</p>" });
    if (!made.ok) throw new Error(made.error);
    const id = made.page.id;
    const readFrame = async (wrapperUrl: string) => {
      const wrapper = await fetch(wrapperUrl);
      expect(wrapper.status).toBe(200);
      const body = await wrapper.text();
      expect(body).not.toContain("SAGAX APP SHELL");
      const src = /<iframe src="([^"]+)"/.exec(body)![1]!.replace(/&amp;/g, "&");
      const frame = await fetch(`${url}${src}`, { headers: { "sec-fetch-dest": "iframe" } });
      expect(frame.status).toBe(200);
      const html = await frame.text();
      expect(html).not.toContain("SAGAX APP SHELL");
      return html;
    };
    // proposed (not published yet): the card's preview address serves the page
    const previewPath: string = (await (await fetch(`${url}/api/pages/${id}/versions/1`)).json() as any).version.previewPath;
    expect(await readFrame(`${url}${previewPath}?bare=1&theme=dark`)).toContain("Contenu de la page");
    // published: the preview and the reading link both serve the page
    const published = await fetch(`${url}/api/pages/${id}/publish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: 1, access: "link", expiresAt: null }) });
    const page = (await published.json() as any).page;
    expect(await readFrame(`${url}${previewPath}`)).toContain("Contenu de la page");
    // Open in browser and Copy link: the page's reading link, on this server, which answers the page
    expect(page.url).toMatch(/^https?:\/\/[^/]+\/pages\/view\/[^/]+$/);
    expect(page.url.endsWith(page.path)).toBe(true);
    expect(await readFrame(`${url}${page.path}`)).toContain("Contenu de la page");
    // an unknown or deleted page, or any other address under /pages: 404, never the app
    for (const path of ["/pages/preview/ZZZZZZZZZZ/1", "/pages/view/nope", "/pages/frame/nope", "/pages/whatever", "/pages", `/pages/preview/${id}/9`]) {
      const answer = await fetch(`${url}${path}`, { headers: { "sec-fetch-dest": "iframe" } });
      expect(answer.status, path).toBe(404);
      expect(await answer.text(), path).not.toContain("SAGAX APP SHELL");
    }
  } finally {
    await fixture.close();
  }
}, 120_000);

it("the desktop on an organization server (bundled UI, net.fetch): a Markdown and an HTML page's frame answer the page, with its style, in the card and the open page (0.8.12: blank white)", async () => {
  const { createRequire } = await import("node:module");
  const bundledUi = createRequire(import.meta.url)("../../electron/bundled-ui.cjs");
  const fixture = await launchVerificationServer();
  try {
    const url = fixture.info.url;
    const pages = new PublishedPages(fixture.info.dataDir);
    const md = pages.propose({ botId: "b1", threadId: "t1", title: "KPI Test (markdown)", kind: "markdown", content: "# KPI Test\n\nTexte **visible** en Markdown." });
    const html = pages.propose({ botId: "b1", threadId: "t1", title: "KPI Test (html)", kind: "html", content: "<!doctype html><body style=\"background:#123456;color:#fff\"><h1 style=\"color:#fc0\">KPI HTML</h1><p>Texte visible en HTML.</p></body>" });
    if (!md.ok || !html.ok) throw new Error("propose");
    // Electron's net.fetch, as the handler's passthrough uses it: a browser-made
    // fetch, so its fetch metadata says "empty" unless the request names a
    // frame destination (which net.fetch accepts with mode "navigate" only)
    const netFetch = async (input: string, init: { headers?: ConstructorParameters<typeof Headers>[0]; method?: string } = {}) => {
      const headers = new Headers(init.headers);
      const dest = headers.get("sec-fetch-dest");
      if (dest === "iframe" && headers.get("sec-fetch-mode") !== "navigate") throw new TypeError("sec-fetch-dest iframe requires sec-fetch-mode navigate");
      if (!dest) headers.set("sec-fetch-dest", "empty");
      return fetch(input, { method: init.method ?? "GET", headers });
    };
    const frames = bundledUi.createPageFrameLoads();
    const handle = bundledUi.createBundledUiHandler({
      origin: () => url,
      staticDir: () => null,
      fetch: netFetch,
      readFile: async () => new Uint8Array(),
      pageFrames: frames,
    });
    // what Chromium hands the protocol handler for a frame's document: no fetch metadata, no referrer
    const navigation = (address: string) => new Request(address, { headers: { accept: "text/html", "upgrade-insecure-requests": "1" } });
    for (const [id, text] of [[md.page.id, "Texte <strong>visible</strong> en Markdown."], [html.page.id, "Texte visible en HTML."]] as const) {
      const previewPath: string = (await (await fetch(`${url}/api/pages/${id}/versions/1`)).json() as any).version.previewPath;
      // the card (light) and the open page (dark), both bare
      for (const look of ["?bare=1&theme=light", "?bare=1&theme=dark"]) {
        const wrapper = await handle(navigation(`${url}${previewPath}${look}`));
        expect(wrapper.status).toBe(200);
        const src = /<iframe src="([^"]+)"/.exec(await wrapper.text())![1]!.replace(/&amp;/g, "&");
        const frameUrl = `${url}${src}`;
        // main noted the subframe navigation (will-frame-navigate) before the request
        expect(frames.expect(frameUrl)).toBe(true);
        const frame = await handle(navigation(frameUrl));
        expect(frame.status, `${id}${look}`).toBe(200);
        expect(frame.headers.get("content-type")).toBe("text/html; charset=utf-8");
        const csp = frame.headers.get("content-security-policy") ?? "";
        // framed by the app, its own inline style applied, still no network and sandboxed
        expect(csp).toContain("frame-ancestors 'self'");
        expect(csp).toContain("style-src 'unsafe-inline'");
        expect(csp).toContain("connect-src 'none'");
        expect(csp).toMatch(/; sandbox( allow-scripts)?$/);
        expect(csp).not.toContain("allow-same-origin");
        const body = await frame.text();
        expect(body).toContain(text);
        if (id === md.page.id) expect(body).toMatch(/<style[^>]*>[^<]*\S[^<]*<\/style>/);
        else expect(body).toContain("background:#123456");
        // the same frame address not loaded as a frame (a top-level load, a fetch): still refused
        expect((await handle(navigation(frameUrl))).status).toBe(404);
      }
    }
  } finally {
    await fixture.close();
  }
}, 120_000);
