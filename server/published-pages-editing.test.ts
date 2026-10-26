// Pages, lot R8 (Grok Bot parity, chat rows 31 to 34): rename, the person's
// own edit as a new version, comments, the annotation mode of the app's
// preview, the Presentation kind, and the organization's switch for public
// links. The isolation rules of #646 hold for every new path.
import { mkdtempSync, rmSync } from "node:fs";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "./harness/http.ts";
import { PublishedPages } from "./published-pages.ts";
import { ANNOTATE_SOURCE, pageDocument, presentationToHtml, splitSlides } from "./published-pages-render.ts";
import type { RequestAuth } from "./request-auth.ts";
import { policyFor } from "./tool-policy.ts";
import {
  createPublishedPageRoutes,
  handlePublishedPagePublic,
  type PageViewer,
  type PublicPageOptions,
  type PublishedPageRouteDeps,
} from "./routes/published-pages.ts";
import { PAGE_LIMITS, pageCsp, pageFrameSandbox, parsePageProposal } from "../shared/published-pages.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

let now = 1_800_000_000_000;
function store(): PublishedPages {
  const dir = mkdtempSync(join(tmpdir(), "sagax-pages-r8-"));
  dirs.push(dir);
  return new PublishedPages(dir, () => now);
}

const HTML = "<!doctype html><html><body><h1>Rapport</h1></body></html>";
function proposed(pages: PublishedPages, ownerId = "pr_alice", kind: "html" | "markdown" | "presentation" = "html", content = HTML) {
  const result = pages.propose({ botId: "bot1", threadId: "t1", title: "Rapport", kind, content, ownerId });
  if (!result.ok) throw new Error(result.error);
  return result.page;
}

type Answer = { status: number; headers: Record<string, unknown>; body: string };
function request(path: string, method = "GET", headers: Record<string, string> = {}) {
  const req = new IncomingMessage(new Socket());
  req.method = method;
  req.url = path;
  req.headers = headers;
  const res = new ServerResponse(req);
  const chunks: Buffer[] = [];
  let resolve!: (value: Answer) => void;
  const done = new Promise<Answer>((r) => { resolve = r; });
  res.write = ((chunk: unknown) => { if (chunk) chunks.push(Buffer.from(chunk as string)); return true; }) as typeof res.write;
  res.end = ((chunk?: unknown) => {
    if (chunk) chunks.push(Buffer.from(chunk as string));
    resolve({ status: res.statusCode, headers: res.getHeaders(), body: Buffer.concat(chunks).toString("utf8") });
    return res;
  }) as typeof res.end;
  return { req, res, done };
}

function options(pages: PublishedPages, viewer: PageViewer): PublicPageOptions {
  return { pages, viewer: () => viewer, names: () => ({ botName: "Scout", personName: "Alice" }), separate: null };
}

async function hit(opts: PublicPageOptions, url: string, headers: Record<string, string> = {}, method = "GET", body?: string): Promise<Answer> {
  const path = new URL(url, "http://x").pathname;
  const { req, res, done } = request(url, method, { host: "sagax.example.com", "accept-language": "fr-CA", ...headers });
  process.nextTick(() => {
    if (body !== undefined) req.push(body);
    req.push(null);
  });
  expect(handlePublishedPagePublic(opts, req, res, path, method)).toBe(true);
  return done;
}

function frameSrc(wrapper: string): string {
  const src = /<iframe src="([^"]+)"/.exec(wrapper)?.[1];
  if (!src) throw new Error("no frame in the wrapper");
  return src.replace(/&amp;/g, "&");
}

const session = (principalId?: string): RequestAuth => ({
  kind: "session",
  via: "cookie",
  scopes: ["client"],
  session: { id: "s1", ...(principalId ? { principalId } : {}) } as never,
});

