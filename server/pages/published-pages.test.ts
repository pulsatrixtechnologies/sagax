// Published pages (server/pages/published-pages.ts, server/routes/published-pages.ts,
// server/pages/published-pages-render.ts): approval before anything is served,
// ownership by the conversation's person, the wrapper and its sandboxed
// frame, each access level, revocation, expiry, versions, caps and storage,
// the separate pages origin, and a person's own pages only.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAgentCard, type AgentCardStore } from "../chat-widgets.ts";
import { json, readBody } from "../harness/http.ts";
import { pageOwnerFor, PublishedPages } from "./published-pages.ts";
import { PageLive } from "./page-live.ts";
import { bannerName, escapeHtml, FRAME_PRELUDE, jsonBlock, markdownToHtml, OPEN_BRIDGE_SOURCE, pageDocument, parseReaderAssets, REPORT_SIZE_SOURCE, SLIDE_PRINT_MM, STATE_BRIDGE_SOURCE, WRAPPER_OPEN_SOURCE, wrapperBanner, ANNOTATE_BRIDGE_SOURCE } from "./published-pages-render.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import {
  createPublishedPageRoutes,
  handlePagesOriginRequest,
  handlePublishedPagePublic,
  pageReadable,
  type PageViewer,
  type PublicPageOptions,
} from "../routes/published-pages.ts";
import type { Message } from "../store.ts";
import { encodeSkinTokens, PAGE_THEME_LAYER, PAGE_THEME_STYLE_ID } from "../../src/lib/page-theme.ts";
import { PAGE_LIMITS, PAGE_OPEN_MESSAGE, pageCsp, pageFrameSandbox, parsePageProposal, validExpiry } from "../../shared/published-pages.ts";
import { parseReaderBoot, READER_BOOT_ID, READER_MASCOT_ID, readerNotice } from "../../shared/page-reader.ts";
import { holdContrast } from "../../src/lib/bot-accent-colors.ts";
import { fallbackWidgetTokens } from "../../src/lib/widget-kit.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

let now = 1_800_000_000_000;
function store(): { pages: PublishedPages; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "sagax-pages-"));
  dirs.push(dir);
  return { pages: new PublishedPages(dir, () => now), dir };
}

const HTML = "<!doctype html><html><body><h1>Rapport</h1><script>document.title='x'</script></body></html>";
const OWNER: PageViewer = { computerOwner: true };

function proposed(pages: PublishedPages, ownerId?: string, extra: { botId?: string; content?: string } = {}) {
  const result = pages.propose({ botId: extra.botId ?? "bot1", threadId: "t1", title: "Rapport", kind: "html", content: extra.content ?? HTML, ...(ownerId ? { ownerId } : {}) });
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe("unreadable published-page registries", () => {
  it.each(["{truncated", "null", '{"version":2,"pages":{}}', '{"version":2,"pages":[{"id":"bad"}]}'])("keeps a broken index intact and recovers after repair: %s", (broken) => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { pages, dir } = store();
      pages.setPolicy({ linkSharing: false });
      const { page } = proposed(pages);
      const file = join(dir, "published-pages.json");
      const saved = readFileSync(file, "utf8");
      writeFileSync(file, broken);
      expect(() => proposed(pages)).toThrow(/Repair published-pages.json/);
      expect(() => pages.setPolicy({ linkSharing: true })).toThrow(/Repair published-pages.json/);
      expect(() => pages.remove(page.id)).toThrow(/Repair published-pages.json/);
      expect(readFileSync(file, "utf8")).toBe(broken);
      expect(logged).toHaveBeenCalledTimes(1);
      expect(logged.mock.calls.flat().join(" ")).not.toContain(broken);
      writeFileSync(file, saved);
      expect(pages.get(page.id)?.id).toBe(page.id);
      expect(pages.policy().linkSharing).toBe(false);
      expect(proposed(pages).page.id).not.toBe(page.id);
    } finally { logged.mockRestore(); }
  });

  it("refuses a read error instead of treating the index as missing", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { pages, dir } = store();
      const file = join(dir, "published-pages.json");
      mkdirSync(file);
      expect(() => proposed(pages)).toThrow(/Repair published-pages.json/);
      expect(statSync(file).isDirectory()).toBe(true);
    } finally { logged.mockRestore(); }
  });

  it.each(["{truncated", "null", '{"version":1,"looks":[]}'])("does not overwrite unreadable looks and retries after repair: %s", (broken) => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { pages, dir } = store();
      const file = join(dir, "published-pages-looks.json");
      const look = { light: { "--color-panel": "#ffffff" } };
      writeFileSync(file, broken);
      expect(() => pages.setLook("pr_alice", look)).toThrow(/Repair published-pages-looks.json/);
      expect(readFileSync(file, "utf8")).toBe(broken);
      writeFileSync(file, '{"version":1,"looks":{}}');
      expect(pages.setLook("pr_alice", look)).toMatchObject(look);
    } finally { logged.mockRestore(); }
  });
});

type Answer = { status: number; headers: Record<string, unknown>; body: string };
function request(path: string, method = "GET", headers: Record<string, string> = {}): { req: IncomingMessage; res: ServerResponse; done: Promise<Answer> } {
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

function options(pages: PublishedPages, viewer: PageViewer, separate: PublicPageOptions["separate"] = null): PublicPageOptions {
  return { pages, viewer: () => viewer, names: () => ({ botName: "Scout", personName: "Alice" }), separate };
}

async function hit(opts: PublicPageOptions, url: string, headers: Record<string, string> = {}, method = "GET"): Promise<Answer> {
  const path = new URL(url, "http://x").pathname;
  const { req, res, done } = request(url, method, { host: "sagax.example.com", "accept-language": "fr-CA", ...headers });
  const answered = handlePagesOriginRequest(opts, req, res, path, method) || handlePublishedPagePublic(opts, req, res, path, method);
  expect(answered).toBe(true);
  return done;
}

function frameSrc(wrapper: string): string {
  const src = /<iframe src="([^"]+)"/.exec(wrapper)?.[1];
  if (!src) throw new Error("no frame in the wrapper");
  return src.replace(/&amp;/g, "&");
}

/** The wrapper, then the frame it embeds, as a browser would load them. */
async function read(pages: PublishedPages, path: string, viewer: PageViewer): Promise<{ wrapper: Answer; frame?: Answer }> {
  const wrapper = await hit(options(pages, viewer), path);
  if (wrapper.status !== 200) return { wrapper };
  return { wrapper, frame: await hit(options(pages, viewer), frameSrc(wrapper.body), { "sec-fetch-dest": "iframe" }) };
}

const session = (principalId?: string): RequestAuth => ({
  kind: "session",
  via: "cookie",
  scopes: ["client"],
  session: { id: "s1", ...(principalId ? { principalId } : {}) } as never,
});
const serviceLoopback: RequestAuth = { kind: "loopback", scopes: ["client"], trust: "service" };

/** organization: the person is the session's principal; a one-person
 * server: only the computer's owner (here, a session without principal). */
