// "Always allow this site" on a page's link card (#3413): per reader, page
// and host, kept by the server; the person only, never a bot's act session;
// a reader not signed in or who may not read the page gets the same refusal
// as for data; an approval never covers a subdomain or another host; revoke
// forgets them.
import { appendFileSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { RequestAuth } from "../auth/request-auth.ts";
import { normalizePageLinkOrigin } from "../../shared/page-capabilities.ts";
import { PageDataApprovals } from "../pages/page-data-approvals.ts";
import { PAGE_LINK_APPROVALS_PER_READER_PAGE, PageLinkApprovals } from "../pages/page-link-approvals.ts";
import { PageSources } from "../pages/page-sources.ts";
import { PublishedPages, type PageRecord } from "../pages/published-pages.ts";
import { createPageDataRoutes, type PageDataRouteDeps } from "./page-data.ts";
import type { RouteContext } from "./table.ts";

const NOW = 1_800_000_000_000;
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const as = (principalId: string | null, act = false) => ({ kind: "session", via: "cookie", scopes: ["client"], session: { principalId, ...(act ? { ephemeral: true, label: "Bot act" } : {}) } }) as unknown as RequestAuth;

function page(over: Partial<PageRecord> = {}): PageRecord {
  return { id: "page-1", ownerId: "person-a", botId: "lead-bot", threadId: "t", access: "org", status: "published", currentVersion: 1, expiresAt: null, versions: [{ n: 1, kind: "html", title: "Board" }], ...over } as unknown as PageRecord;
}

function world(options: { record?: PageRecord; file?: string } = {}) {
  const record = options.record ?? page();
  const links = new PageLinkApprovals(options.file ?? null, () => NOW);
  const deps: PageDataRouteDeps = {
    pages: {
      get: (id) => (id === record.id ? record : undefined),
      capabilities: () => null,
      policy: () => ({ linkSharing: true, readerComments: true }) as ReturnType<PageDataRouteDeps["pages"]["policy"]>,
      readerHandle: (_pageId, by) => `h-${by}`,
    },
    reader: (auth) => {
      const id = (auth as { session: { principalId: string | null } }).session.principalId;
      return id ? { principalId: id, computerOwner: false } : null;
    },
    botAct: (auth) => (auth as { session: { ephemeral?: boolean } }).session.ephemeral === true,
    sources: new PageSources(),
    approvals: new PageDataApprovals(null, () => NOW),
    links,
    now: () => NOW,
  };
  return { routes: createPageDataRoutes(deps), links };
}

async function call(routes: ReturnType<typeof createPageDataRoutes>, auth: RequestAuth, path: string, method = "GET", body: unknown = null) {
  const sent: Array<{ status: number; body: unknown }> = [];
  const url = new URL(`http://x${path}`);
  const context = {
    req: { headers: {} } as unknown as IncomingMessage,
    res: { setHeader() {} } as unknown as ServerResponse,
    url,
    path: url.pathname,
    method,
    auth,
    json: ((_res: unknown, status: number, payload: unknown) => { sent.push({ status, body: payload }); }) as RouteContext["json"],
    readBody: (async () => body) as RouteContext["readBody"],
  } satisfies RouteContext;
  await routes(context);
  return { status: sent[0]?.status, body: sent[0]?.body as Record<string, unknown> };
}

const ROUTE = "/api/pages/page-1/link-approvals";
const q = (origin: string) => `${ROUTE}?${new URLSearchParams({ origin })}`;

describe("link approvals: Always allow this site, by origin", () => {
  it("keeps an approval for the reader, page and origin, and lets them forget it", async () => {
    const { routes } = world();
    expect((await call(routes, as("person-b"), q("https://docs.example.com"))).body).toEqual({ allowed: false });
    expect((await call(routes, as("person-b"), ROUTE, "POST", { origin: "https://Docs.Example.com", answer: "always" })).body).toEqual({ ok: true });
    expect((await call(routes, as("person-b"), q("https://docs.example.com"))).body).toEqual({ allowed: true });
    expect((await call(routes, as("person-b"), q("https://docs.example.com:443"))).body).toEqual({ allowed: true });
    expect((await call(routes, as("person-b"), q("https://docs.example.com"), "DELETE")).body).toEqual({ ok: true });
    expect((await call(routes, as("person-b"), q("https://docs.example.com"))).body).toEqual({ allowed: false });
  });

  it("never opens another scheme, port, host, subdomain or person (second review)", async () => {
    const { routes } = world();
    await call(routes, as("person-b"), ROUTE, "POST", { origin: "https://example.com", answer: "always" });
    for (const other of ["http://example.com", "https://example.com:8080", "http://example.com:8080", "https://docs.example.com", "https://example.org", "https://example.com.evil.net"]) {
      expect((await call(routes, as("person-b"), q(other))).body, other).toEqual({ allowed: false });
    }
    expect((await call(routes, as("person-c"), q("https://example.com"))).body).toEqual({ allowed: false });
  });

  it("answers 400, not allowed false, to the old host parameter, so the old client hides the option", async () => {
    const { routes } = world();
    const old = await call(routes, as("person-b"), `${ROUTE}?host=example.com`);
    expect(old.status).toBe(400);
    expect(old.body.code).toBe("origin_required");
    expect((await call(routes, as("person-b"), ROUTE, "POST", { host: "example.com", answer: "always" })).status).toBe(400);
  });

  it("refuses a bot's act session, to read, write or forget", async () => {
    const { routes, links } = world();
    const write = await call(routes, as("person-b", true), ROUTE, "POST", { origin: "https://example.com", answer: "always" });
    expect(write.status).toBe(403);
    expect(write.body.code).toBe("person_only");
    expect(links.allowed("person-b", "page-1", "https://example.com")).toBe(false);
    expect((await call(routes, as("person-b", true), q("https://example.com"))).status).toBe(403);
    expect((await call(routes, as("person-b", true), q("https://example.com"), "DELETE")).status).toBe(403);
  });

  it("gives a reader not signed in, or who may not read the page, the same refusal as for data", async () => {
    const { routes } = world({ record: page({ access: "private" }) });
    const anon = await call(routes, as(null), q("https://example.com"));
    expect(anon.status).toBe(401);
    expect(anon.body.code).toBe("sign_in");
    const stranger = await call(routes, as("person-b"), ROUTE, "POST", { origin: "https://example.com", answer: "always" });
    expect(stranger.status).toBe(404);
    expect(stranger.body.code).toBe("not_found");
  });

  it("refuses a value that is not an http or https origin, and an answer it does not know", async () => {
    const { routes } = world();
    for (const bad of ["javascript:alert(1)", "example.com", "https://example.com/path", "https://u:p@example.com", "ftp://example.com", ""]) {
      expect((await call(routes, as("person-b"), ROUTE, "POST", { origin: bad, answer: "always" })).status, bad).toBe(400);
    }
    expect((await call(routes, as("person-b"), ROUTE, "POST", { origin: "https://example.com", answer: "once" })).status).toBe(400);
  });
});

describe("link approvals: bounds (second review)", () => {
  it("keeps at most 50 sites per reader and page, dropping only that reader's oldest on that page", () => {
    const links = new PageLinkApprovals(null, () => NOW);
    links.allow("person-a", "page-1", "https://a.example");
    links.allow("person-b", "page-2", "https://b.example");
    for (let index = 0; index < 1_000; index++) links.allow("person-b", "page-1", `https://site${index}.example`);
    expect(PAGE_LINK_APPROVALS_PER_READER_PAGE).toBe(50);
    expect(links.count("person-b", "page-1")).toBe(50);
    expect(links.allowed("person-b", "page-1", "https://site999.example")).toBe(true);
    expect(links.allowed("person-b", "page-1", "https://site0.example")).toBe(false);
    // nobody else lost anything, nor the same reader on another page
    expect(links.allowed("person-a", "page-1", "https://a.example")).toBe(true);
    expect(links.allowed("person-b", "page-2", "https://b.example")).toBe(true);
  });

  it("appends one line per answer instead of rewriting the file, and reads it back", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-link-approvals-"));
    dirs.push(dir);
    const file = join(dir, "page-link-approvals.jsonl");
    const links = new PageLinkApprovals(file, () => NOW);
    links.allow("person-b", "page-1", "https://a.example");
    const one = statSync(file).size;
    links.allow("person-b", "page-1", "https://b.example");
    const two = statSync(file).size;
    expect(readFileSync(file, "utf8").split("\n").filter(Boolean)).toHaveLength(2);
    expect(two - one).toBeLessThan(200);
    links.forget("person-b", "page-1", "https://a.example");
    const again = new PageLinkApprovals(file, () => NOW);
    expect(again.allowed("person-b", "page-1", "https://a.example")).toBe(false);
    expect(again.allowed("person-b", "page-1", "https://b.example")).toBe(true);
  });
});