function routes(pages: PublishedPages, extra: Partial<PublishedPageRouteDeps> = {}) {
  return createPublishedPageRoutes({
    pages,
    owner: (auth) => auth.kind === "session" ? auth.session.principalId : undefined,
    isPerson: (auth) => auth.kind === "session" && Boolean(auth.session.principalId),
    origin: () => "https://sagax.example.com",
    reachable: () => true,
    now: () => now,
    ...extra,
  });
}

async function call(handler: ReturnType<typeof routes>, auth: RequestAuth, method: string, path: string, body?: unknown) {
  const { req, res, done } = request(path, method, { "content-type": "application/json" });
  process.nextTick(() => {
    if (body !== undefined) req.push(JSON.stringify(body));
    req.push(null);
  });
  await handler({ req, res, url: new URL(`http://x${path}`), path, method, auth, json, readBody });
  const answer = await done;
  return { status: answer.status, body: answer.body ? JSON.parse(answer.body) as Record<string, any> : null };
}

const alice = session("pr_alice");
const bob = session("pr_bob");

describe("rename (« Renommer la page »)", () => {
  it("its person renames a page in any state; the summary, the banner title and history follow", async () => {
    const pages = store();
    const page = proposed(pages);
    const handler = routes(pages);
    const renamed = await call(handler, alice, "PATCH", `/api/pages/${page.id}`, { title: "  Bilan   du mois " });
    expect(renamed.status).toBe(200);
    expect(renamed.body!.page.title).toBe("Bilan du mois");
    expect(pages.get(page.id)!.history.at(-1)).toMatchObject({ action: "rename", by: "pr_alice" });
    // the wrapper's <title> reads the new name
    const viewer: PageViewer = { principalId: "pr_alice", computerOwner: false };
    const wrapper = await hit(options(pages, viewer), `/pages/preview/${page.id}/1`);
    expect(wrapper.body).toContain("<title>Bilan du mois</title>");
  });

  it("another person gets 404; an empty or too long title is refused", async () => {
    const pages = store();
    const page = proposed(pages);
    const handler = routes(pages);
    expect((await call(handler, bob, "PATCH", `/api/pages/${page.id}`, { title: "Pris" })).status).toBe(404);
    expect((await call(handler, alice, "PATCH", `/api/pages/${page.id}`, { title: "   " })).status).toBe(400);
    expect((await call(handler, alice, "PATCH", `/api/pages/${page.id}`, { title: "x".repeat(PAGE_LIMITS.title + 1) })).status).toBe(400);
    expect(pages.get(page.id)!.title).toBeUndefined();
  });

  it("access and expiry still need a published page, a rename alone does not", async () => {
    const pages = store();
    const page = proposed(pages);
    const handler = routes(pages);
    expect((await call(handler, alice, "PATCH", `/api/pages/${page.id}`, { access: "link" })).status).toBe(409);
    expect((await call(handler, alice, "PATCH", `/api/pages/${page.id}`, { title: "Nouveau" })).status).toBe(200);
  });
});

