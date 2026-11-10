// "Always allow this site" on a page's link card (#3413): per reader, page
// and host, kept by the server; the person only, never a bot's act session;
// a reader not signed in or who may not read the page gets the same refusal
// as for data; an approval never covers a subdomain or another host; revoke
// forgets them.
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { RequestAuth } from "../auth/request-auth.ts";
import { normalizePageLinkHost } from "../../shared/page-capabilities.ts";
import { PageDataApprovals } from "../pages/page-data-approvals.ts";
import { PageLinkApprovals } from "../pages/page-link-approvals.ts";
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

describe("link approvals: Always allow this site", () => {
  it("keeps an approval for the reader, page and host, and lets them forget it", async () => {
    const { routes } = world();
    expect((await call(routes, as("person-b"), `${ROUTE}?host=docs.example.com`)).body).toEqual({ allowed: false });
    expect((await call(routes, as("person-b"), ROUTE, "POST", { host: "Docs.Example.com", answer: "always" })).body).toEqual({ ok: true });
    expect((await call(routes, as("person-b"), `${ROUTE}?host=docs.example.com`)).body).toEqual({ allowed: true });
    expect((await call(routes, as("person-b"), `${ROUTE}?host=docs.example.com`, "DELETE")).body).toEqual({ ok: true });
    expect((await call(routes, as("person-b"), `${ROUTE}?host=docs.example.com`)).body).toEqual({ allowed: false });
  });

  it("never covers another person, a subdomain or another host", async () => {
    const { routes } = world();
    await call(routes, as("person-b"), ROUTE, "POST", { host: "example.com", answer: "always" });
    expect((await call(routes, as("person-c"), `${ROUTE}?host=example.com`)).body).toEqual({ allowed: false });
    expect((await call(routes, as("person-b"), `${ROUTE}?host=docs.example.com`)).body).toEqual({ allowed: false });
    expect((await call(routes, as("person-b"), `${ROUTE}?host=example.org`)).body).toEqual({ allowed: false });
    expect((await call(routes, as("person-b"), `${ROUTE}?host=example.com.evil.net`)).body).toEqual({ allowed: false });
  });

  it("refuses a bot's act session, to read, write or forget", async () => {
    const { routes, links } = world();
    const write = await call(routes, as("person-b", true), ROUTE, "POST", { host: "example.com", answer: "always" });
    expect(write.status).toBe(403);
    expect(write.body.code).toBe("person_only");
    expect(links.allowed("person-b", "page-1", "example.com")).toBe(false);
    expect((await call(routes, as("person-b", true), `${ROUTE}?host=example.com`)).status).toBe(403);
    expect((await call(routes, as("person-b", true), `${ROUTE}?host=example.com`, "DELETE")).status).toBe(403);
  });

  it("gives a reader not signed in, or who may not read the page, the same refusal as for data", async () => {
    const { routes } = world({ record: page({ access: "private" }) });
    const anon = await call(routes, as(null), `${ROUTE}?host=example.com`);
    expect(anon.status).toBe(401);
    expect(anon.body.code).toBe("sign_in");
    const stranger = await call(routes, as("person-b"), ROUTE, "POST", { host: "example.com", answer: "always" });
    expect(stranger.status).toBe(404);
    expect(stranger.body.code).toBe("not_found");
  });

  it("refuses a host that is not one, and an answer it does not know", async () => {
    const { routes } = world();
    expect((await call(routes, as("person-b"), ROUTE, "POST", { host: "javascript:alert(1)", answer: "always" })).status).toBe(400);
    expect((await call(routes, as("person-b"), ROUTE, "POST", { host: "example.com", answer: "once" })).status).toBe(400);
    expect((await call(routes, as("person-b"), `${ROUTE}?host=`)).status).toBe(400);
  });

  it("keeps approvals on disk, and forgets a page's approvals when it is revoked", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-link-approvals-"));
    dirs.push(dir);
    const file = join(dir, "page-link-approvals.json");
    const first = new PageLinkApprovals(file, () => NOW);
    first.allow("person-b", "page-1", "example.com");
    first.allow("person-b", "page-2", "example.com");
    const again = new PageLinkApprovals(file, () => NOW);
    expect(again.allowed("person-b", "page-1", "example.com")).toBe(true);
    // revoke goes through PublishedPages: its listeners hear it
    const pages = new PublishedPages(dir, () => NOW);
    const made = pages.propose({ ownerId: "person-a", botId: "lead", threadId: "t", title: "P", kind: "html", content: "<p>x</p>" });
    if (!made.ok) throw new Error(made.error);
    pages.publish(made.page.id, { version: made.version.n, access: "org", expiresAt: null });
    again.allow("person-b", made.page.id, "example.com");
    pages.onRevoked((id) => again.forgetPage(id));
    pages.revoke(made.page.id);
    expect(again.allowed("person-b", made.page.id, "example.com")).toBe(false);
    expect(again.allowed("person-b", "page-2", "example.com")).toBe(true);
  });
});

describe("normalizePageLinkHost", () => {
  it("keeps the host in lower case, without port or credentials, punycode as is, http and https only", () => {
    expect(normalizePageLinkHost("Docs.Example.COM")).toBe("docs.example.com");
    expect(normalizePageLinkHost("example.com:8443")).toBe("example.com");
    expect(normalizePageLinkHost("https://user:pass@Example.com:443/a?b")).toBe("example.com");
    expect(normalizePageLinkHost("http://xn--bcher-kva.example/")).toBe("xn--bcher-kva.example");
    expect(normalizePageLinkHost("ftp://example.com/")).toBeNull();
    expect(normalizePageLinkHost("mailto:a@example.com")).toBeNull();
    expect(normalizePageLinkHost("")).toBeNull();
    expect(normalizePageLinkHost("exa mple.com")).toBeNull();
    expect(normalizePageLinkHost(42)).toBeNull();
  });
});