describe("link and data approvals go with the page (second review)", () => {
  function pagesIn(dir: string) {
    const pages = new PublishedPages(dir, () => NOW);
    const made = pages.propose({ ownerId: "person-a", botId: "lead", threadId: "t", title: "P", kind: "html", content: "<p>x</p>" });
    if (!made.ok) throw new Error(made.error);
    pages.publish(made.page.id, { version: made.version.n, access: "org", expiresAt: null });
    return { pages, id: made.page.id };
  }

  it("forgets a page's link approvals when it is revoked or deleted, and its data approvals when deleted", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-link-approvals-"));
    dirs.push(dir);
    const links = new PageLinkApprovals(join(dir, "links.jsonl"), () => NOW);
    const data = new PageDataApprovals(join(dir, "data.json"), () => NOW);
    const revoked = pagesIn(dir);
    const deleted = pagesIn(dir);
    revoked.pages.onRevoked((id) => links.forgetPage(id));
    deleted.pages.onRemoved((id) => { links.forgetPage(id); data.forgetPage(id); });
    links.allow("person-b", revoked.id, "https://example.com");
    links.allow("person-b", deleted.id, "https://example.com");
    links.allow("person-b", "other", "https://example.com");
    const ask = { person: "person-b", pageId: deleted.id, version: 1, source: "team-board" };
    data.answer(data.open(ask), "person-b", { allow: true, always: true });
    expect(data.allowed(ask)).toBe(true);
    revoked.pages.revoke(revoked.id);
    expect(links.allowed("person-b", revoked.id, "https://example.com")).toBe(false);
    expect(deleted.pages.remove(deleted.id)).toBe(true);
    expect(links.allowed("person-b", deleted.id, "https://example.com")).toBe(false);
    expect(data.allowed(ask)).toBe(false);
    expect(new PageDataApprovals(join(dir, "data.json"), () => NOW).allowed(ask)).toBe(false);
    expect(links.allowed("person-b", "other", "https://example.com")).toBe(true);
  });

  it("does not fail a revoke when a listener throws", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-link-approvals-"));
    dirs.push(dir);
    const { pages, id } = pagesIn(dir);
    pages.onRevoked(() => { throw new Error("disk full"); });
    expect("ok" in pages.revoke(id)).toBe(false);
  });
});