describe("the person's own edit (« page complète éditable »)", () => {
  it("reads the source of a version, then saves an edit as a new version that waits for Publish", async () => {
    const pages = store();
    const page = proposed(pages);
    const handler = routes(pages, { redact: (text) => text.replace(/sk-[A-Za-z0-9]{10,}/g, "[secret]") });
    const source = await call(handler, alice, "GET", `/api/pages/${page.id}/versions/1/source`);
    expect(source.status).toBe(200);
    expect(source.body).toMatchObject({ version: { n: 1, kind: "html", title: "Rapport" }, content: HTML });
    const saved = await call(handler, alice, "POST", `/api/pages/${page.id}/versions`, { kind: "html", content: "<h1>Corrigé sk-abcdefghijklmnop</h1>", from: 1 });
    expect(saved.status).toBe(201);
    expect(saved.body!.version).toBe(2);
    const record = pages.get(page.id)!;
    expect(record.versions[1]).toMatchObject({ n: 2, state: "proposed", author: "person", title: "Rapport" });
    expect(record.status).toBe("draft");
    // secret-shaped text never reaches a page that may be published
    expect(pages.content(page.id, 2)).toBe("<h1>Corrigé [secret]</h1>");
    expect(record.history.at(-1)).toMatchObject({ action: "edit", version: 2, by: "pr_alice" });
  });

  it("nobody else reads the source or saves an edit; kind and size are checked", async () => {
    const pages = store();
    const page = proposed(pages);
    const handler = routes(pages);
    expect((await call(handler, bob, "GET", `/api/pages/${page.id}/versions/1/source`)).status).toBe(404);
    expect((await call(handler, bob, "POST", `/api/pages/${page.id}/versions`, { kind: "html", content: "x" })).status).toBe(404);
    expect((await call(handler, session(), "POST", `/api/pages/${page.id}/versions`, { kind: "html", content: "x" })).status).toBe(403);
    expect((await call(handler, alice, "POST", `/api/pages/${page.id}/versions`, { kind: "pdf", content: "x" })).status).toBe(400);
    expect((await call(handler, alice, "POST", `/api/pages/${page.id}/versions`, { kind: "html", content: "  " })).status).toBe(400);
    expect((await call(handler, alice, "POST", `/api/pages/${page.id}/versions`, { kind: "html", content: "x".repeat(PAGE_LIMITS.contentBytes + 1) })).status).toBe(400);
    expect(pages.get(page.id)!.versions).toHaveLength(1);
  });

  it("a published page keeps serving its version until the edit is published", async () => {
    const pages = store();
    const page = proposed(pages);
    pages.publish(page.id, { version: 1, access: "link", expiresAt: null });
    const handler = routes(pages);
    await call(handler, alice, "POST", `/api/pages/${page.id}/versions`, { kind: "html", content: "<h1>v2</h1>" });
    expect(pages.get(page.id)!.currentVersion).toBe(1);
    const published = await call(handler, alice, "POST", `/api/pages/${page.id}/publish`, { version: 2, access: "link", expiresAt: null });
    expect(published.body!.page.currentVersion).toBe(2);
  });
});

describe("comments (« Ajouter un commentaire »)", () => {
  it("its person adds, lists and deletes comments, optionally on a version and an element", async () => {
    const pages = store();
    const page = proposed(pages);
    const handler = routes(pages);
    const added = await call(handler, alice, "POST", `/api/pages/${page.id}/comments`, { text: "  Le titre est trop long  ", version: 1, anchor: { tag: "h1", text: "Rapport", path: "body > h1" } });
    expect(added.status).toBe(201);
    expect(added.body!.comment).toMatchObject({ text: "Le titre est trop long", version: 1, anchor: { tag: "h1", text: "Rapport", path: "body > h1" } });
    const listed = await call(handler, alice, "GET", `/api/pages/${page.id}/comments`);
    expect(listed.body!.comments).toHaveLength(1);
    const id = listed.body!.comments[0].id as string;
    expect((await call(handler, bob, "GET", `/api/pages/${page.id}/comments`)).status).toBe(404);
    expect((await call(handler, bob, "DELETE", `/api/pages/${page.id}/comments/${id}`)).status).toBe(404);
    expect((await call(handler, alice, "DELETE", `/api/pages/${page.id}/comments/${id}`)).status).toBe(200);
    expect((await call(handler, alice, "GET", `/api/pages/${page.id}/comments`)).body!.comments).toEqual([]);
  });

  it("refuses an empty or oversized comment and caps the count", async () => {
    const pages = store();
    const page = proposed(pages);
    const handler = routes(pages);
    expect((await call(handler, alice, "POST", `/api/pages/${page.id}/comments`, { text: "" })).status).toBe(400);
    expect((await call(handler, alice, "POST", `/api/pages/${page.id}/comments`, { text: "x".repeat(PAGE_LIMITS.commentChars + 1) })).status).toBe(400);
    for (let index = 0; index < PAGE_LIMITS.comments; index += 1) pages.addComment(page.id, { text: `c${index}` });
    expect((await call(handler, alice, "POST", `/api/pages/${page.id}/comments`, { text: "one too many" })).status).toBe(409);
  });

  it("comments are never served to readers", async () => {
    const pages = store();
    const page = proposed(pages);
    pages.addComment(page.id, { text: "note privée de relecture" });
    pages.publish(page.id, { version: 1, access: "link", expiresAt: null });
    const path = pages.path(pages.get(page.id)!.linkId!);
    const wrapper = await hit(options(pages, null), path);
    const frame = await hit(options(pages, null), frameSrc(wrapper.body), { "sec-fetch-dest": "iframe" });
    expect(wrapper.body + frame.body).not.toContain("note privée");
    expect(JSON.stringify(pages.summary(pages.get(page.id)!, "https://x", true))).not.toContain("note privée");
  });
});