function routes(pages: PublishedPages, organization = true) {
  return createPublishedPageRoutes({
    pages,
    owner: (auth) => organization && auth.kind === "session" ? auth.session.principalId : undefined,
    isPerson: (auth) => organization
      ? auth.kind === "session" && Boolean(auth.session.principalId)
      : auth.kind === "session" ? !auth.session.principalId : auth.trust !== "service",
    origin: () => "https://sagax.example.com",
    reachable: () => true,
    now: () => now,
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

function published(pages: PublishedPages, access: "private" | "org" | "link" = "link", ownerId?: string) {
  const { page } = proposed(pages, ownerId);
  pages.publish(page.id, { version: 1, access, expiresAt: null });
  return { id: page.id, path: pages.path(pages.get(page.id)!.linkId!) };
}

describe("approval before anything is served", () => {
  it("a proposal is stored as a draft with no reading link; nothing serves it", () => {
    const { pages, dir } = store();
    const { page, version } = proposed(pages);
    expect(page.status).toBe("draft");
    expect(version.state).toBe("proposed");
    expect(page.linkId).toBeUndefined();
    expect(pages.summary(page, "https://x", true).url).toBeUndefined();
    if (process.platform !== "win32") {
      expect(statSync(join(dir, "published-pages.key")).mode & 0o777).toBe(0o600);
      expect(statSync(join(dir, "published-pages.json")).mode & 0o777).toBe(0o600);
      expect(statSync(join(dir, "published-pages", page.id, "1")).mode & 0o777).toBe(0o600);
    }
  });

  it("the bot's card route writes a proposal row and never publishes", () => {
    const { pages } = store();
    const messages: Message[] = [];
    const cardStore: AgentCardStore = {
      groupByThread: () => null,
      messagesFor: () => messages,
      appendMessage: (_threadId, message) => {
        const full = { ...message, id: `m${messages.length + 1}`, at: now } as Message;
        messages.push(full);
        return full;
      },
      patchMessage: () => null,
    };
    const result = createAgentCard({
      store: cardStore,
      bot: { id: "bot1", name: "Scout", color: "blue" as never },
      threadId: "t1",
      input: { tool: "propose_page", title: "Rapport", kind: "html", content: HTML, access: "link", publish: true },
      proposePage: (input) => {
        const made = pages.propose({ ...input, botId: "bot1", threadId: "t1" });
        return made.ok ? { ok: true, pageId: made.page.id, version: made.version.n } : made;
      },
    });
    expect(result.ok).toBe(true);
    const row = messages[0]!;
    expect(row.pagePublish).toMatchObject({ version: 1, title: "Rapport" });
    const page = pages.get(row.pagePublish!.pageId)!;
    // whatever the bot sent (access, publish), the page waits for the person
    expect(page.status).toBe("draft");
    expect(page.access).toBe("private");
    expect(page.linkId).toBeUndefined();
  });

  it("the card route refuses in a room and when the server has no pages", () => {
    const base: AgentCardStore = { groupByThread: () => ({}), messagesFor: () => [], appendMessage: () => { throw new Error("no write"); }, patchMessage: () => null };
    const input = { tool: "propose_page", title: "Rapport", kind: "html", content: HTML };
    const bot = { id: "bot1", name: "Scout", color: "blue" as never };
    expect(createAgentCard({ store: base, bot, threadId: "t1", input, proposePage: () => ({ ok: true, pageId: "x", version: 1 }) })).toMatchObject({ ok: false, status: 409 });
    expect(createAgentCard({ store: { ...base, groupByThread: () => null }, bot, threadId: "t1", input })).toMatchObject({ ok: false, status: 403 });
  });

  it("a bot's shell on a shared server and another person cannot publish", async () => {
    const { pages } = store();
    const { page } = proposed(pages, "pr_alice");
    const handler = routes(pages);
    const body = { version: 1, access: "link", expiresAt: null };
    expect((await call(handler, serviceLoopback, "POST", `/api/pages/${page.id}/publish`, body)).status).toBe(403);
    expect((await call(handler, session(), "POST", `/api/pages/${page.id}/publish`, body)).status).toBe(403);
    expect((await call(handler, session("pr_bob"), "POST", `/api/pages/${page.id}/publish`, body)).status).toBe(404);
    expect((await call(handler, session("pr_bob"), "GET", "/api/pages")).body!.pages).toEqual([]);
    expect(pages.get(page.id)!.status).toBe("draft");
    const ok = await call(handler, session("pr_alice"), "POST", `/api/pages/${page.id}/publish`, body);
    expect(ok.status).toBe(200);
    expect(ok.body!.page).toMatchObject({ status: "published", access: "link", currentVersion: 1 });
    expect(ok.body!.page.url).toMatch(/^https:\/\/sagax\.example\.com\/pages\/view\//);
  });

  it("publish needs an explicit access and a valid expiry; a declined version never publishes", async () => {
    const { pages } = store();
    const { page } = proposed(pages, "pr_alice");
    const handler = routes(pages);
    const alice = session("pr_alice");
    expect((await call(handler, alice, "POST", `/api/pages/${page.id}/publish`, { version: 1 })).status).toBe(400);
    expect((await call(handler, alice, "POST", `/api/pages/${page.id}/publish`, { version: 1, access: "everyone" })).status).toBe(400);
    expect((await call(handler, alice, "POST", `/api/pages/${page.id}/publish`, { version: 1, access: "org", expiresAt: now - 1 })).status).toBe(400);
    expect((await call(handler, alice, "POST", `/api/pages/${page.id}/decline`, { version: 1 })).status).toBe(200);
    expect((await call(handler, alice, "POST", `/api/pages/${page.id}/publish`, { version: 1, access: "org", expiresAt: null })).status).toBe(409);
  });
});

describe("ownership: the conversation's person, not the bot's owner", () => {
  it("a member's private thread with someone else's team bot gives the member the page", async () => {
    const { pages } = store();
    // the thread records the member; the bot belongs to its owner
    const ownerId = pageOwnerFor({ ownerPrincipalId: "pr_member" }, "pr_botowner");
    expect(ownerId).toBe("pr_member");
    const { page } = proposed(pages, ownerId);
    const handler = routes(pages);
    // the bot owner neither sees nor publishes it
    expect((await call(handler, session("pr_botowner"), "GET", "/api/pages")).body!.pages).toEqual([]);
    expect((await call(handler, session("pr_botowner"), "GET", `/api/pages/${page.id}`)).status).toBe(404);
    expect((await call(handler, session("pr_botowner"), "POST", `/api/pages/${page.id}/publish`, { version: 1, access: "private", expiresAt: null })).status).toBe(404);
    // the member does
    expect((await call(handler, session("pr_member"), "GET", "/api/pages")).body!.pages.map((entry: { id: string }) => entry.id)).toEqual([page.id]);
    const ok = await call(handler, session("pr_member"), "POST", `/api/pages/${page.id}/publish`, { version: 1, access: "private", expiresAt: null });
    expect(ok.status).toBe(200);
    // and only the member reads it
    const path = ok.body!.page.path as string;
    expect((await read(pages, path, { principalId: "pr_botowner", computerOwner: false })).wrapper.status).toBe(404);
    expect((await read(pages, path, { principalId: "pr_member", computerOwner: false })).frame?.status).toBe(200);
  });

  it("a thread with no recorded owner (older, webhook) falls back to the bot owner", () => {
    expect(pageOwnerFor(undefined, "pr_botowner")).toBe("pr_botowner");
    expect(pageOwnerFor({}, "PR_BotOwner")).toBe("pr_botowner");
  });

  it("on a one-person server only the computer's owner manages and reads private pages", async () => {
    const { pages } = store();
    const { page } = proposed(pages);
    const handler = routes(pages, false);
    // a paired session that is not the computer's owner
    expect((await call(handler, session("pr_guest"), "GET", "/api/pages")).status).toBe(403);
    expect((await call(handler, session("pr_guest"), "POST", `/api/pages/${page.id}/publish`, { version: 1, access: "link", expiresAt: null })).status).toBe(403);
    expect((await call(handler, session(), "POST", `/api/pages/${page.id}/publish`, { version: 1, access: "private", expiresAt: null })).status).toBe(200);
    const path = pages.path(pages.get(page.id)!.linkId!);
    expect((await read(pages, path, { computerOwner: false })).wrapper.status).toBe(404);
    expect((await read(pages, path, OWNER)).frame?.status).toBe(200);
  });
});

describe("wrapper and sandboxed frame", () => {
  it("the reader gets a Sagax wrapper with its bar (title and the full notice) and the page in a scripts-only frame", async () => {
    const { pages } = store();
    const { path } = published(pages);
    const { wrapper, frame } = await read(pages, path, null);
    expect(wrapper.status).toBe(200);
    // the yellow banner's words, all of them, now in the bar
    const notice = readerNotice({ bot: "Scout", person: "Alice", lang: "fr" });
    // the bot's name is set in semibold beside its mascot: the words read the same
    const text = wrapper.body.replace(/<[^>]+>/g, "");
    expect(text).toContain(escapeHtml(notice.who));
    expect(text).toContain(escapeHtml(notice.warning));
    expect(wrapper.body).toContain("jamais de mot de passe");
    expect(wrapper.body).toMatch(/<header class="sagax-bar"><h1 title="Rapport">Rapport<\/h1>/);
    // no built UI here: only the nonce'd open-link listener (#1799) and the JSON boot block
    expect(wrapper.body).toMatch(/<script nonce="[^"]+">/);
    expect(wrapper.body).toContain(WRAPPER_OPEN_SOURCE);
    expect(wrapper.body).toMatch(/<iframe src="\/pages\/frame\/[^"]+\?t=[^"]+" sandbox="allow-scripts"/);
    const csp = String(wrapper.headers["content-security-policy"]);
    expect(csp).toMatch(/script-src 'nonce-[^']+'/);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain("frame-ancestors 'none'");
    // the frame may load this page's frame path and nothing else
    const token = path.slice("/pages/view/".length);
    expect(csp).toContain(`frame-src sagax.example.com/pages/frame/${token};`);
    expect(csp).not.toMatch(/frame-src[^;]*('self'|\*|https:)/);
    expect(wrapper.headers["x-frame-options"]).toBe("DENY");
    expect(wrapper.headers["set-cookie"]).toBeUndefined();
    expect(frame!.status).toBe(200);
    expect(frame!.body).toContain("<h1>Rapport</h1>");
    // the prelude runs first: WebRTC and resource hints removed
    expect(frame!.body.indexOf(FRAME_PRELUDE)).toBe("<!doctype html>".length);
  });

  it("the page itself: sandbox without same-origin, top navigation, popups, modals or forms; no network", async () => {
    const { pages } = store();
    const { path } = published(pages);
    const { frame } = await read(pages, path, null);
    const csp = String(frame!.headers["content-security-policy"]);
    expect(csp).toMatch(/; sandbox allow-scripts$/);
    for (const flag of ["allow-same-origin", "allow-top-navigation", "allow-popups", "allow-modals", "allow-forms"]) expect(csp).not.toContain(flag);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(frame!.headers["set-cookie"]).toBeUndefined();
    expect(frame!.headers["cache-control"]).toBe("no-store");
    expect(frame!.headers["referrer-policy"]).toBe("no-referrer");
    expect(frame!.headers["x-content-type-options"]).toBe("nosniff");
    for (const kind of ["html", "markdown"] as const) {
      for (const flag of ["allow-same-origin", "allow-top-navigation", "allow-popups", "allow-modals", "allow-forms"]) expect(pageFrameSandbox(kind)).not.toContain(flag);
    }
  });

  it("the frame is never the main entry: no ticket, a forged or expired ticket, or a top-level load is a 404", async () => {
    const { pages } = store();
    const { path } = published(pages);
    const { wrapper } = await read(pages, path, null);
    const src = frameSrc(wrapper.body);
    const bare = src.split("?")[0]!;
    expect((await hit(options(pages, null), bare, { "sec-fetch-dest": "iframe" })).status).toBe(404);
    expect((await hit(options(pages, null), `${bare}?t=${now + 1000}.${"A".repeat(32)}`, { "sec-fetch-dest": "iframe" })).status).toBe(404);
    expect((await hit(options(pages, null), src, { "sec-fetch-dest": "document" })).status).toBe(404);
    expect((await hit(options(pages, null), src, { "sec-fetch-dest": "iframe" })).status).toBe(200);
    const before = now;
    now += 6 * 60 * 1000;
    try {
      expect((await hit(options(pages, null), src, { "sec-fetch-dest": "iframe" })).status).toBe(404);
    } finally {
      now = before;
    }
  });

  it("Markdown escapes raw HTML and writes safe links as anchors (#1799)", () => {
    expect(pageCsp("markdown")).toContain("script-src 'none'");
    expect(pageCsp("markdown")).toMatch(/; sandbox allow-scripts$/);
    expect(pageCsp("markdown")).not.toContain("allow-popups");
    const html = markdownToHtml("# Titre\n\n<script>alert(1)</script> **gras** [lien](javascript:alert(1)) [ok](https://example.com)\n\n- a\n- b\n\n```\n<b>x</b>\n```");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('<a href="https://example.com" rel="noopener noreferrer">ok</a>');
    expect(html).toContain("[lien](javascript:alert(1))");
    expect(html).toContain("<strong>gras</strong>");
    expect(html).toContain("<ul><li>a</li><li>b</li></ul>");
    expect(html).toContain("<pre><code>&lt;b&gt;x&lt;/b&gt;</code></pre>");
  });

  it("Markdown tables, task lists, strikethrough and autolinks render as HTML", () => {
    const md = "| a | b | c |\n|:---|:---:|---:|\n| 1 | **2** | x \\| y |\n| 3 | 4 |\n\n- [x] fait\n- [ ] a faire\n\n~~barre~~ <https://example.com> et https://example.org/x.";
    const doc = pageDocument({ kind: "markdown", title: "T", content: md });
    expect(doc).toContain("<table>");
    expect(doc).toContain("<thead><tr><th style=\"text-align:left\">a</th><th style=\"text-align:center\">b</th><th style=\"text-align:right\">c</th></tr></thead>");
    expect(doc).toContain("<td style=\"text-align:center\"><strong>2</strong></td>");
    expect(doc).toContain("x | y");
    expect(doc).not.toContain("|:---");
    expect(doc).toContain("<li class=\"task\">\u2611 fait</li>");
    expect(doc).toContain("<li class=\"task\">\u2610 a faire</li>");
    expect(doc).toContain("<del>barre</del>");
    expect(doc).toContain('<a class="url" href="https://example.com" rel="noopener noreferrer">https://example.com</a>');
    expect(doc).toContain('<a class="url" href="https://example.org/x" rel="noopener noreferrer">https://example.org/x</a>.');
    expect(pageCsp("markdown")).toMatch(/; sandbox allow-scripts$/);
  });

  it("an HTML page starts with the prelude; Markdown without a nonce has no script", () => {
    expect(pageDocument({ kind: "html", title: "R", content: HTML }).startsWith(`<!doctype html>${FRAME_PRELUDE}`)).toBe(true);
    expect(pageDocument({ kind: "html", title: "R", content: "<p>x</p>" }).startsWith(FRAME_PRELUDE)).toBe(true);
    expect(pageDocument({ kind: "markdown", title: "R", content: "# x" })).not.toContain("<script");
  });

  it("the banner keeps names to one short line", () => {
    expect(bannerName("  Scout\n the   bot ")).toBe("Scout the bot");
    const long = bannerName("x".repeat(200));
    expect(long.length).toBe(60);
    expect(wrapperBanner({ botName: "y".repeat(500), personName: "Alice", lang: "en" }).length).toBeLessThan(200);
  });

  it("only GET and HEAD, and the reading paths never reach the API", async () => {
    const { pages } = store();
    expect((await hit(options(pages, OWNER), "/pages/view/x", {}, "POST")).status).toBe(405);
    const other = request("/api/pages", "GET", { host: "sagax.example.com" });
    expect(handlePublishedPagePublic(options(pages, OWNER), other.req, other.res, "/api/pages", "GET")).toBe(false);
  });
});

describe("separate pages origin (SAGAX_PAGES_ORIGIN)", () => {
  const separate = { pagesOrigin: new URL("https://pages.example.net"), appOrigin: new URL("https://sagax.example.com") };

  it("the wrapper frames the pages origin, which serves the frame only, framed only by the app", async () => {
    const { pages } = store();
    const { path } = published(pages);
    const wrapper = await hit(options(pages, null, separate), path);
    const src = frameSrc(wrapper.body);
    expect(src.startsWith("https://pages.example.net/pages/frame/")).toBe(true);
    expect(String(wrapper.headers["content-security-policy"])).toContain(`frame-src https://pages.example.net${new URL(src).pathname};`);
    const frame = await hit(options(pages, null, separate), `${new URL(src).pathname}${new URL(src).search}`, { host: "pages.example.net", "sec-fetch-dest": "iframe" });
    expect(frame.status).toBe(200);
    expect(String(frame.headers["content-security-policy"])).toContain("frame-ancestors https://sagax.example.com;");
    // the app origin no longer serves frames, and the pages origin serves nothing else
    expect((await hit(options(pages, null, separate), `${new URL(src).pathname}${new URL(src).search}`, { "sec-fetch-dest": "iframe" })).status).toBe(404);
    for (const other of ["/", "/api/pages", "/api/health", path]) {
      const { req, res, done } = request(other, "GET", { host: "pages.example.net" });
      expect(handlePagesOriginRequest(options(pages, OWNER, separate), req, res, new URL(other, "http://x").pathname, "GET")).toBe(true);
      expect((await done).status).toBe(404);
    }
    // a request to the app's host is not the pages origin's
    const app = request("/api/pages", "GET", { host: "sagax.example.com" });
    expect(handlePagesOriginRequest(options(pages, OWNER, separate), app.req, app.res, "/api/pages", "GET")).toBe(false);
  });
});

describe("access levels", () => {
  it("pageReadable: link for anyone, org for any person of the server, private for its person", () => {
    const bob = { principalId: "pr_b", computerOwner: false };
    expect(pageReadable({ access: "link", ownerId: "pr_a" }, null)).toBe(true);
    expect(pageReadable({ access: "org", ownerId: "pr_a" }, null)).toBe(false);
    expect(pageReadable({ access: "org", ownerId: "pr_a" }, bob)).toBe(true);
    expect(pageReadable({ access: "private", ownerId: "pr_a" }, bob)).toBe(false);
    expect(pageReadable({ access: "private", ownerId: "pr_a" }, { principalId: "PR_A", computerOwner: false })).toBe(true);
    expect(pageReadable({ access: "private", ownerId: "pr_a" }, OWNER)).toBe(false);
    expect(pageReadable({ access: "private", ownerId: "pr_a" }, null)).toBe(false);
    // a one-person server: its computer's owner, not every paired session
    expect(pageReadable({ access: "private" }, OWNER)).toBe(true);
    expect(pageReadable({ access: "private" }, { computerOwner: false })).toBe(false);
    expect(pageReadable({ access: "org" }, { computerOwner: false })).toBe(true);
  });

  it("each level over the reading link, with the same 404 for a reader who may not see it", async () => {
    const { pages } = store();
    const { id, path } = published(pages, "private", "pr_alice");
    const made = await hit(options(pages, { principalId: "pr_alice", computerOwner: false }), `/pages/view/${"A".repeat(22)}.${"B".repeat(32)}`);
    const anonymous = (await read(pages, path, null)).wrapper;
    expect(anonymous.status).toBe(404);
    expect(anonymous.body).toBe(made.body);
    expect((await read(pages, path, { principalId: "pr_bob", computerOwner: false })).wrapper.status).toBe(404);
    expect((await read(pages, path, { principalId: "pr_alice", computerOwner: false })).frame?.status).toBe(200);
    pages.update(id, { access: "org" });
    expect((await read(pages, path, null)).wrapper.status).toBe(404);
    expect((await read(pages, path, { principalId: "pr_bob", computerOwner: false })).frame?.status).toBe(200);
    pages.update(id, { access: "link" });
    expect((await read(pages, path, null)).frame?.status).toBe(200);
  });
});

describe("revocation, expiry and versions", () => {
  it("revoking takes the link and its frames down at once, and publishing again mints a new link", async () => {
    const { pages } = store();
    const { page } = proposed(pages, "pr_alice");
    const handler = routes(pages);
    const alice = session("pr_alice");
    const first = await call(handler, alice, "POST", `/api/pages/${page.id}/publish`, { version: 1, access: "link", expiresAt: null });
    const oldPath = first.body!.page.path as string;
    const before = await read(pages, oldPath, null);
    expect(before.frame?.status).toBe(200);
    const revoked = await call(handler, alice, "POST", `/api/pages/${page.id}/revoke`);
    expect(revoked.body!.page).toMatchObject({ status: "revoked", currentVersion: null });
    expect(revoked.body!.page.url).toBeUndefined();
    expect((await read(pages, oldPath, null)).wrapper.status).toBe(404);
    // a frame ticket minted before the revocation is dead too
    expect((await hit(options(pages, null), frameSrc(before.wrapper.body), { "sec-fetch-dest": "iframe" })).status).toBe(404);
    const again = await call(handler, alice, "POST", `/api/pages/${page.id}/publish`, { version: 1, access: "link", expiresAt: null });
    expect(again.body!.page.path).not.toBe(oldPath);
    expect((await read(pages, oldPath, null)).wrapper.status).toBe(404);
    expect((await read(pages, again.body!.page.path, null)).frame?.status).toBe(200);
    await call(handler, alice, "POST", `/api/pages/${page.id}/revoke`);
    expect((await call(handler, alice, "PATCH", `/api/pages/${page.id}`, { access: "org" })).status).toBe(409);
  });

  it("an expired page is not served and reads as expired to its person", async () => {
    const { pages } = store();
    const { page } = proposed(pages, "pr_alice");
    const handler = routes(pages);
    const alice = session("pr_alice");
    const expiresAt = now + 60 * 60 * 1000;
    const done = await call(handler, alice, "POST", `/api/pages/${page.id}/publish`, { version: 1, access: "link", expiresAt });
    const path = done.body!.page.path as string;
    expect((await read(pages, path, null)).frame?.status).toBe(200);
    const before = now;
    now = expiresAt;
    try {
      expect((await read(pages, path, null)).wrapper.status).toBe(404);
      expect((await call(handler, alice, "GET", `/api/pages/${page.id}`)).body!.page.expired).toBe(true);
      expect((await call(handler, alice, "PATCH", `/api/pages/${page.id}`, { expiresAt: null })).status).toBe(200);
      expect((await read(pages, path, null)).frame?.status).toBe(200);
    } finally {
      now = before;
    }
  });

  it("a new version waits for its own Publish; readers keep the published one", async () => {
    const { pages } = store();
    const { id, path } = published(pages, "link", "pr_alice");
    const second = pages.propose({ pageId: id, botId: "bot1", threadId: "t1", title: "Rapport v2", kind: "markdown", content: "# v2" });
    expect(second.ok && second.version.n).toBe(2);
    expect((await read(pages, path, null)).frame?.body).toContain("<h1>Rapport</h1>");
    pages.publish(id, { version: 2, access: "link", expiresAt: null });
    expect((await read(pages, path, null)).frame?.body).toContain("<h1>v2</h1>");
    expect(pages.propose({ pageId: id, botId: "bot2", threadId: "t2", title: "x", kind: "html", content: "x" }).ok).toBe(false);
    const preview = await call(routes(pages), session("pr_alice"), "GET", `/api/pages/${id}/versions/1`);
    expect(preview.body!.version.previewPath).toBe(`/pages/preview/${id}/1`);
    expect(preview.body!.version.html).toBeUndefined();
  });

  it("delete removes the page, its content files and its link", async () => {
    const { pages, dir } = store();
    const { id, path } = published(pages, "link", "pr_alice");
    expect(existsSync(join(dir, "published-pages", id))).toBe(true);
    expect((await call(routes(pages), session("pr_alice"), "DELETE", `/api/pages/${id}`)).status).toBe(200);
    expect(pages.get(id)).toBeNull();
    expect(existsSync(join(dir, "published-pages", id))).toBe(false);
    expect((await read(pages, path, null)).wrapper.status).toBe(404);
  });
});

describe("caps and storage", () => {
  it("content lives outside the index, and a version beyond the cap drops the oldest unpublished one", () => {
    const { pages, dir } = store();
    const { page } = proposed(pages, "pr_alice", { content: "<p>secret-free marker</p>" });
    expect(readFileSync(join(dir, "published-pages.json"), "utf8")).not.toContain("secret-free marker");
    expect(pages.content(page.id, 1)).toBe("<p>secret-free marker</p>");
    pages.publish(page.id, { version: 1, access: "link", expiresAt: null });
    for (let i = 0; i < PAGE_LIMITS.versions + 2; i += 1) pages.propose({ pageId: page.id, botId: "bot1", threadId: "t1", title: "x", kind: "html", content: `v${i}` });
    const kept = pages.get(page.id)!.versions;
    expect(kept).toHaveLength(PAGE_LIMITS.versions);
    expect(kept.some((version) => version.n === 1)).toBe(true);
    expect(kept.some((version) => version.n === 2)).toBe(false);
    expect(existsSync(join(dir, "published-pages", page.id, "2"))).toBe(false);
  });

  it("per person and per bot caps", () => {
    const { pages } = store();
    for (let i = 0; i < PAGE_LIMITS.pagesPerOwner; i += 1) proposed(pages, "pr_alice", { botId: `bot${i}` });
    expect(pages.propose({ botId: "botx", threadId: "t9", title: "x", kind: "html", content: "x", ownerId: "pr_alice" })).toMatchObject({ ok: false, code: "too_many_owner" });
    expect(pages.propose({ botId: "botx", threadId: "t9", title: "x", kind: "html", content: "x", ownerId: "pr_bob" }).ok).toBe(true);
    for (let i = 0; i < PAGE_LIMITS.pagesPerBot - 1; i += 1) proposed(pages, `pr_p${i}`, { botId: "busy" });
    expect(proposed(pages, "pr_last", { botId: "busy" }).ok).toBe(true);
    expect(pages.propose({ botId: "busy", threadId: "t9", title: "x", kind: "html", content: "x", ownerId: "pr_other" })).toMatchObject({ ok: false, code: "too_many_bot" });
  });

  it("re-reads the index only when it changed on disk", () => {
    const { pages, dir } = store();
    const { page } = proposed(pages);
    expect(pages.get(page.id)).not.toBeNull();
    // another writer (a second instance on the same folder) is seen
    const other = new PublishedPages(dir, () => now);
    other.remove(page.id);
    expect(pages.get(page.id)).toBeNull();
  });
});

describe("input checks", () => {
  it("parsePageProposal and validExpiry", () => {
    expect(parsePageProposal({ title: "x", kind: "pdf", content: "x" }).ok).toBe(false);
    expect(parsePageProposal({ title: "", kind: "html", content: "x" }).ok).toBe(false);
    expect(parsePageProposal({ title: "x", kind: "html", content: "x".repeat(600 * 1024) }).ok).toBe(false);
    expect(parsePageProposal({ title: "x", kind: "html", content: "x", page_id: "../../etc" }).ok).toBe(false);
    expect(parsePageProposal({ title: "  A   title ", kind: "markdown", content: "# x" })).toEqual({ ok: true, value: { title: "A title", kind: "markdown", content: "# x" } });
    expect(validExpiry(null, now)).toEqual({ ok: true, value: null });
    expect(validExpiry(now + 1000, now)).toEqual({ ok: true, value: now + 1000 });
    expect(validExpiry(now, now).ok).toBe(false);
    expect(validExpiry(now + 400 * 24 * 60 * 60 * 1000, now).ok).toBe(false);
    expect(validExpiry("tomorrow", now).ok).toBe(false);
  });
});

describe("the app's preview (review of #646, round 2)", () => {
  it("its person gets the same wrapper and banner, framed by the app only, for a version never published", async () => {
    const { pages } = store();
    const { page } = proposed(pages, "pr_alice");
    const alice: PageViewer = { principalId: "pr_alice", computerOwner: false };
    const wrapper = await hit(options(pages, alice), `/pages/preview/${page.id}/1`);
    expect(wrapper.status).toBe(200);
    expect(wrapper.body).toContain("Aperçu d&#39;une page proposée par Scout pour Alice");
    expect(wrapper.body).toContain(WRAPPER_OPEN_SOURCE);
    const csp = String(wrapper.headers["content-security-policy"]);
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toMatch(/script-src 'nonce-[^']+'/);
    expect(csp).toContain(`frame-src sagax.example.com/pages/preview-frame/${page.id}/1;`);
    expect(wrapper.headers["x-frame-options"]).toBe("SAMEORIGIN");
    const src = frameSrc(wrapper.body);
    expect(src.startsWith(`/pages/preview-frame/${page.id}/1?t=`)).toBe(true);
    const frame = await hit(options(pages, alice), src, { "sec-fetch-dest": "iframe" });
    expect(frame.status).toBe(200);
    expect(String(frame.headers["content-security-policy"])).toMatch(/; sandbox allow-scripts$/);
    expect(frame.body).toContain("<h1>Rapport</h1>");
    expect(frame.body).toContain(OPEN_BRIDGE_SOURCE);
  });

  it("nobody else previews: another person, nobody signed in, or someone holding the ticket", async () => {
    const { pages } = store();
    const { page } = proposed(pages, "pr_alice");
    const alice: PageViewer = { principalId: "pr_alice", computerOwner: false };
    const bob: PageViewer = { principalId: "pr_bob", computerOwner: false };
    expect((await hit(options(pages, bob), `/pages/preview/${page.id}/1`)).status).toBe(404);
    expect((await hit(options(pages, null), `/pages/preview/${page.id}/1`)).status).toBe(404);
    const src = frameSrc((await hit(options(pages, alice), `/pages/preview/${page.id}/1`)).body);
    expect((await hit(options(pages, bob), src, { "sec-fetch-dest": "iframe" })).status).toBe(404);
    expect((await hit(options(pages, null), src, { "sec-fetch-dest": "iframe" })).status).toBe(404);
    expect((await hit(options(pages, alice), src, { "sec-fetch-dest": "document" })).status).toBe(404);
    // a reading ticket never opens a preview frame, nor the other way round
    expect((await hit(options(pages, alice), src.replace("/pages/preview-frame/", "/pages/frame/"), { "sec-fetch-dest": "iframe" })).status).toBe(404);
  });
});

describe("the app's own look of its preview (2026-10-28, the page view)", () => {
  const alice: PageViewer = { principalId: "pr_alice", computerOwner: false };

  it("inside the app: no banner, the app's theme, and the place kept by a small script that only reports a number", async () => {
    const { pages } = store();
    const { page } = proposed(pages, "pr_alice");
    const wrapper = await hit(options(pages, alice), `/pages/preview/${page.id}/1?bare=1&theme=dark&y=640`);
    expect(wrapper.status).toBe(200);
    expect(wrapper.body).not.toContain("sagax-banner\" role");
    expect(wrapper.body).toContain('<meta name="color-scheme" content="dark">');
    expect(wrapper.body).toContain(WRAPPER_OPEN_SOURCE);
    const src = frameSrc(wrapper.body);
    expect(src).toMatch(/&k=640(&|$)/);
    expect(src).toMatch(/&c=dark(&|$)/);
    const frame = await hit(options(pages, alice), src, { "sec-fetch-dest": "iframe" });
    expect(frame.status).toBe(200);
    expect(frame.body).toContain(`"sagax-page-scroll"`);
    expect(frame.body).toContain("var y=640");
    expect(frame.body).toContain('<meta name="color-scheme" content="dark">');
    // still no network for the page
    expect(String(frame.headers["content-security-policy"])).toContain("connect-src 'none'");
  });

  it("serves every page with the default theme: the app's scheme, the person's skin, Geist, under the same CSP (2026-10-28)", async () => {
    const { pages } = store();
    const { page } = proposed(pages, "pr_alice");
    const skin = encodeSkinTokens({ "--code-color-scheme": "dark", "--color-panel": "#060f20", "--color-ink": "#eef2fb" });
    const wrapper = await hit(options(pages, alice), `/pages/preview/${page.id}/1?bare=1&theme=dark&skin=${skin}`);
    const src = frameSrc(wrapper.body);
    expect(src).toContain(`&s=${skin}`);
    const frame = await hit(options(pages, alice), src, { "sec-fetch-dest": "iframe" });
    expect(frame.body).toContain(`<style id="${PAGE_THEME_STYLE_ID}">`);
    expect(frame.body).toContain(`@layer ${PAGE_THEME_LAYER}{`);
    expect(frame.body).toContain("--background:#060f20");
    expect(frame.body).toContain("--foreground:#eef2fb");
    expect(frame.body).toContain(".stat-card{");
    expect(frame.body).toContain("font-family:'Geist Variable'");
    // the theme comes before the page's own markup, so the page can override it
    expect(frame.body.indexOf(PAGE_THEME_STYLE_ID)).toBeLessThan(frame.body.indexOf("<body") >= 0 ? frame.body.indexOf("<body") : frame.body.length);
    const csp = String(frame.headers["content-security-policy"]);
    expect(csp).toContain("font-src data:");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("default-src 'none'");
    // a skin value that is not a color never reaches the style
    const evil = encodeSkinTokens({ "--color-panel": "#000" }).length ? Buffer.from(JSON.stringify({ "--color-panel": "red}</style><script>x()</script>" })).toString("base64url") : "";
    const bad = await hit(options(pages, alice), frameSrc((await hit(options(pages, alice), `/pages/preview/${page.id}/1?bare=1&theme=light&skin=${evil}`)).body), { "sec-fetch-dest": "iframe" });
    expect(bad.body).not.toContain("x()");
    expect(bad.body).toContain("color-scheme:light");
  });

  it("a Markdown page keeps its place by nonce only, and its own style follows the app's theme", async () => {
    const { pages } = store();
    const { page } = proposed(pages, "pr_alice", { content: "# Bilan\n\nTexte" });
    pages.edit(page.id, { kind: "markdown", content: "# Bilan\n\nTexte", by: "pr_alice" });
    const wrapper = await hit(options(pages, alice), `/pages/preview/${page.id}/2?bare=1&theme=light&y=10`);
    expect(wrapper.body).toContain('sandbox="allow-scripts"');
    const frame = await hit(options(pages, alice), frameSrc(wrapper.body), { "sec-fetch-dest": "iframe" });
    const csp = String(frame.headers["content-security-policy"]);
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(frame.body).toContain(`<script nonce="${nonce}">`);
    expect(frame.body).not.toContain("prefers-color-scheme");
    // no annotation script unless annotation mode was asked
    expect(frame.body).not.toContain("sagax-page-annotation");
  });

  it("a reading link never takes the app's look: the bar stays, no script is added", async () => {
    const { pages } = store();
    const { path } = published(pages, "link", "pr_alice");
    const wrapper = await hit(options(pages, null), `${path}?bare=1&theme=dark&y=640`);
    expect(wrapper.status).toBe(200);
    expect(wrapper.body).toContain("sagax-bar-note");
    const src = frameSrc(wrapper.body);
    expect(src).not.toContain("&k=");
    const frame = await hit(options(pages, null), `${src}&k=640&c=dark`, { "sec-fetch-dest": "iframe" });
    expect(frame.body).not.toContain("sagax-page-scroll");
    expect(frame.body).not.toContain('content="dark"');
    // the reader's own system picks light or dark; the theme is there either way
    expect(frame.body).toContain('<meta name="color-scheme" content="light dark">');
    expect(frame.body).toContain("@media screen and (prefers-color-scheme:dark){:root{");
  });

  it("a place that is not a whole number is ignored", async () => {
    const { pages } = store();
    const { page } = proposed(pages, "pr_alice");
    const wrapper = await hit(options(pages, alice), `/pages/preview/${page.id}/1?y=-5&theme=blue`);
    const src = frameSrc(wrapper.body);
    expect(src).not.toContain("&k=");
    expect(src).not.toContain("&c=");
    expect(wrapper.body).toContain("sagax-banner");
  });
});

describe("Share > Add people or groups (2026-10-28)", () => {
  const alice: PageViewer = { principalId: "pr_alice", computerOwner: false };
  const bob: PageViewer = { principalId: "pr_bob", computerOwner: false };
  const carol: PageViewer = { principalId: "pr_carol", computerOwner: false };

  it("a page shared with People you invite reads for its person and the invited people only", async () => {
    const { pages } = store();
    const { id, path } = published(pages, "private", "pr_alice");
    expect((await read(pages, path, bob)).wrapper.status).toBe(404);
    const answer = await call(routes(pages), session("pr_alice"), "POST", `/api/pages/${id}/invite`, { people: ["pr_bob", "PR_BOB", "pr_alice"], teams: [] });
    expect(answer.status).toBe(200);
    // no duplicate, never the page's own person
    expect(answer.body!.page.invites).toEqual({ people: ["pr_bob"], teams: [] });
    const { wrapper, frame } = await read(pages, path, bob);
    expect(wrapper.status).toBe(200);
    expect(frame!.status).toBe(200);
    expect((await read(pages, path, carol)).wrapper.status).toBe(404);
    expect((await read(pages, path, null)).wrapper.status).toBe(404);
    expect((await read(pages, path, alice)).wrapper.status).toBe(200);
  });

  it("an invited team reads it through its people; a person out of it does not", async () => {
    const { pages } = store();
    const { id, path } = published(pages, "private", "pr_alice");
    await call(routes(pages), session("pr_alice"), "POST", `/api/pages/${id}/invite`, { people: [], teams: ["team_ops"] });
    const withTeams = (viewer: PageViewer): PublicPageOptions => ({ ...options(pages, viewer), teamsOf: (who) => (who === "pr_bob" ? ["team_ops"] : ["team_other"]) });
    expect((await hit(withTeams(bob), path)).status).toBe(200);
    expect((await hit(withTeams(carol), path)).status).toBe(404);
  });

  it("only the page's person invites; another person's page reads as missing; a bad list is refused", async () => {
    const { pages } = store();
    const { id } = published(pages, "private", "pr_alice");
    expect((await call(routes(pages), session("pr_bob"), "POST", `/api/pages/${id}/invite`, { people: ["pr_bob"] })).status).toBe(404);
    expect((await call(routes(pages), session("pr_alice"), "POST", `/api/pages/${id}/invite`, { people: ["<script>"] })).status).toBe(400);
    expect((await call(routes(pages), session("pr_alice"), "POST", `/api/pages/${id}/invite`, "x")).status).toBe(400);
  });

  it("the organization's switch for public links still holds: an invite never opens a link, and link reads as organization when off", async () => {
    const { pages } = store();
    const { id, path } = published(pages, "private", "pr_alice");
    pages.setPolicy({ linkSharing: false });
    expect((await call(routes(pages), session("pr_alice"), "PATCH", `/api/pages/${id}`, { access: "link" })).body!.code).toBe("link_sharing_off");
    await call(routes(pages), session("pr_alice"), "POST", `/api/pages/${id}/invite`, { people: ["pr_bob"] });
    expect((await read(pages, path, null)).wrapper.status).toBe(404);
  });
});

describe("a new version from another topic of the same conversation (2026-10-28)", () => {
  it("the same bot revises its page for the same person from another thread; never another bot's or another person's", () => {
    const { pages } = store();
    const first = pages.propose({ ownerId: "pr_alice", botId: "bot1", threadId: "t1", title: "Rapport", kind: "html", content: HTML });
    if (!first.ok) throw new Error("propose");
    expect(pages.propose({ pageId: first.page.id, ownerId: "pr_alice", botId: "bot1", threadId: "t9", title: "Rapport", kind: "html", content: "<p>v2</p>" })).toMatchObject({ ok: true, version: { n: 2 } });
    expect(pages.propose({ pageId: first.page.id, ownerId: "pr_alice", botId: "bot2", threadId: "t9", title: "x", kind: "html", content: "x" }).ok).toBe(false);
    expect(pages.propose({ pageId: first.page.id, ownerId: "pr_bob", botId: "bot1", threadId: "t9", title: "x", kind: "html", content: "x" }).ok).toBe(false);
  });
});

describe("the frame checks its reader again (review of #646, round 2)", () => {
  it("on the app's origin: the live session, not only the ticket", async () => {
    const { pages } = store();
    const { id, path } = published(pages, "private", "pr_alice");
    const alice: PageViewer = { principalId: "pr_alice", computerOwner: false };
    const src = frameSrc((await hit(options(pages, alice), path)).body);
    expect((await hit(options(pages, alice), src, { "sec-fetch-dest": "iframe" })).status).toBe(200);
    // the same ticket, presented without Alice's session
    expect((await hit(options(pages, null), src, { "sec-fetch-dest": "iframe" })).status).toBe(404);
    expect((await hit(options(pages, { principalId: "pr_bob", computerOwner: false }), src, { "sec-fetch-dest": "iframe" })).status).toBe(404);
    // and Alice's page turned to org: anyone signed in reads it
    pages.update(id, { access: "org" });
    expect((await hit(options(pages, { principalId: "pr_bob", computerOwner: false }), src, { "sec-fetch-dest": "iframe" })).status).toBe(200);
  });

  it("on the separate origin: the ticket's reader, still active", async () => {
    const separate = { pagesOrigin: new URL("https://pages.example.net"), appOrigin: new URL("https://sagax.example.com") };
    const { pages } = store();
    const { path } = published(pages, "private", "pr_alice");
    const alice: PageViewer = { principalId: "pr_alice", computerOwner: false };
    const src = new URL(frameSrc((await hit(options(pages, alice, separate), path)).body));
    const at = `${src.pathname}${src.search}`;
    const frame = (active: boolean) => hit({ ...options(pages, null, separate), viewerActive: () => active }, at, { host: "pages.example.net", "sec-fetch-dest": "iframe" });
    expect((await frame(true)).status).toBe(200);
    expect((await frame(false)).status).toBe(404);
  });
});

describe("a disabled or deleted person's pages, and admin revoke (review of #646, round 2)", () => {
  it("nothing of a disabled person is served, wrapper or frame", async () => {
    const { pages } = store();
    const { path } = published(pages, "link", "pr_alice");
    const src = frameSrc((await hit(options(pages, null), path)).body);
    const gone = { ...options(pages, null), ownerActive: () => false };
    expect((await hit(gone, path)).status).toBe(404);
    expect((await hit(gone, src, { "sec-fetch-dest": "iframe" })).status).toBe(404);
  });

  it("an organization admin lists every page and revokes one, audited; others are refused", async () => {
    const { pages } = store();
    const { id, path } = published(pages, "link", "pr_alice");
    const rows: unknown[] = [];
    const handler = createPublishedPageRoutes({
      pages,
      owner: (auth) => auth.kind === "session" ? auth.session.principalId : undefined,
      isPerson: () => true,
      isAdmin: (auth) => auth.kind === "session" && auth.session.principalId === "pr_admin",
      audit: (_auth, _req, row) => rows.push(row),
      origin: () => "https://sagax.example.com",
      reachable: () => true,
      now: () => now,
    });
    expect((await call(handler, session("pr_bob"), "GET", "/api/admin/pages")).status).toBe(403);
    expect((await call(handler, session("pr_bob"), "POST", `/api/admin/pages/${id}/revoke`)).status).toBe(403);
    const listed = await call(handler, session("pr_admin"), "GET", "/api/admin/pages");
    expect(listed.body!.pages.map((page: { id: string; ownerId: string }) => [page.id, page.ownerId])).toEqual([[id, "pr_alice"]]);
    // never the link or its path: they carry the token
    expect(listed.body!.pages[0].url).toBeUndefined();
    expect(listed.body!.pages[0].path).toBeUndefined();
    expect(JSON.stringify(listed.body)).not.toContain(path.slice("/pages/view/".length));
    const revoked = await call(handler, session("pr_admin"), "POST", `/api/admin/pages/${id}/revoke`);
    expect(revoked.body!.page.status).toBe("revoked");
    expect(revoked.body!.page.path).toBeUndefined();
    expect(rows).toEqual([{ action: "page.revoke", target: { kind: "page", id, name: "Rapport" } }]);
    expect((await read(pages, path, null)).wrapper.status).toBe(404);
  });
});

describe("per-person bytes and the pages host (review of #646, round 2)", () => {
  it("a person's pages are capped in bytes, for new pages and new versions alike", () => {
    const { pages } = store();
    const big = "x".repeat(PAGE_LIMITS.contentBytes);
    const ids: string[] = [];
    for (let p = 0; p < PAGE_LIMITS.bytesPerOwner / PAGE_LIMITS.contentBytes / PAGE_LIMITS.versions; p += 1) {
      const first = proposed(pages, "pr_alice", { botId: `b${p}`, content: big });
      ids.push(first.page.id);
      for (let v = 1; v < PAGE_LIMITS.versions; v += 1) expect(pages.propose({ pageId: first.page.id, botId: `b${p}`, threadId: "t1", title: "x", kind: "html", content: big }).ok).toBe(true);
    }
    expect(pages.propose({ botId: "bz", threadId: "t1", title: "x", kind: "html", content: "x", ownerId: "pr_alice" })).toMatchObject({ ok: false, code: "owner_full" });
    expect(pages.propose({ pageId: ids[0], botId: "b0", threadId: "t1", title: "x", kind: "html", content: "x" })).toMatchObject({ ok: false, code: "owner_full" });
    expect(pages.propose({ botId: "bz", threadId: "t1", title: "x", kind: "html", content: "x", ownerId: "pr_bob" }).ok).toBe(true);
  }, 120_000);

  it("SAGAX_PAGES_ORIGIN without a known app origin: that host serves nothing at all", async () => {
    const { pages } = store();
    const { path } = published(pages);
    const src = frameSrc((await hit(options(pages, null), path)).body);
    const fenced = { ...options(pages, OWNER), pagesHost: "pages.example.net" };
    for (const other of [src, path, "/", "/api/pages", "/api/health"]) {
      const { req, res, done } = request(other, "GET", { host: "pages.example.net", "sec-fetch-dest": "iframe" });
      expect(handlePagesOriginRequest(fenced, req, res, new URL(other, "http://x").pathname, "GET")).toBe(true);
      expect((await done).status).toBe(404);
    }
    const app = request("/api/pages", "GET", { host: "sagax.example.com" });
    expect(handlePagesOriginRequest(fenced, app.req, app.res, "/api/pages", "GET")).toBe(false);
  });
});

describe("frame-src names the known public origin (review of #646, round 3)", () => {
  it("with its scheme when the request came in on that host, the Host header otherwise", async () => {
    const { pages } = store();
    const { path } = published(pages);
    const token = path.slice("/pages/view/".length);
    const known = { ...options(pages, null), appOrigin: new URL("https://sagax.example.com") };
    const onPublic = await hit(known, path);
    expect(String(onPublic.headers["content-security-policy"])).toContain(`frame-src https://sagax.example.com/pages/frame/${token};`);
    const onLoopback = await hit(known, path, { host: "127.0.0.1:4321" });
    expect(String(onLoopback.headers["content-security-policy"])).toContain(`frame-src 127.0.0.1:4321/pages/frame/${token};`);
  });

  it("the served HTML has no link hint, nested frame or speculation rules left, and DNS prefetch off", async () => {
    const { pages } = store();
    const { page } = proposed(pages, undefined, { content: '<!doctype html><link rel=prerender href="http://evil.example/x"><iframe src="http://evil.example"></iframe><script type=speculationrules>{}</script><p>ok</p>' });
    pages.publish(page.id, { version: 1, access: "link", expiresAt: null });
    const { frame } = await read(pages, pages.path(pages.get(page.id)!.linkId!), null);
    expect(frame!.body).toContain('<meta http-equiv="x-dns-prefetch-control" content="off">');
    expect(frame!.body).not.toMatch(/<link[\s>]/i);
    expect(frame!.body).not.toMatch(/<iframe[\s>]/i);
    expect(frame!.body).not.toMatch(/type=speculationrules>/i);
    expect(frame!.body).toContain("<p>ok</p>");
  });
});

describe("the reader's bar (2026-10-28)", () => {
  const owner: PageViewer = { principalId: "pr_owner", computerOwner: false };
  const reader: PageViewer = { principalId: "pr_reader", computerOwner: false };
  const ASSETS = { scripts: ["/assets/page-reader-abc.js"], styles: ["/assets/page-reader-abc.css"], preloads: ["/assets/react-abc.js"] };
  const withAssets = (pages: PublishedPages, viewer: PageViewer, assets: typeof ASSETS | null = ASSETS): PublicPageOptions => ({
    ...options(pages, viewer), readerAssets: () => assets, personName: (id) => (id === "pr_reader" ? "Reader" : "Someone"), teamsOf: () => [],
  });
  const bootOf = (body: string) => parseReaderBoot(JSON.parse(new RegExp(`<script type="application/json" id="${READER_BOOT_ID}">([^<]*)</script>`).exec(body)![1]!));

  it("a reader who is not signed in gets the title and the notice, never the page's id or Share", async () => {
    const { pages } = store();
    const { path } = published(pages, "link", "pr_owner");
    const wrapper = await hit(withAssets(pages, null), path);
    const boot = bootOf(wrapper.body)!;
    expect(boot).toMatchObject({ title: "Rapport", kind: "html", version: 1, lang: "fr", can: { share: false } });
    expect(boot.pageId).toBeUndefined();
    expect(boot.me).toBeUndefined();
    expect(wrapper.body).not.toContain(pages.list(undefined)[0]!.id);
  });

  it("the page's own person gets Share; an invited reader does not", async () => {
    const { pages } = store();
    const { id, path } = published(pages, "private", "pr_owner");
    pages.setInvites(id, { people: ["pr_reader"], teams: [] }, "pr_owner");
    const mine = bootOf((await hit(withAssets(pages, owner), path)).body)!;
    expect(mine).toMatchObject({ pageId: id, can: { share: true }, me: { id: "pr_owner", name: "Alice" }, owner: { name: "Alice" } });
    const theirs = bootOf((await hit(withAssets(pages, reader), path)).body)!;
    // an invited reader annotates (2026-10-28), never shares
    expect(theirs.can).toEqual({ share: false, annotate: true });
    expect(theirs.pageId).toBe(id);
    expect(theirs.me).toEqual({ id: "pr_reader", name: "Reader" });
  });

  it("with the built UI the wrapper runs this server's own script only, and reaches only its own origin", async () => {
    const { pages } = store();
    const { path } = published(pages, "link", "pr_owner");
    const wrapper = await hit(withAssets(pages, null), path);
    expect(wrapper.body).toContain('<script type="module" src="/assets/page-reader-abc.js"></script>');
    expect(wrapper.body).toContain('<link rel="stylesheet" href="/assets/page-reader-abc.css">');
    expect(wrapper.body).toContain('<link rel="modulepreload" href="/assets/react-abc.js">');
    const csp = String(wrapper.headers["content-security-policy"]);
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain("frame-ancestors 'none'");
    // the page's frame is unchanged: same sandbox, no network
    const frame = await hit(withAssets(pages, null), frameSrc(wrapper.body), { "sec-fetch-dest": "iframe" });
    expect(String(frame.headers["content-security-policy"])).toContain("connect-src 'none'");
    expect(wrapper.body).toMatch(/<iframe src="[^"]+" sandbox="allow-scripts"/);
  });

  it("the app's preview never gets the bar; only the open-link listener runs (#1799)", async () => {
    const { pages } = store();
    const { page } = proposed(pages, "pr_owner");
    const wrapper = await hit(withAssets(pages, owner), `/pages/preview/${page.id}/1`);
    expect(wrapper.body).toContain("sagax-banner");
    expect(wrapper.body).not.toContain("sagax-bar");
    expect(wrapper.body).toContain(WRAPPER_OPEN_SOURCE);
    expect(wrapper.body).not.toContain("/assets/");
    const csp = String(wrapper.headers["content-security-policy"]);
    expect(csp).toMatch(/script-src 'nonce-[^']+'/);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it("a title cannot close the JSON block or write markup", () => {
    const block = jsonBlock(READER_BOOT_ID, { title: "</script><script>alert(1)</script> & <b>" });
    expect(block.match(/<\/script>/g)).toHaveLength(1);
    expect(block).not.toContain("<b>");
    expect(JSON.parse(/>([^<]*)<\/script>$/.exec(block)![1]!).title).toBe("</script><script>alert(1)</script> & <b>");
  });

  it("only /assets/ paths of the built page are kept", () => {
    const html = '<script type="module" crossorigin src="/assets/page-reader-1.js"></script><script type="module" src="https://x.example/evil.js"></script>'
      + '<link rel="modulepreload" crossorigin href="/assets/react-1.js"><link rel="stylesheet" crossorigin href="/assets/page-reader-1.css"><link rel="stylesheet" href="//x.example/a.css">';
    expect(parseReaderAssets(html)).toEqual({ scripts: ["/assets/page-reader-1.js"], styles: ["/assets/page-reader-1.css"], preloads: ["/assets/react-1.js"] });
    expect(parseReaderAssets("<html></html>")).toBeNull();
  });
});

describe("Download PDF (2026-10-28)", () => {
  it("a reading frame tells its wrapper how tall it is, and nothing else", async () => {
    const { pages } = store();
    const { path } = published(pages, "link", "pr_owner");
    const { wrapper, frame } = await read(pages, path, null);
    expect(frame!.body).toContain(REPORT_SIZE_SOURCE);
    expect(REPORT_SIZE_SOURCE).toContain('"sagax-page-size"');
    for (const network of ["fetch", "XMLHttpRequest", "sendBeacon", "WebSocket", "location"]) expect(REPORT_SIZE_SOURCE).not.toContain(network);
    expect(String(frame!.headers["content-security-policy"])).toContain("connect-src 'none'");
    // the wrapper prints only the frame, at the height it reported
    expect(wrapper.body).toContain("@media print{");
    expect(wrapper.body).toContain(".sagax-bar,.sagax-comments,.sagax-reader-overlay{display:none!important}");
    expect(wrapper.body).toContain("height:var(--sagax-print-height,100vh)!important");
  });

  it("a Markdown reading frame runs only our own scripts, by their nonce", async () => {
    const { pages } = store();
    const { page } = proposed(pages, "pr_owner");
    pages.edit(page.id, { kind: "markdown", content: "# Bilan\n\nTexte", by: "pr_owner" });
    pages.publish(page.id, { version: 2, access: "link", expiresAt: null });
    const path = pages.path(pages.get(page.id)!.linkId!);
    const { wrapper, frame } = await read(pages, path, null);
    expect(wrapper.body).toContain('sandbox="allow-scripts"');
    const csp = String(frame!.headers["content-security-policy"]);
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(frame!.body).toContain(`<script nonce="${nonce}">${REPORT_SIZE_SOURCE}</script>`);
    expect(frame!.body).toContain(`<script nonce="${nonce}">${ANNOTATE_BRIDGE_SOURCE}</script>`);
    expect(frame!.body).toContain(OPEN_BRIDGE_SOURCE);
    expect(frame!.body).toContain(PAGE_OPEN_MESSAGE);
    // our own scripts only (open-link bridge, size, annotate), all by nonce
    expect(frame!.body.match(/<script/g)).toHaveLength(3);
    // our own dark rules are for the screen only: the PDF is on white
    expect(frame!.body).toContain("@media screen and (prefers-color-scheme:dark)");
  });

  it("the app's preview never reports its size", async () => {
    const { pages } = store();
    const { page } = proposed(pages, "pr_owner");
    const wrapper = await hit(options(pages, { principalId: "pr_owner", computerOwner: false }), `/pages/preview/${page.id}/1`);
    const frame = await hit(options(pages, { principalId: "pr_owner", computerOwner: false }), frameSrc(wrapper.body), { "sec-fetch-dest": "iframe" });
    expect(frame.body).not.toContain("sagax-page-size");
    expect(wrapper.body).not.toContain("@media print");
  });

  it("a presentation prints one slide per sheet", async () => {
    const { pages } = store();
    const { page } = proposed(pages, "pr_owner");
    pages.edit(page.id, { kind: "presentation", content: "# Un\n\n---\n\n# Deux\n\n---\n\n# Trois", by: "pr_owner" });
    pages.publish(page.id, { version: 2, access: "link", expiresAt: null });
    const { wrapper, frame } = await read(pages, pages.path(pages.get(page.id)!.linkId!), null);
    expect(wrapper.body).toContain(`@page{size:297mm ${SLIDE_PRINT_MM}mm;margin:0}iframe{height:${3 * SLIDE_PRINT_MM}mm!important}`);
    expect(frame!.body).toContain(`.slide{height:${SLIDE_PRINT_MM}mm;border:0;break-after:page}`);
  });
});

describe("Annotate: threads on a published page (2026-10-28)", () => {
  const OWNER_ID = "pr_owner";
  const ANCHOR = { kind: "text", quote: "Rapport", prefix: "", suffix: "", path: "body > h1", tag: "h1" };
  function threadRoutes(pages: PublishedPages, teams: Record<string, string[]> = {}, extra: { live?: PageLive; onComment?: (input: { by: string; text: string; reply: boolean }) => void } = {}) {
    return createPublishedPageRoutes({
      ...(extra.live ? { live: extra.live } : {}),
      ...(extra.onComment ? { onComment: extra.onComment } : {}),
      pages,
      owner: (auth) => auth.kind === "session" ? auth.session.principalId : undefined,
      isPerson: (auth) => auth.kind === "session" && Boolean(auth.session.principalId),
      origin: () => "https://sagax.example.com",
      reachable: () => true,
      now: () => now,
      reader: (auth) => auth.kind === "session" && auth.session.principalId ? { principalId: auth.session.principalId, computerOwner: false } : null,
      teamsOf: (id) => teams[id] ?? [],
      names: (ids) => Object.fromEntries(ids.map((id) => [id, `name of ${id}`])),
      redact: (text) => text.replace(/sk-[a-z0-9]+/g, "[redacted]"),
    });
  }

  it("an invited reader comments, replies and resolves; the threads name people, never by id alone", async () => {
    const { pages } = store();
    const { id } = published(pages, "private", OWNER_ID);
    pages.setInvites(id, { people: ["pr_reader"], teams: [] }, OWNER_ID);
    const handler = threadRoutes(pages);
    const added = await call(handler, session("pr_reader"), "POST", `/api/pages/${id}/threads`, { anchor: ANCHOR, text: "Clé sk-abc123 à vérifier" });
    expect(added.status).toBe(201);
    const thread = added.body!.threads[0];
    expect(thread).toMatchObject({ by: "pr_reader", version: 1, mine: true, anchor: ANCHOR, text: "Clé [redacted] à vérifier" });
    expect((await call(handler, session(OWNER_ID), "POST", `/api/pages/${id}/threads/${thread.id}/replies`, { text: "Vu" })).status).toBe(201);
    const resolved = await call(handler, session("pr_reader"), "POST", `/api/pages/${id}/threads/${thread.id}/resolve`, { resolved: true });
    expect(resolved.body!.threads[0].resolved.by).toBe("pr_reader");
    const listed = await call(handler, session(OWNER_ID), "GET", `/api/pages/${id}/threads`);
    expect(listed.body).toMatchObject({ owner: true, names: { pr_reader: "name of pr_reader", pr_owner: "name of pr_owner" } });
    expect(listed.body!.threads[0].replies[0]).toMatchObject({ by: OWNER_ID, text: "Vu" });
    // a comment never moves the page in its person's list
    expect(pages.get(id)!.updatedAt).toBe(pages.get(id)!.createdAt);
  });

  it("someone who may not read the page gets the same 404 as a missing page", async () => {
    const { pages } = store();
    const { id } = published(pages, "private", OWNER_ID);
    const handler = threadRoutes(pages);
    expect((await call(handler, session("pr_stranger"), "GET", `/api/pages/${id}/threads`)).status).toBe(404);
    expect((await call(handler, session("pr_stranger"), "POST", `/api/pages/${id}/threads`, { anchor: ANCHOR, text: "x" })).status).toBe(404);
    // a team invited reads and annotates
    pages.setInvites(id, { people: [], teams: ["team_a"] }, OWNER_ID);
    expect((await call(threadRoutes(pages, { pr_stranger: ["team_a"] }), session("pr_stranger"), "GET", `/api/pages/${id}/threads`)).status).toBe(200);
  });

  it("a page not shared yet or past its expiry: its person only", async () => {
    const { pages } = store();
    const { page } = proposed(pages, OWNER_ID);
    const handler = threadRoutes(pages);
    expect((await call(handler, session("pr_reader"), "GET", `/api/pages/${page.id}/threads`)).status).toBe(404);
    expect((await call(handler, session(OWNER_ID), "POST", `/api/pages/${page.id}/threads`, { anchor: ANCHOR, text: "Note" })).status).toBe(201);
    pages.publish(page.id, { version: 1, access: "org", expiresAt: now + 1000 });
    expect((await call(handler, session("pr_reader"), "GET", `/api/pages/${page.id}/threads`)).status).toBe(200);
    now += 2000;
    expect((await call(handler, session("pr_reader"), "GET", `/api/pages/${page.id}/threads`)).status).toBe(404);
  });

  it("only its author or the page's person deletes a thread or a reply", async () => {
    const { pages } = store();
    const { id } = published(pages, "org", OWNER_ID);
    const handler = threadRoutes(pages);
    const thread = (await call(handler, session("pr_a"), "POST", `/api/pages/${id}/threads`, { anchor: ANCHOR, text: "A" })).body!.threads[0];
    const reply = (await call(handler, session("pr_b"), "POST", `/api/pages/${id}/threads/${thread.id}/replies`, { text: "B" })).body!.threads[0].replies[0];
    expect((await call(handler, session("pr_b"), "DELETE", `/api/pages/${id}/threads/${thread.id}`)).status).toBe(403);
    expect((await call(handler, session("pr_a"), "DELETE", `/api/pages/${id}/threads/${thread.id}/replies/${reply.id}`)).status).toBe(403);
    expect((await call(handler, session("pr_b"), "DELETE", `/api/pages/${id}/threads/${thread.id}/replies/${reply.id}`)).status).toBe(200);
    expect((await call(handler, session(OWNER_ID), "DELETE", `/api/pages/${id}/threads/${thread.id}`)).body!.threads).toEqual([]);
  });

  it("a bad anchor or text is refused", async () => {
    const { pages } = store();
    const { id } = published(pages, "org", OWNER_ID);
    const handler = threadRoutes(pages);
    expect((await call(handler, session("pr_a"), "POST", `/api/pages/${id}/threads`, { anchor: { ...ANCHOR, tag: "<x>" }, text: "A" })).status).toBe(400);
    expect((await call(handler, session("pr_a"), "POST", `/api/pages/${id}/threads`, { anchor: { ...ANCHOR, quote: "  " }, text: "A" })).status).toBe(400);
    expect((await call(handler, session("pr_a"), "POST", `/api/pages/${id}/threads`, { anchor: ANCHOR, text: "x".repeat(2001) })).status).toBe(400);
  });

  it("the bar offers Annotate to a signed-in reader who may read it, never to a reader who is not signed in", async () => {
    const { pages } = store();
    const { id, path } = published(pages, "link", OWNER_ID);
    const bootOf = (body: string) => parseReaderBoot(JSON.parse(new RegExp(`<script type="application/json" id="${READER_BOOT_ID}">([^<]*)</script>`).exec(body)![1]!))!;
    const reader = bootOf((await hit(options(pages, { principalId: "pr_reader", computerOwner: false }), path)).body);
    expect(reader).toMatchObject({ pageId: id, can: { share: false, annotate: true } });
    const anon = bootOf((await hit(options(pages, null), path)).body);
    expect(anon.can.annotate).toBe(false);
    expect(anon.pageId).toBeUndefined();
  });

  it("the reading frame carries the annotation bridge, which knows no comment", async () => {
    const { pages } = store();
    const { path } = published(pages, "link", OWNER_ID);
    const { frame } = await read(pages, path, null);
    expect(frame!.body).toContain(ANNOTATE_BRIDGE_SOURCE);
    expect(String(frame!.headers["content-security-policy"])).toContain("connect-src 'none'");
  });
});

describe("live annotations and presence (2026-10-28)", () => {
  const ANCHOR = { kind: "text", quote: "Rapport", prefix: "", suffix: "", path: "body > h1", tag: "h1" };
  function routesWith(pages: PublishedPages, live: PageLive, heard: Array<{ by: string; text: string; reply: boolean }>) {
    return createPublishedPageRoutes({
      pages,
      owner: (auth) => auth.kind === "session" ? auth.session.principalId : undefined,
      isPerson: (auth) => auth.kind === "session" && Boolean(auth.session.principalId),
      origin: () => "https://sagax.example.com",
      reachable: () => true,
      now: () => now,
      reader: (auth) => auth.kind === "session" && auth.session.principalId ? { principalId: auth.session.principalId, computerOwner: false } : null,
      names: (ids) => Object.fromEntries(ids.map((id) => [id, `name of ${id}`])),
      live,
      onComment: ({ by, text, reply }) => heard.push({ by, text, reply }),
    });
  }

  it("a reader who may annotate opens the stream and is seen; someone else gets the 404", async () => {
    const { pages } = store();
    const { id } = published(pages, "private", "pr_owner");
    pages.setInvites(id, { people: ["pr_reader"], teams: [] }, "pr_owner");
    const live = new PageLive();
    const handler = routesWith(pages, live, []);
    const { req, res } = request(`/api/pages/${id}/live`, "GET");
    const frames: string[] = [];
    res.write = ((chunk: unknown) => { frames.push(String(chunk)); return true; }) as typeof res.write;
    await handler({ req, res, url: new URL(`http://x/api/pages/${id}/live`), path: `/api/pages/${id}/live`, method: "GET", auth: session("pr_reader"), json, readBody });
    expect(res.getHeader("content-type")).toBe("text/event-stream");
    expect(live.people(id)).toEqual([{ id: "pr_reader", name: "name of pr_reader" }]);
    expect(frames.join("")).toContain("event: presence");
    req.emit("close");
    expect(live.people(id)).toEqual([]);
    expect((await call(handler, session("pr_stranger"), "GET", `/api/pages/${id}/live`)).status).toBe(404);
  });

  it("a comment tells every open bar and the page's person, never for their own", async () => {
    const { pages } = store();
    const { id } = published(pages, "org", "pr_owner");
    const live = new PageLive();
    const heard: Array<{ by: string; text: string; reply: boolean }> = [];
    const frames: string[] = [];
    live.join(id, { id: "pr_owner", name: "O" }, { write: (frame: string) => { frames.push(frame); return true; }, end: () => undefined } as never);
    const handler = routesWith(pages, live, heard);
    const thread = (await call(handler, session("pr_reader"), "POST", `/api/pages/${id}/threads`, { anchor: ANCHOR, text: "À revoir" })).body!.threads[0];
    expect(frames.at(-1)).toBe("event: threads\ndata: {}\n\n");
    expect(heard).toEqual([{ by: "pr_reader", text: "À revoir", reply: false }]);
    await call(handler, session("pr_owner"), "POST", `/api/pages/${id}/threads/${thread.id}/replies`, { text: "Fait" });
    await call(handler, session("pr_reader"), "POST", `/api/pages/${id}/threads/${thread.id}/replies`, { text: "Merci" });
    expect(heard.map((entry) => entry.text)).toEqual(["À revoir", "Merci"]);
    expect(heard[1]!.reply).toBe(true);
    const before = frames.length;
    await call(handler, session("pr_reader"), "POST", `/api/pages/${id}/threads/${thread.id}/resolve`, { resolved: true });
    expect(frames.length).toBe(before + 1);
  });
});

describe("suggested edits on a Markdown page (2026-10-28)", () => {
  const OWNER_ID = "pr_owner";
  const ANCHOR = { kind: "text", quote: "a augmenté", prefix: "Le volume ", suffix: " ce mois.", path: "body > p", tag: "p" };
  function suggestRoutes(pages: PublishedPages) {
    return createPublishedPageRoutes({
      pages,
      owner: (auth) => auth.kind === "session" ? auth.session.principalId : undefined,
      isPerson: (auth) => auth.kind === "session" && Boolean(auth.session.principalId),
      origin: () => "https://sagax.example.com",
      reachable: () => true,
      now: () => now,
      reader: (auth) => auth.kind === "session" && auth.session.principalId ? { principalId: auth.session.principalId, computerOwner: false } : null,
    });
  }
  function markdownPage(pages: PublishedPages) {
    const { page } = proposed(pages, OWNER_ID);
    pages.edit(page.id, { kind: "markdown", content: "# Bilan\n\nLe volume a augmenté ce mois.", by: OWNER_ID });
    pages.publish(page.id, { version: 2, access: "org", expiresAt: null });
    return page.id;
  }

  it("a reader suggests; only the page's person accepts, and the shared page has the new words at once", async () => {
    const { pages } = store();
    const id = markdownPage(pages);
    const handler = suggestRoutes(pages);
    const made = await call(handler, session("pr_reader"), "POST", `/api/pages/${id}/threads`, { anchor: ANCHOR, text: "", suggestion: "a doublé" });
    expect(made.status).toBe(201);
    const thread = made.body!.threads[0];
    expect(thread.suggestion).toEqual({ text: "a doublé", state: "open" });
    expect((await call(handler, session("pr_reader"), "POST", `/api/pages/${id}/threads/${thread.id}/accept`, {})).status).toBe(403);
    const accepted = await call(handler, session(OWNER_ID), "POST", `/api/pages/${id}/threads/${thread.id}/accept`, {});
    expect(accepted.status).toBe(200);
    expect(accepted.body!.version).toBe(3);
    expect(accepted.body!.threads[0].suggestion).toMatchObject({ state: "accepted", version: 3 });
    expect(accepted.body!.threads[0].resolved.by).toBe(OWNER_ID);
    const page = pages.get(id)!;
    expect(page).toMatchObject({ status: "published", currentVersion: 3, access: "org" });
    expect(pages.content(id, 3)).toBe("# Bilan\n\nLe volume a doublé ce mois.");
    expect(page.versions.at(-1)!.author).toBe("person");
    // decided once
    expect((await call(handler, session(OWNER_ID), "POST", `/api/pages/${id}/threads/${thread.id}/decline`, {})).status).toBe(409);
  });

  it("declined, or no longer in the page: nothing changes", async () => {
    const { pages } = store();
    const id = markdownPage(pages);
    const handler = suggestRoutes(pages);
    const first = (await call(handler, session("pr_reader"), "POST", `/api/pages/${id}/threads`, { anchor: ANCHOR, text: "Plus juste", suggestion: "a doublé" })).body!.threads[0];
    const declined = await call(handler, session(OWNER_ID), "POST", `/api/pages/${id}/threads/${first.id}/decline`, {});
    expect(declined.body!.threads[0].suggestion.state).toBe("declined");
    const gone = (await call(handler, session("pr_reader"), "POST", `/api/pages/${id}/threads`, { anchor: { ...ANCHOR, quote: "absent du texte" }, text: "", suggestion: "x" })).body!.threads[1];
    const refused = await call(handler, session(OWNER_ID), "POST", `/api/pages/${id}/threads/${gone.id}/accept`, {});
    expect(refused).toMatchObject({ status: 409, body: { code: "suggestion_not_found" } });
    expect(pages.get(id)!.currentVersion).toBe(2);
  });

  it("an HTML page takes comments, not suggestions; a suggestion equal to the words is refused", async () => {
    const { pages } = store();
    const { id } = published(pages, "org", OWNER_ID);
    const handler = suggestRoutes(pages);
    expect((await call(handler, session("pr_reader"), "POST", `/api/pages/${id}/threads`, { anchor: ANCHOR, text: "", suggestion: "a doublé" })).body).toMatchObject({ code: "not_suggestable" });
    const md = markdownPage(pages);
    expect((await call(handler, session("pr_reader"), "POST", `/api/pages/${md}/threads`, { anchor: ANCHOR, text: "", suggestion: "a augmenté" })).body).toMatchObject({ code: "bad_suggestion" });
  });
});

describe("a reader who is not signed in (#1486)", () => {
  const signIn = (pages: PublishedPages, viewer: PageViewer): PublicPageOptions => ({ ...options(pages, viewer), signInPath: (path) => `/auth/oidc/start?client=web&return=${encodeURIComponent(path)}` });

  it("an \"anyone with the link\" page opens without signing in", async () => {
    const { pages } = store();
    const { path } = published(pages, "link", "pr_owner");
    const wrapper = await hit(signIn(pages, null), path);
    expect(wrapper.status).toBe(200);
    expect(wrapper.body).toContain("sagax-bar");
  });

  it("a page they may not read yet: the same 404, with a sign-in that comes back to this link", async () => {
    const { pages } = store();
    const { path } = published(pages, "org", "pr_owner");
    const answer = await hit(signIn(pages, null), path);
    expect(answer.status).toBe(404);
    expect(answer.body).toContain(`href="/auth/oidc/start?client=web&amp;return=${encodeURIComponent(path)}"`);
    // an unknown link reads the same: nothing says which pages exist
    const unknown = await hit(signIn(pages, null), "/pages/view/nope");
    expect(unknown.body).toContain("/auth/oidc/start?client=web&amp;return=%2Fpages%2Fview%2Fnope");
    // a signed-in reader without access gets no sign-in link
    expect((await hit(signIn(pages, { principalId: "pr_stranger", computerOwner: false }), path)).body).not.toContain("/auth/oidc/start");
    // a one-person server has no web sign-in to offer
    expect((await hit(options(pages, null), path)).body).not.toContain("/auth/oidc/start");
  });
});

describe("a page's shared state (#1544)", () => {
  const OWNER_ID = "pr_owner";
  function stateRoutes(pages: PublishedPages, live?: PageLive) {
    return createPublishedPageRoutes({
      pages,
      owner: (auth) => auth.kind === "session" ? auth.session.principalId : undefined,
      isPerson: (auth) => auth.kind === "session" && Boolean(auth.session.principalId),
      origin: () => "https://sagax.example.com",
      reachable: () => true,
      now: () => now,
      reader: (auth) => auth.kind === "session" && auth.session.principalId ? { principalId: auth.session.principalId, computerOwner: false } : null,
      names: (ids) => Object.fromEntries(ids.map((id) => [id, id === "pr_reader" ? "Reader" : "Someone"])),
      ...(live ? { live } : {}),
    });
  }
  const readState = async (pages: PublishedPages, path: string, viewer: PageViewer) => {
    const answer = await hit({ ...options(pages, viewer), personName: (id) => (id === "pr_reader" ? "Reader" : "Someone") }, path.replace("/pages/view/", "/pages/state/"));
    return { status: answer.status, body: JSON.parse(answer.body) };
  };

  it("a signed-in reader takes a ticket; it stays, and every reader sees it with the name, never the id", async () => {
    const { pages } = store();
    const { id, path } = published(pages, "link", OWNER_ID);
    const live = new PageLive();
    const frames: string[] = [];
    live.join(id, { id: OWNER_ID, name: "O" }, { write: (frame: string) => { frames.push(frame); return true; }, end: () => undefined } as never);
    const handler = stateRoutes(pages, live);
    const set = await call(handler, session("pr_reader"), "PUT", `/api/pages/${id}/state`, { key: "ticket:4242", value: { taken: true } });
    expect(set.status).toBe(200);
    expect(set.body!.entries["ticket:4242"]).toMatchObject({ value: { taken: true }, name: "Reader", at: now });
    expect(frames.at(-1)).toBe("event: state\ndata: {}\n\n");
    // a reader who is not signed in reads it (refresh, another person)
    const anon = await readState(pages, path, null);
    expect(anon.status).toBe(200);
    expect(anon.body.entries["ticket:4242"]).toEqual({ value: { taken: true }, name: "Reader", at: now, who: expect.stringMatching(/^[\w-]{12}$/) });
    expect(JSON.stringify(anon.body)).not.toContain("pr_reader");
    // null clears
    await call(handler, session("pr_reader"), "PUT", `/api/pages/${id}/state`, { key: "ticket:4242", value: null });
    expect((await readState(pages, path, null)).body.entries).toEqual({});
  });

  it("only who may annotate writes; who may not read gets the 404", async () => {
    const { pages } = store();
    const { id, path } = published(pages, "private", OWNER_ID);
    const handler = stateRoutes(pages);
    expect((await call(handler, session("pr_stranger"), "PUT", `/api/pages/${id}/state`, { key: "k", value: 1 })).status).toBe(404);
    expect((await readState(pages, path, null)).status).toBe(404);
    expect((await readState(pages, path, { principalId: OWNER_ID, computerOwner: false })).status).toBe(200);
  });

  it("keys, sizes and rate are capped; revoking erases it", async () => {
    const { pages } = store();
    const { id } = published(pages, "org", OWNER_ID);
    const handler = stateRoutes(pages);
    expect((await call(handler, session("pr_a"), "PUT", `/api/pages/${id}/state`, { key: "<x>", value: 1 })).status).toBe(400);
    expect((await call(handler, session("pr_a"), "PUT", `/api/pages/${id}/state`, { key: "k", value: "x".repeat(5000) })).status).toBe(400);
    for (let i = 0; i < 60; i += 1) expect((await call(handler, session("pr_a"), "PUT", `/api/pages/${id}/state`, { key: `k${i % 3}`, value: i })).status).toBe(200);
    expect((await call(handler, session("pr_a"), "PUT", `/api/pages/${id}/state`, { key: "k", value: 1 })).body).toMatchObject({ code: "too_many_writes" });
    expect((await call(handler, session("pr_b"), "PUT", `/api/pages/${id}/state`, { key: "k", value: 1 })).status).toBe(200);
    pages.revoke(id);
    expect(pages.state(id)).toEqual({});
  });

  it("the reading frame has window.sagax.page before the page's own scripts; the preview has none", async () => {
    const { pages } = store();
    const { path } = published(pages, "link", OWNER_ID);
    const { frame } = await read(pages, path, null);
    const bridge = frame!.body.indexOf(STATE_BRIDGE_SOURCE);
    expect(bridge).toBeGreaterThan(0);
    expect(bridge).toBeLessThan(frame!.body.indexOf("<h1>Rapport</h1>"));
    const { page } = proposed(pages, OWNER_ID);
    const preview = await hit(options(pages, { principalId: OWNER_ID, computerOwner: false }), `/pages/preview/${page.id}/1`);
    const previewFrame = await hit(options(pages, { principalId: OWNER_ID, computerOwner: false }), frameSrc(preview.body), { "sec-fetch-dest": "iframe" });
    expect(previewFrame.body).not.toContain("sagax-state-ask");
  });
});

// The reader's bar in its person's look (2026-10-29): "ça devrait suivre le
// thème de Sagax du user qui est le owner de la page".
describe("a reading link in its person's look", () => {
  const LIGHT = { "--code-color-scheme": "light", "--color-panel": "#fbf7ee", "--color-app": "#f3ecdc", "--color-ink": "#2b2418", "--color-accent": "#9a5b13", "--color-accent-ink": "#ffffff", "--radius-xl": "14px", "--font-sans": "\"Geist Variable\", system-ui, sans-serif" };
  const DARK = { "--code-color-scheme": "dark", "--color-panel": "#1d1812", "--color-app": "#15110c", "--color-ink": "#f1e9da", "--color-accent": "#d9a441", "--color-accent-ink": "#1d1812", "--radius-xl": "14px" };

  it("the person's app keeps its look (known tokens, safe values only); each person has their own", async () => {
    const { pages } = store();
    const handler = routes(pages);
    const sent = await call(handler, session("pr_alice"), "PUT", "/api/pages/look", {
      light: { ...LIGHT, "--color-card": "red;}</style><script>alert(1)</script>", "--color-raised": "url(https://evil.example/x)", "--not-a-token": "#000" },
      dark: DARK, skin: "atelier", botAccent: true, extra: "dropped",
    });
    expect(sent.status).toBe(200);
    const kept = (await call(handler, session("pr_alice"), "GET", "/api/pages/look")).body!.look;
    expect(kept.light["--color-panel"]).toBe("#fbf7ee");
    expect(kept.light["--color-card"]).toBeUndefined();
    expect(kept.light["--color-raised"]).toBeUndefined();
    expect(kept.light["--not-a-token"]).toBeUndefined();
    expect(kept.dark["--color-accent"]).toBe("#d9a441");
    expect(kept).toMatchObject({ skin: "atelier", botAccent: true });
    expect(kept.extra).toBeUndefined();
    // another person's look is theirs alone
    expect((await call(handler, session("pr_bob"), "GET", "/api/pages/look")).body!.look).toBeNull();
    // nothing usable: refused, the kept look unchanged
    expect((await call(handler, session("pr_alice"), "PUT", "/api/pages/look", { light: { "--color-panel": "expression(x)" } })).status).toBe(400);
    expect(pages.look("pr_alice")?.light?.["--color-panel"]).toBe("#fbf7ee");
    // a bot's shell or a device that is not a person cannot set one
    expect((await call(handler, serviceLoopback, "PUT", "/api/pages/look", { light: LIGHT })).status).toBe(403);
  });

  it("the bar and the frame wear the person's tokens, light and dark by the reader's system", async () => {
    const { pages } = store();
    pages.setLook("pr_alice", { light: LIGHT, dark: DARK });
    const { path } = published(pages, "link", "pr_alice");
    const { wrapper, frame } = await read(pages, path, null);
    const style = /<style>([\s\S]*?)<\/style>/.exec(wrapper.body)![1]!;
    const light = /:root\{color-scheme:light;([^}]*)\}/.exec(style)![1]!;
    const dark = /@media \(prefers-color-scheme:dark\)\{:root\{color-scheme:dark;([^}]*)\}\}/.exec(style)![1]!;
    expect(light).toContain("--sb-bg:#fbf7ee");
    expect(light).toContain("--sb-app:#f3ecdc");
    expect(light).toContain("--sb-accent:#9a5b13");
    expect(light).toContain("--sb-radius-xl:14px");
    expect(light).toContain('--sb-font:"Geist Variable", system-ui, sans-serif');
    expect(dark).toContain("--sb-bg:#1d1812");
    expect(dark).toContain("--sb-accent:#d9a441");
    // the bar reads them
    expect(style).toContain(".sagax-bar{");
    expect(style).toContain("background:var(--sb-bg)");
    // the page's frame too: its theme (#1551) in the person's colors
    expect(frame!.body).toContain("--background:#fbf7ee");
    expect(frame!.body).toMatch(/prefers-color-scheme:dark\)\{:root\{[^}]*--background:#1d1812/);
    // the warning stays, word for word, in the bar
    expect(wrapper.body).toContain("n&#39;y entrez jamais de mot de passe");
  });

  it("without a look the bar and the frame wear the default theme", async () => {
    const { pages } = store();
    const { path } = published(pages, "link", "pr_alice");
    const { wrapper, frame } = await read(pages, path, null);
    expect(wrapper.body).toContain(`--sb-bg:${fallbackWidgetTokens("light")["--color-panel"]}`);
    expect(wrapper.body).toContain(`--sb-bg:${fallbackWidgetTokens("dark")["--color-panel"]}`);
    expect(frame!.body).toContain(`--background:${fallbackWidgetTokens("light")["--color-panel"]}`);
  });

  it("a skin with one scheme (Hibou 98) is worn in both; square corners give square buttons", async () => {
    const { pages } = store();
    pages.setLook(undefined, { light: { ...LIGHT, "--radius-xl": "0px" } });
    const { path } = published(pages);
    const { wrapper } = await read(pages, path, null);
    expect(wrapper.body.match(/--sb-bg:#fbf7ee/g)?.length).toBe(2);
    expect(wrapper.body).toContain("--sb-pill:0px");
  });

  it("the bot's color as the accent when the person chose it, held to the app's contrast on their panel", async () => {
    const { pages } = store();
    pages.setLook("pr_alice", { light: LIGHT, dark: DARK, botAccent: true });
    const { path } = published(pages, "link", "pr_alice");
    const opts = { ...options(pages, null), bot: () => ({ color: "#ffd84d" }) };
    const wrapper = await hit(opts, path);
    expect(wrapper.body).toContain(`--sb-accent:${holdContrast("#ffd84d", "#fbf7ee", 3)}`);
    expect(wrapper.body).toContain(`--sb-accent:${holdContrast("#ffd84d", "#1d1812", 3)}`);
    expect(wrapper.body).not.toContain("--sb-accent:#9a5b13");
    // off: the skin's own accent
    pages.setLook("pr_alice", { light: LIGHT, dark: DARK });
    expect((await hit(opts, path)).body).toContain("--sb-accent:#9a5b13");
  });

  it("the byline carries the publishing bot's mascot: a dot in its color, then its character", async () => {
    const { pages } = store();
    const { path } = published(pages, "link", "pr_alice");
    const look = { character: "shape", shape: "star", skins: { shape: "glossy" } };
    const wrapper = await hit({ ...options(pages, null), bot: () => ({ color: "green", look }) }, path);
    expect(wrapper.body).toContain(`id="${READER_MASCOT_ID}"`);
    expect(wrapper.body).toMatch(/<span class="sagax-bar-dot" style="background:#[0-9a-f]{6}"><\/span>/);
    expect(wrapper.body).toContain("<b>Scout</b>");
    const boot = parseReaderBoot(JSON.parse(new RegExp(`<script type="application/json" id="${READER_BOOT_ID}">([^<]*)</script>`).exec(wrapper.body)![1]!));
    expect(boot?.bot).toEqual({ name: "Scout", color: "green", look });
    // a color that is not a mascot color or #rrggbb: no dot, no bot
    const odd = await hit({ ...options(pages, null), bot: () => ({ color: "red;background:url(x)" }) }, path);
    expect(odd.body).not.toContain("<span class=\"sagax-bar-dot\"");
    expect(parseReaderBoot(JSON.parse(new RegExp(`<script type="application/json" id="${READER_BOOT_ID}">([^<]*)</script>`).exec(odd.body)![1]!))?.bot).toBeUndefined();
  });

  it("the app's own preview never takes it: its theme and skin come from the app", async () => {
    const { pages } = store();
    pages.setLook(undefined, { light: LIGHT, dark: DARK });
    const { page } = proposed(pages);
    const wrapper = await hit(options(pages, OWNER), `/pages/preview/${page.id}/1?bare=1&theme=dark`);
    expect(wrapper.status).toBe(200);
    expect(wrapper.body).not.toContain("--sb-bg");
    const frame = await hit(options(pages, OWNER), frameSrc(wrapper.body), { "sec-fetch-dest": "iframe" });
    expect(frame.body).not.toContain("#fbf7ee");
  });
});

describe("who writes a page's state: the page's declaration within its sharing (2026-10-29)", () => {
  const OWNER_ID = "pr_owner";
  const DECLARED = `<!doctype html><html><body><h1>Vote</h1><script type="application/sagax-state+json">{"vote:*":"anyone","note":{"write":"signed_in"},"decision":"editors","budget":"owner"}</script></body></html>`;
  const BROWSER = "b".repeat(22);
  function page(pages: PublishedPages, access: "private" | "org" | "link", content = DECLARED) {
    const { page: proposal } = proposed(pages, OWNER_ID, { content });
    pages.publish(proposal.id, { version: 1, access, expiresAt: null });
    return { id: proposal.id, path: pages.path(pages.get(proposal.id)!.linkId!) };
  }
  function stateRoutes(pages: PublishedPages) {
    return createPublishedPageRoutes({
      pages,
      owner: (auth) => auth.kind === "session" ? auth.session.principalId : undefined,
      isPerson: (auth) => auth.kind === "session" && Boolean(auth.session.principalId),
      origin: () => "https://sagax.example.com",
      reachable: () => true,
      now: () => now,
      reader: (auth) => auth.kind === "session" && auth.session.principalId ? { principalId: auth.session.principalId, computerOwner: false } : null,
      names: (ids) => Object.fromEntries(ids.map((id) => [id, id === "pr_reader" ? "Reader" : id === "pr_editor" ? "Editor" : "Someone"])),
    });
  }
  /** A write on the public link, as the wrapper of a reader not signed in sends it. */
  async function anonWrite(pages: PublishedPages, path: string, body: unknown, headers: Record<string, string> = {}, changed?: string[]) {
    const statePath = path.replace("/pages/view/", "/pages/state/");
    const { req, res, done } = request(statePath, "PUT", { host: "sagax.example.com", "accept-language": "fr-CA", "content-type": "application/json", "x-sagax-reader": BROWSER, ...headers });
    process.nextTick(() => {
      req.push(JSON.stringify(body));
      req.push(null);
    });
    const opts: PublicPageOptions = { ...options(pages, null), ...(changed ? { stateChanged: (id: string) => { changed.push(id); } } : {}) };
    expect(handlePublishedPagePublic(opts, req, res, statePath, "PUT")).toBe(true);
    const answer = await done;
    return { status: answer.status, body: JSON.parse(answer.body) as Record<string, any> };
  }
  const readState = async (pages: PublishedPages, path: string, viewer: PageViewer, headers: Record<string, string> = {}) => {
    const answer = await hit(options(pages, viewer), path.replace("/pages/view/", "/pages/state/"), headers);
    return { status: answer.status, body: JSON.parse(answer.body) as Record<string, any> };
  };
  const put = (handler: ReturnType<typeof stateRoutes>, who: string, id: string, key: string, value: unknown) =>
    call(handler, session(who), "PUT", `/api/pages/${id}/state`, { key, value });

  it("anyone: a reader not signed in votes on a public link, written as Anonyme with a hash of the browser, never more", async () => {
    const { pages } = store();
    const { id, path } = page(pages, "link");
    const changed: string[] = [];
    const first = await readState(pages, path, null, { "x-sagax-reader": BROWSER });
    expect(first.body.access).toEqual({ role: "anon", rules: { "vote:*": "anyone", note: "signed_in", decision: "editors", budget: "owner" }, locked: [], publicLink: true });
    const me = first.body.me as string;
    expect(me).toMatch(/^[\w-]{12}$/);
    const vote = await anonWrite(pages, path, { key: `vote:${me}`, value: "yes" }, {}, changed);
    expect(vote.status).toBe(200);
    expect(vote.body.entries[`vote:${me}`]).toMatchObject({ value: "yes", name: "Anonyme", who: me });
    expect(changed).toEqual([id]);
    // stored as a hash of the browser's own id, nothing else
    const by = pages.state(id)[`vote:${me}`]!.by;
    expect(by).toMatch(/^anon:[\w-]{16}$/);
    expect(by).not.toContain(BROWSER);
    expect(JSON.stringify(vote.body)).not.toContain(by);
    // another reader sees it, named Anonyme
    expect((await readState(pages, path, { principalId: "pr_reader", computerOwner: false })).body.entries[`vote:${me}`].name).toBe("Anonyme");
    // every other key keeps its level: not signed in is refused
    for (const key of ["note", "decision", "budget", "undeclared"]) {
      expect(await anonWrite(pages, path, { key, value: 1 })).toMatchObject({ status: 403, body: { code: "sign_in" } });
    }
  });

  it("anyone is refused to a reader not signed in when the link is not public", async () => {
    const { pages } = store();
    for (const access of ["org", "private"] as const) {
      const { path } = page(pages, access);
      expect((await anonWrite(pages, path, { key: "vote:x", value: "yes" })).status).toBe(404);
      expect((await readState(pages, path, null)).status).toBe(404);
    }
    // a public link the organization turned off reads as "org": refused too
    const { path } = page(pages, "link");
    pages.setPolicy({ linkSharing: false });
    expect((await anonWrite(pages, path, { key: "vote:x", value: "yes" })).status).toBe(404);
    pages.setPolicy({ linkSharing: true });
    expect((await anonWrite(pages, path, { key: "vote:x", value: "yes" })).status).toBe(200);
  });

  it("anyone on an organization page: anyone signed in who may read it writes", async () => {
    const { pages } = store();
    const { id } = page(pages, "org");
    expect((await put(stateRoutes(pages), "pr_reader", id, "vote:r", "no")).status).toBe(200);
  });

  it("signed_in, the default: a signed-in reader writes, a reader not signed in does not", async () => {
    const { pages } = store();
    const { id, path } = page(pages, "link", HTML);
    const handler = stateRoutes(pages);
    expect((await put(handler, "pr_reader", id, "anything", 1)).status).toBe(200);
    expect((await put(handler, "pr_reader", id, "note", 1)).status).toBe(200);
    expect(await anonWrite(pages, path, { key: "anything", value: 2 })).toMatchObject({ status: 403, body: { code: "sign_in" } });
    expect(pages.state(id).anything!.value).toBe(1);
  });

  it("editors and owner: a listed editor writes editors keys, never owner keys (#1704)", async () => {
    const { pages } = store();
    const { id } = page(pages, "org");
    const handler = stateRoutes(pages);
    // without a listed editor, a signed-in reader matches neither level
    for (const key of ["decision", "budget"]) {
      expect(await put(handler, "pr_reader", id, key, "go")).toMatchObject({ status: 403, body: { code: "not_allowed" } });
    }
    expect(pages.setEditors(id, ["pr_editor"])).toMatchObject({ id });
    // the declared level stays "editors", never rewritten to "owner"
    expect(pages.stateRules(id).decision).toBe("editors");
    expect(pages.stateRules(id).budget).toBe("owner");
    const asEditor = await put(handler, "pr_editor", id, "decision", "go");
    expect(asEditor.status).toBe(200);
    expect(asEditor.body!.access.role).toBe("editor");
    expect(asEditor.body!.access.rules.decision).toBe("editors");
    expect(await put(handler, "pr_editor", id, "budget", "go")).toMatchObject({ status: 403, body: { code: "not_allowed" } });
    // a plain reader still cannot write editors keys
    expect(await put(handler, "pr_reader", id, "decision", "no")).toMatchObject({ status: 403, body: { code: "not_allowed" } });
    const answer = await put(handler, OWNER_ID, id, "budget", "done");
    expect(answer.status).toBe(200);
    expect(answer.body!.access.role).toBe("owner");
    expect(answer.body!.entries.budget).toMatchObject({ value: "done", name: "Someone" });
  });

  it("a declaration in the browser is not one: the server reads only the published version", async () => {
    const { pages } = store();
    const { id, path } = page(pages, "link", HTML);
    // the reader cannot make a key "anyone" by sending rules along
    expect((await anonWrite(pages, path, { key: "vote:x", value: 1, rules: { "vote:*": "anyone" } })).status).toBe(403);
    expect(pages.stateRules(id)).toEqual({});
  });

  it("writes not signed in: the browser's id, this host only, 1 KB, 20 a minute, 100 keys", async () => {
    const { pages } = store();
    const { id, path } = page(pages, "link");
    expect((await anonWrite(pages, path, { key: "vote:a", value: 1 }, { "x-sagax-reader": "short" })).status).toBe(400);
    expect((await anonWrite(pages, path, { key: "vote:a", value: 1 }, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await anonWrite(pages, path, { key: "vote:a", value: 1 }, { origin: "https://elsewhere.example" })).status).toBe(403);
    expect((await anonWrite(pages, path, { key: "vote:a", value: "x".repeat(1100) })).body.code).toBe("bad_value");
    for (let i = 0; i < 20; i += 1) expect((await anonWrite(pages, path, { key: `vote:${i % 4}`, value: i })).status).toBe(200);
    expect(await anonWrite(pages, path, { key: "vote:a", value: 1 })).toMatchObject({ status: 429, body: { code: "too_many_writes" } });
    // the cap on keys set without signing in, whatever the browser
    now += 61_000;
    for (let i = 0; i < 96; i += 1) {
      const answer = await anonWrite(pages, path, { key: `vote:k${i}`, value: 1 }, { "x-sagax-reader": `reader-${String(i).padStart(12, "0")}` });
      expect(answer.status).toBe(200);
    }
    expect(Object.keys(pages.state(id))).toHaveLength(100);
    expect((await anonWrite(pages, path, { key: "vote:one-more", value: 1 }, { "x-sagax-reader": "c".repeat(20) })).body.code).toBe("too_many_keys");
    // a person signed in still writes a new key
    expect((await put(stateRoutes(pages), "pr_reader", id, "vote:person", 1)).status).toBe(200);
  });

  it("the page's person makes a key read-only and clears the state; nobody else can", async () => {
    const { pages } = store();
    const { id, path } = page(pages, "link");
    const handler = stateRoutes(pages);
    expect((await anonWrite(pages, path, { key: "vote:a", value: "yes" })).status).toBe(200);
    expect((await call(handler, session("pr_reader"), "PUT", `/api/pages/${id}/state/lock`, { key: "vote:a", locked: true })).status).toBe(403);
    expect((await call(handler, session("pr_reader"), "DELETE", `/api/pages/${id}/state`)).status).toBe(403);
    const locked = await call(handler, session(OWNER_ID), "PUT", `/api/pages/${id}/state/lock`, { key: "vote:a", locked: true });
    expect(locked.body!.access.locked).toEqual(["vote:a"]);
    expect(await anonWrite(pages, path, { key: "vote:a", value: "no" })).toMatchObject({ status: 403, body: { code: "locked" } });
    expect(await put(handler, OWNER_ID, id, "vote:a", "no")).toMatchObject({ status: 403, body: { code: "locked" } });
    expect((await readState(pages, path, null)).body.access.locked).toEqual(["vote:a"]);
    await call(handler, session(OWNER_ID), "PUT", `/api/pages/${id}/state/lock`, { key: "vote:a", locked: false });
    expect((await anonWrite(pages, path, { key: "vote:a", value: "no" })).status).toBe(200);
    const cleared = await call(handler, session(OWNER_ID), "DELETE", `/api/pages/${id}/state`);
    expect(cleared.status).toBe(200);
    expect(cleared.body!.entries).toEqual({});
    expect(pages.state(id)).toEqual({});
  });

  it("PATCH editors: the person lists who may edit; an editor saves a version (#1704)", async () => {
    const { pages } = store();
    const { id } = page(pages, "org");
    const handler = stateRoutes(pages);
    const patched = await call(handler, session(OWNER_ID), "PATCH", `/api/pages/${id}`, { editors: ["pr_editor", OWNER_ID, "pr_editor"] });
    expect(patched.status).toBe(200);
    expect(patched.body!.page.editors).toEqual(["pr_editor"]);
    expect((await call(handler, session("pr_reader"), "PATCH", `/api/pages/${id}`, { editors: ["pr_x"] })).status).toBe(404);
    const source = await call(handler, session("pr_editor"), "GET", `/api/pages/${id}/versions/1/source`);
    expect(source.status).toBe(200);
    expect(source.body!.content).toContain("sagax-state+json");
    const edited = await call(handler, session("pr_editor"), "POST", `/api/pages/${id}/versions`, {
      kind: "html",
      content: `${DECLARED}<p>from editor</p>`,
    });
    expect(edited.status).toBe(201);
    expect(edited.body!.version).toBe(2);
    // share stays with the page's person
    expect((await call(handler, session("pr_editor"), "POST", `/api/pages/${id}/share`, { audience: "org" })).status).toBe(404);
  });
});