describe("normalizePageLinkOrigin", () => {
  it("keeps scheme, host and port, default ports folded, lower case, punycode as is; http and https only", () => {
    expect(normalizePageLinkOrigin("https://Docs.Example.COM")).toBe("https://docs.example.com");
    expect(normalizePageLinkOrigin("https://example.com:443")).toBe("https://example.com");
    expect(normalizePageLinkOrigin("http://example.com:80/")).toBe("http://example.com");
    expect(normalizePageLinkOrigin("https://example.com:8443")).toBe("https://example.com:8443");
    expect(normalizePageLinkOrigin("https://xn--bcher-kva.example")).toBe("https://xn--bcher-kva.example");
    for (const bad of ["example.com", "https://example.com/a", "https://example.com/?x", "https://example.com/#x", "https://u:p@example.com", "ftp://example.com", "mailto:a@example.com", "", 42]) {
      expect(normalizePageLinkOrigin(bad), String(bad)).toBeNull();
    }
  });
});

describe("link approvals journal: a cut line (third review)", () => {
  function cutJournal() {
    const dir = mkdtempSync(join(tmpdir(), "sagax-link-approvals-"));
    dirs.push(dir);
    const file = join(dir, "page-link-approvals.jsonl");
    const first = new PageLinkApprovals(file, () => NOW);
    first.allow("person-b", "page-1", "https://a.example");
    first.allow("person-b", "page-1", "https://b.example");
    // a crash or a full disk cut the next append: no new line at the end
    appendFileSync(file, '{"op":"allow","person":"person-b","pageId":"page-1","origin":"https://c.exa');
    return file;
  }

  it("keeps a DELETE after a cut line across a restart", () => {
    const file = cutJournal();
    const after = new PageLinkApprovals(file, () => NOW);
    expect(after.allowed("person-b", "page-1", "https://a.example")).toBe(true);
    after.forget("person-b", "page-1", "https://a.example");
    const restarted = new PageLinkApprovals(file, () => NOW);
    expect(restarted.allowed("person-b", "page-1", "https://a.example")).toBe(false);
    expect(restarted.allowed("person-b", "page-1", "https://b.example")).toBe(true);
    expect(readFileSync(file, "utf8").endsWith("\n")).toBe(true);
  });

  it("keeps a page's revoke after a cut line across a restart", () => {
    const file = cutJournal();
    const after = new PageLinkApprovals(file, () => NOW);
    after.forgetPage("page-1");
    const restarted = new PageLinkApprovals(file, () => NOW);
    expect(restarted.allowed("person-b", "page-1", "https://a.example")).toBe(false);
    expect(restarted.allowed("person-b", "page-1", "https://b.example")).toBe(false);
  });

  it("skips an unreadable line without losing the ones after it", () => {
    const file = cutJournal();
    appendFileSync(file, '\n{"op":"allow","person":"person-b","pageId":"page-1","origin":"https://d.example","at":1}\n');
    const restarted = new PageLinkApprovals(file, () => NOW);
    expect(restarted.allowed("person-b", "page-1", "https://d.example")).toBe(true);
    expect(restarted.allowed("person-b", "page-1", "https://a.example")).toBe(true);
  });
});