describe("annotation mode of the app's preview (« Annoter la page »)", () => {
  it("only the page's person gets the annotation script, on the preview, never on a reader's link", async () => {
    const pages = store();
    const page = proposed(pages);
    const viewer: PageViewer = { principalId: "pr_alice", computerOwner: false };
    const wrapper = await hit(options(pages, viewer), `/pages/preview/${page.id}/1?annotate=1`);
    expect(wrapper.status).toBe(200);
    expect(wrapper.body).not.toContain("<script");
    const src = frameSrc(wrapper.body);
    expect(src).toMatch(/[?&]a=1(&|$)/);
    const frame = await hit(options(pages, viewer), src, { "sec-fetch-dest": "iframe" });
    expect(frame.status).toBe(200);
    expect(frame.body).toContain(ANNOTATE_SOURCE);
    // a reader's link never annotates, whatever the query says
    pages.publish(page.id, { version: 1, access: "link", expiresAt: null });
    const path = pages.path(pages.get(page.id)!.linkId!);
    const reader = await hit(options(pages, null), `${path}?annotate=1`);
    const readerFrame = await hit(options(pages, null), `${frameSrc(reader.body)}&a=1`, { "sec-fetch-dest": "iframe" });
    expect(readerFrame.body).not.toContain(ANNOTATE_SOURCE);
    // without the flag, the preview has no annotation script either
    const plain = await hit(options(pages, viewer), `/pages/preview/${page.id}/1`);
    expect((await hit(options(pages, viewer), frameSrc(plain.body), { "sec-fetch-dest": "iframe" })).body).not.toContain(ANNOTATE_SOURCE);
  });

  it("a Markdown page in annotation mode runs only the nonce'd annotation script", async () => {
    const pages = store();
    const page = proposed(pages, "pr_alice", "markdown", "# Titre\n\n<script>alert(1)</script>");
    const viewer: PageViewer = { principalId: "pr_alice", computerOwner: false };
    const wrapper = await hit(options(pages, viewer), `/pages/preview/${page.id}/1?annotate=1`);
    expect(wrapper.body).toMatch(/sandbox="allow-scripts"/);
    const frame = await hit(options(pages, viewer), frameSrc(wrapper.body), { "sec-fetch-dest": "iframe" });
    const csp = String(frame.headers["content-security-policy"]);
    const nonce = /script-src 'nonce-([A-Za-z0-9+/=_-]+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(csp).not.toContain("script-src 'unsafe-inline'");
    expect(csp).not.toContain("script-src 'none'");
    expect(csp).toMatch(/; sandbox allow-scripts$/);
    expect(frame.body).toContain(`<script nonce="${nonce}">`);
    expect(frame.body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    for (const flag of ["allow-same-origin", "allow-top-navigation", "allow-popups", "allow-modals", "allow-forms"]) expect(csp).not.toContain(flag);
  });

  it("the annotation script only posts to the app's window, never fetches", () => {
    expect(ANNOTATE_SOURCE).toContain("sagax-page-annotation");
    expect(ANNOTATE_SOURCE).toContain("window.top.postMessage");
    expect(ANNOTATE_SOURCE).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|location\s*=|\.src\s*=/);
  });
});

describe("Presentation kind (« Présentation »)", () => {
  it("a bot may propose a presentation: Markdown slides separated by ---", () => {
    expect(parsePageProposal({ title: "Bilan", kind: "presentation", content: "# Un\n\n---\n\n# Deux" })).toMatchObject({ ok: true, value: { kind: "presentation" } });
    expect(splitSlides("# Un\n\n---\n\n# Deux\n---\n\n")).toEqual(["# Un", "# Deux"]);
    expect(splitSlides("")).toEqual([""]);
  });

  it("renders one escaped section per slide with its number and in-page navigation, no script", () => {
    const html = presentationToHtml("# Un\n\n<script>x</script>\n\n---\n\n# Deux");
    expect(html.match(/<section class="slide"/g)).toHaveLength(2);
    expect(html).toContain("id=\"slide-1\"");
    expect(html).toContain("href=\"#slide-2\"");
    expect(html).toContain("1 / 2");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    const doc = pageDocument({ kind: "presentation", title: "Bilan", content: "# Un\n\n---\n\n# Deux" });
    expect(doc).not.toContain("<script");
    expect(doc).toContain("scroll-snap-type");
    expect(pageCsp("presentation")).toContain("script-src 'none'");
    expect(pageFrameSandbox("presentation")).toBe("");
  });
});

describe("the organization's switch for public links", () => {
  it("on by default; an admin turns it off (audited), then nobody publishes or switches a page to a link", async () => {
    const pages = store();
    const page = proposed(pages);
    const rows: unknown[] = [];
    const handler = routes(pages, { isAdmin: (auth) => auth.kind === "session" && auth.session.principalId === "pr_admin", audit: (_auth, _req, row) => rows.push(row) });
    expect((await call(handler, alice, "GET", "/api/pages/policy")).body).toEqual({ linkSharing: true, readerComments: true });
    expect((await call(handler, alice, "PUT", "/api/admin/pages/policy", { linkSharing: false })).status).toBe(403);
    const off = await call(handler, session("pr_admin"), "PUT", "/api/admin/pages/policy", { linkSharing: false });
    expect(off.status).toBe(200);
    expect(off.body).toEqual({ linkSharing: false, readerComments: true });
    expect(rows).toEqual([{ action: "page.policy", target: { kind: "pages", id: "linkSharing", name: "off" } }]);
    expect((await call(handler, alice, "GET", "/api/pages/policy")).body).toEqual({ linkSharing: false, readerComments: true });
    const refused = await call(handler, alice, "POST", `/api/pages/${page.id}/publish`, { version: 1, access: "link", expiresAt: null });
    expect(refused.status).toBe(403);
    expect(refused.body!.code).toBe("link_sharing_off");
    expect((await call(handler, alice, "POST", `/api/pages/${page.id}/publish`, { version: 1, access: "org", expiresAt: null })).status).toBe(200);
    expect((await call(handler, alice, "PATCH", `/api/pages/${page.id}`, { access: "link" })).status).toBe(403);
    expect((await call(handler, session("pr_admin"), "PUT", "/api/admin/pages/policy", { linkSharing: "no" })).status).toBe(400);
  });

  it("while off, a page already shared by link reads only for people signed in to the server", async () => {
    const pages = store();
    const page = proposed(pages);
    pages.publish(page.id, { version: 1, access: "link", expiresAt: null });
    const path = pages.path(pages.get(page.id)!.linkId!);
    expect((await hit(options(pages, null), path)).status).toBe(200);
    pages.setPolicy({ linkSharing: false });
    expect((await hit(options(pages, null), path)).status).toBe(404);
    expect((await hit(options(pages, { principalId: "pr_bob", computerOwner: false }), path)).status).toBe(200);
    // turning it back on serves the same link again, never a new one
    pages.setPolicy({ linkSharing: true });
    expect((await hit(options(pages, null), path)).status).toBe(200);
  });

  it("the policy survives a page save and a restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-pages-r8-"));
    dirs.push(dir);
    const first = new PublishedPages(dir, () => now);
    first.setPolicy({ linkSharing: false });
    const result = first.propose({ botId: "bot1", threadId: "t1", title: "R", kind: "html", content: HTML, ownerId: "pr_alice" });
    expect(result.ok).toBe(true);
    expect(new PublishedPages(dir, () => now).policy()).toEqual({ linkSharing: false, readerComments: true });
  });
});

describe("review of #952: tool policy rows (F1)", () => {
  it("the editor's and comments' routes are off by default; writes are writes, deletes are admin", () => {
    const read = policyFor("GET", "/api/pages/abcdefgh1234/versions/1/source");
    expect(read).toMatchObject({ matched: true, readOnly: true, defaultEnabled: false });
    expect(policyFor("GET", "/api/pages/abcdefgh1234/comments")).toMatchObject({ matched: true, defaultEnabled: false });
    for (const [method, path] of [["POST", "/api/pages/abcdefgh1234/versions"], ["POST", "/api/pages/abcdefgh1234/comments"]] as const) {
      expect(policyFor(method, path), `${method} ${path}`).toMatchObject({ matched: true, readOnly: false, tier: "write", defaultEnabled: false });
    }
    expect(policyFor("DELETE", "/api/pages/abcdefgh1234/comments/c1")).toMatchObject({ matched: true, readOnly: false, defaultEnabled: false });
    for (const [method, path] of [["GET", "/api/pages/abcdefgh1234/reader-comments"], ["POST", "/api/pages/abcdefgh1234/reader-comments/c1/approve"], ["DELETE", "/api/pages/abcdefgh1234/reader-comments/c1"]] as const) {
      expect(policyFor(method, path), `${method} ${path}`).toMatchObject({ matched: true, defaultEnabled: false });
    }
  });
});

describe("review of #952: PATCH checks everything before renaming (F2)", () => {
  it("a bad access, an unpublished page or a closed link switch leaves the title as it was", async () => {
    const pages = store();
    const page = proposed(pages);
    const handler = routes(pages);
    expect((await call(handler, alice, "PATCH", `/api/pages/${page.id}`, { title: "Nouveau", access: "everyone" })).status).toBe(400);
    expect((await call(handler, alice, "PATCH", `/api/pages/${page.id}`, { title: "Nouveau", expiresAt: now - 1 })).status).toBe(400);
    expect((await call(handler, alice, "PATCH", `/api/pages/${page.id}`, { title: "Nouveau", access: "org" })).status).toBe(409);
    pages.publish(page.id, { version: 1, access: "org", expiresAt: null });
    pages.setPolicy({ linkSharing: false });
    expect((await call(handler, alice, "PATCH", `/api/pages/${page.id}`, { title: "Nouveau", access: "link" })).status).toBe(403);
    expect(pages.get(page.id)!.title).toBeUndefined();
    const both = await call(handler, alice, "PATCH", `/api/pages/${page.id}`, { title: "Nouveau", access: "private" });
    expect(both.status).toBe(200);
    expect(both.body!.page).toMatchObject({ title: "Nouveau", access: "private" });
  });
});

describe("review of #952: annotation anchors in comments (F3)", () => {
  it("redacts secret-shaped text in the anchor's path as well as its text", async () => {
    const pages = store();
    const page = proposed(pages);
    const handler = routes(pages, { redact: (text) => text.replace(/sk-[A-Za-z0-9]{10,}/g, "[secret]") });
    const added = await call(handler, alice, "POST", `/api/pages/${page.id}/comments`, { text: "x", anchor: { tag: "p", text: "sk-abcdefghijklmnop", path: "body > p.sk-abcdefghijklmnop" } });
    expect(added.body!.comment.anchor).toEqual({ tag: "p", text: "[secret]", path: "body > p.[secret]" });
  });
});

describe("reader comments on a published page (JC 2026-10-21)", () => {
  const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString();
  const formHeaders = { "content-type": "application/x-www-form-urlencoded" };
  function shared(pages: PublishedPages, access: "link" | "org" | "private" = "link") {
    const page = proposed(pages);
    pages.publish(page.id, { version: 1, access, expiresAt: null });
    const token = pages.path(pages.get(page.id)!.linkId!).slice("/pages/view/".length);
    return { id: page.id, token };
  }

  it("off by default: no form in the wrapper, form-action stays 'none', a post is a 404", async () => {
    const pages = store();
    const { token } = shared(pages);
    const wrapper = await hit(options(pages, null), `/pages/view/${token}`);
    expect(wrapper.body).not.toContain("<form");
    expect(String(wrapper.headers["content-security-policy"])).toContain("form-action 'none'");
    const posted = await hit(options(pages, null), `/pages/comment/${token}`, formHeaders, "POST", form({ name: "Bob", text: "Bravo" }));
    expect(posted.status).toBe(404);
  });

  it("its person turns them on; the wrapper gets a script-free form pinned by CSP to this page's comment path", async () => {
    const pages = store();
    const { id, token } = shared(pages);
    const handler = routes(pages);
    const on = await call(handler, alice, "PATCH", `/api/pages/${id}`, { readerComments: true });
    expect(on.status).toBe(200);
    expect(on.body!.page.readerComments).toBe(true);
    expect((await call(handler, bob, "PATCH", `/api/pages/${id}`, { readerComments: true })).status).toBe(404);
    const wrapper = await hit(options(pages, null), `/pages/view/${token}`);
    expect(wrapper.body).toContain(`<form method="post" action="/pages/comment/${token}"`);
    expect(wrapper.body).not.toContain("<script");
    const csp = String(wrapper.headers["content-security-policy"]);
    expect(csp).toContain("script-src 'none'");
    expect(csp).toContain(`form-action sagax.example.com/pages/comment/${token}`);
    // the honeypot is in the form
    expect(wrapper.body).toContain('name="website"');
  });

  it("a reader's comment waits for approval, redacted and size-checked; approved ones show escaped", async () => {
    const pages = store();
    const { id, token } = shared(pages);
    pages.setReaderComments(id, true);
    const handler = routes(pages);
    const posted = await hit(options(pages, null), `/pages/comment/${token}`, formHeaders, "POST", form({ name: "Bob <b>", text: "Super page, ghp_abcdefghijklmnopqrstuvwxyz0123456789 <script>x</script>" }));
    expect(posted.status).toBe(200);
    expect(posted.body).toContain("approbation");
    expect(String(posted.headers["content-security-policy"])).toContain("default-src 'none'");
    let wrapper = await hit(options(pages, null), `/pages/view/${token}`);
    expect(wrapper.body).not.toContain("Super page");
    const listed = await call(handler, alice, "GET", `/api/pages/${id}/reader-comments`);
    expect(listed.body!.comments).toHaveLength(1);
    const comment = listed.body!.comments[0];
    expect(comment).toMatchObject({ status: "pending", name: "Bob <b>" });
    expect(comment.text).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    expect((await call(handler, bob, "GET", `/api/pages/${id}/reader-comments`)).status).toBe(404);
    expect((await call(handler, alice, "POST", `/api/pages/${id}/reader-comments/${comment.id}/approve`, {})).status).toBe(200);
    wrapper = await hit(options(pages, null), `/pages/view/${token}`);
    expect(wrapper.body).toContain("Super page");
    expect(wrapper.body).toContain("Bob &lt;b&gt;");
    expect(wrapper.body).toContain("&lt;script&gt;");
    expect(pages.get(id)!.history.map((entry) => entry.action)).toEqual(expect.arrayContaining(["reader-comments", "reader-comment", "reader-comment-approve"]));
    expect((await call(handler, alice, "DELETE", `/api/pages/${id}/reader-comments/${comment.id}`)).status).toBe(200);
    wrapper = await hit(options(pages, null), `/pages/view/${token}`);
    expect(wrapper.body).not.toContain("Super page");
    for (const bad of [form({ name: "Bob", text: "" }), form({ name: "Bob", text: "x".repeat(PAGE_LIMITS.readerCommentChars + 1) }), form({ name: "", text: "ok" }), form({ name: "x".repeat(PAGE_LIMITS.readerNameChars + 1), text: "ok" })]) {
      expect((await hit(options(pages, null), `/pages/comment/${token}`, formHeaders, "POST", bad)).status).toBe(400);
    }
  });

  it("a filled honeypot is thanked and dropped; a burst from one address is rate-limited", async () => {
    const pages = store();
    const { id, token } = shared(pages);
    pages.setReaderComments(id, true);
    const trap = await hit(options(pages, null), `/pages/comment/${token}`, formHeaders, "POST", form({ name: "Bot", text: "spam", website: "http://spam.example" }));
    expect(trap.status).toBe(200);
    expect(pages.readerComments(id)).toHaveLength(0);
    const statuses: number[] = [];
    for (let index = 0; index < PAGE_LIMITS.readerCommentsPerWindow + 1; index += 1) {
      statuses.push((await hit(options(pages, null), `/pages/comment/${token}`, formHeaders, "POST", form({ name: "Bob", text: `c${index}` }))).status);
    }
    expect(statuses.slice(0, -1).every((status) => status === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  it("only a reader of the page, from this page's own origin, while it is published", async () => {
    const pages = store();
    const { id, token } = shared(pages, "org");
    pages.setReaderComments(id, true);
    expect((await hit(options(pages, null), `/pages/comment/${token}`, formHeaders, "POST", form({ name: "Bob", text: "x" }))).status).toBe(404);
    const reader: PageViewer = { principalId: "pr_bob", computerOwner: false };
    expect((await hit(options(pages, reader), `/pages/comment/${token}`, { ...formHeaders, origin: "https://evil.example" }, "POST", form({ name: "Bob", text: "x" }))).status).toBe(403);
    // a browser that says the post comes from another site is refused, Origin or not
    expect((await hit(options(pages, reader), `/pages/comment/${token}`, { ...formHeaders, "sec-fetch-site": "cross-site" }, "POST", form({ name: "Bob", text: "x" }))).status).toBe(403);
    expect((await hit(options(pages, reader), `/pages/comment/${token}`, { ...formHeaders, origin: "http://sagax.example.com" }, "POST", form({ name: "Bob", text: "x" }))).status).toBe(200);
    pages.revoke(id);
    expect((await hit(options(pages, reader), `/pages/comment/${token}`, formHeaders, "POST", form({ name: "Bob", text: "x" }))).status).toBe(404);
  });

  it("an admin can forbid them: the person cannot turn them on, and pages that had them stop taking and showing them", async () => {
    const pages = store();
    const { id, token } = shared(pages);
    pages.setReaderComments(id, true);
    const rows: unknown[] = [];
    const handler = routes(pages, { isAdmin: (auth) => auth.kind === "session" && auth.session.principalId === "pr_admin", audit: (_auth, _req, row) => rows.push(row) });
    const off = await call(handler, session("pr_admin"), "PUT", "/api/admin/pages/policy", { readerComments: false });
    expect(off.body).toEqual({ linkSharing: true, readerComments: false });
    expect(rows).toEqual([{ action: "page.policy", target: { kind: "pages", id: "readerComments", name: "off" } }]);
    expect((await call(handler, alice, "PATCH", `/api/pages/${id}`, { readerComments: true })).status).toBe(403);
    expect((await hit(options(pages, null), `/pages/view/${token}`)).body).not.toContain("<form");
    expect((await hit(options(pages, null), `/pages/comment/${token}`, formHeaders, "POST", form({ name: "Bob", text: "x" }))).status).toBe(404);
  });
});
