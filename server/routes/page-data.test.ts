// Page capabilities (#3413), the server side of the bridge. Blocking guards
// first: a page reads the data of the person who opens it, with their rights,
// never another's nor its owner's; a reader not signed in gets none; an
// undeclared source is refused; the organization's Deny and Ask first apply.
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import type { RequestAuth } from "../auth/request-auth.ts";
import type { PageCapabilities, PageDataAnswer } from "../../shared/page-capabilities.ts";
import { PageLive } from "../pages/page-live.ts";
import { PageDataApprovals } from "../pages/page-data-approvals.ts";
import { PageDataWatch, PageSources, type PageSource } from "../pages/page-sources.ts";
import type { PageRecord } from "../pages/published-pages.ts";
import { createPageDataRoutes, type PageDataRouteDeps } from "./page-data.ts";
import { PASS, type RouteContext } from "./table.ts";

const NOW = 1_800_000_000_000;
const as = (principalId: string | null, act = false) => ({ kind: "session", via: "cookie", scopes: ["client"], session: { principalId, ...(act ? { ephemeral: true, label: "Bot act" } : {}) } }) as unknown as RequestAuth;

function page(over: Partial<PageRecord> = {}): PageRecord {
  return { id: "page-1", ownerId: "person-a", botId: "lead-bot", threadId: "t", access: "org", status: "published", currentVersion: 1, expiresAt: null, versions: [{ n: 1, kind: "html", title: "Board" }, { n: 2, kind: "html", title: "Board v2" }], ...over } as unknown as PageRecord;
}

function world(options: { caps?: PageCapabilities | null; capsOf?: (n?: number) => PageCapabilities | null; record?: PageRecord; orgRule?: PageDataRouteDeps["orgRule"] } = {}) {
  const record = options.record ?? page();
  const read = vi.fn(async (auth: RequestAuth) => {
    const who = (auth as { session: { principalId: string } }).session.principalId;
    return {
      value: { owner: `board of ${who}`, pr: `https://github.com/acme/${who}/pull/1`, open: `thread:bot-${who}:th-${who}`, title: "https://x.example/a" },
      topics: [`bot-${who}`],
      links: [`https://github.com/acme/${who}/pull/1`, "http://plain.example/x"],
      refs: [`thread:bot-${who}:th-${who}`],
    };
  });
  const source: PageSource = { name: "team-board", label: "The work of your coding teams", read };
  const approvals = new PageDataApprovals(null, () => NOW);
  const live = new PageLive();
  const watch = new PageDataWatch(live, 0);
  const deps: PageDataRouteDeps = {
    pages: {
      get: (id) => (id === record.id ? record : undefined),
      capabilities: (_id, n) => (options.capsOf ? options.capsOf(n) : options.caps === undefined ? { data: ["team-board"], viewer: true, open: true } : options.caps),
      policy: () => ({ linkSharing: true, readerComments: true }) as ReturnType<PageDataRouteDeps["pages"]["policy"]>,
      readerHandle: (_pageId, by) => `h-${by}`,
    },
    reader: (auth) => {
      const id = (auth as { session: { principalId: string | null } }).session.principalId;
      return id ? { principalId: id, computerOwner: false } : null;
    },
    names: (ids) => Object.fromEntries(ids.map((id) => [id, `Name ${id}`])),
    botAct: (auth) => (auth as { session: { ephemeral?: boolean } }).session.ephemeral === true,
    sources: new PageSources([source]),
    approvals,
    watch,
    ...(options.orgRule ? { orgRule: options.orgRule } : {}),
    now: () => NOW,
  };
  return { routes: createPageDataRoutes(deps), read, approvals, live, watch };
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
  const result = await routes(context);
  return { result, status: sent[0]?.status, body: sent[0]?.body as Record<string, unknown> };
}

describe("page data: the reader's own data, never another's", () => {
  it("gives reader B, on a page A shared, B's data and nothing of A's", async () => {
    const { routes, read } = world();
    const b = await call(routes, as("person-b"), "/api/pages/page-1/data/team-board");
    expect(b.status).toBe(200);
    const answer = b.body as unknown as PageDataAnswer;
    expect(answer.value).toEqual({ owner: "board of person-b", pr: "https://github.com/acme/person-b/pull/1", open: "thread:bot-person-b:th-person-b", title: "https://x.example/a" });
    expect(JSON.stringify(answer)).not.toContain("person-a");
    // the source got the reader's session, never the page owner's
    expect((read.mock.calls[0]![0] as { session: { principalId: string } }).session.principalId).toBe("person-b");
  });

  it("refuses a reader who is not signed in, without reading anything", async () => {
    const { routes, read } = world();
    const anon = await call(routes, as(null), "/api/pages/page-1/data/team-board");
    expect(anon.status).toBe(401);
    expect(anon.body.code).toBe("sign_in");
    expect(read).not.toHaveBeenCalled();
  });

  it("refuses a source the published version does not declare, and a page with no block", async () => {
    const other = world({ caps: { data: [], viewer: true, open: false } });
    expect((await call(other.routes, as("person-b"), "/api/pages/page-1/data/team-board")).body.code).toBe("not_declared");
    const none = world({ caps: null });
    const answer = await call(none.routes, as("person-b"), "/api/pages/page-1/data/team-board");
    expect(answer.status).toBe(403);
    expect(answer.body.code).toBe("not_declared");
    expect(none.read).not.toHaveBeenCalled();
  });

  it("answers 404 to a reader who may not read the page, as for a missing one", async () => {
    const { routes, read } = world({ record: page({ access: "private" }) });
    expect((await call(routes, as("person-b"), "/api/pages/page-1/data/team-board")).status).toBe(404);
    expect((await call(routes, as("person-b"), "/api/pages/nope/data/team-board")).status).toBe(404);
    expect(read).not.toHaveBeenCalled();
  });

  it("lists only the exits the source named, https only, never an address found in free text", async () => {
    const { routes } = world();
    const answer = (await call(routes, as("person-b"), "/api/pages/page-1/data/team-board")).body as unknown as PageDataAnswer;
    expect(answer.links).toEqual(["https://github.com/acme/person-b/pull/1"]);
    expect(answer.links).not.toContain("https://x.example/a");
    expect(answer.refs).toEqual(["thread:bot-person-b:th-person-b"]);
  });

  it("applies the organization's Deny for page_data in the reader's context", async () => {
    const seen: string[] = [];
    const deny = world({ orgRule: ({ source, auth }) => { seen.push(`${source}:${(auth as { session: { principalId: string } }).session.principalId}`); return "deny"; } });
    expect((await call(deny.routes, as("person-b"), "/api/pages/page-1/data/team-board")).body.code).toBe("denied");
    expect(seen).toEqual(["team-board:person-b"]);
  });

  it("asks first through a card the server records: a flag is worth nothing, a bot's act cannot answer", async () => {
    const ask = world({ orgRule: () => "ask" });
    // the reviewer's scenario: a bot, through act, sends approved=1
    const flagged = await call(ask.routes, as("person-b", true), "/api/pages/page-1/data/team-board?approved=1");
    expect(flagged.status).toBe(409);
    expect(flagged.body.code).toBe("ask_first");
    const approvalId = String(flagged.body.approvalId);
    expect(flagged.body).toMatchObject({ source: "team-board", version: 1 });
    expect(ask.read).not.toHaveBeenCalled();
    // the bot cannot answer the card
    const byBot = await call(ask.routes, as("person-b", true), `/api/pages/page-1/data-approvals/${approvalId}`, "POST", { answer: "always" });
    expect(byBot.status).toBe(403);
    // another person cannot answer it either
    expect((await call(ask.routes, as("person-c"), `/api/pages/page-1/data-approvals/${approvalId}`, "POST", { answer: "once" })).status).toBe(404);
    // the reader answers once: this page, version and source read
    expect((await call(ask.routes, as("person-b"), `/api/pages/page-1/data-approvals/${approvalId}`, "POST", { answer: "once" })).body).toEqual({ ok: true, answer: "once" });
    expect((await call(ask.routes, as("person-b"), "/api/pages/page-1/data/team-board")).status).toBe(200);
    // and the answer is used once only
    expect((await call(ask.routes, as("person-b"), `/api/pages/page-1/data-approvals/${approvalId}`, "POST", { answer: "once" })).status).toBe(404);
  });

  it("keeps Always allow on the server, and Deny opens a new card next time", async () => {
    const ask = world({ orgRule: () => "ask" });
    const first = await call(ask.routes, as("person-b"), "/api/pages/page-1/data/team-board");
    await call(ask.routes, as("person-b"), `/api/pages/page-1/data-approvals/${String(first.body.approvalId)}`, "POST", { answer: "deny" });
    const again = await call(ask.routes, as("person-b"), "/api/pages/page-1/data/team-board");
    expect(again.body.code).toBe("ask_first");
    await call(ask.routes, as("person-b"), `/api/pages/page-1/data-approvals/${String(again.body.approvalId)}`, "POST", { answer: "always" });
    expect((await call(ask.routes, as("person-b"), "/api/pages/page-1/data/team-board")).status).toBe(200);
    expect(ask.approvals.allowed({ person: "person-b", pageId: "page-1", version: 9, source: "team-board" })).toBe(true);
  });

  it("writes its errors in the reader's language, with a stable code", async () => {
    const { routes } = world({ caps: null });
    const fr = await call(routes, as("person-b"), "/api/pages/page-1/data/team-board?lang=fr");
    expect(fr.body).toEqual({ error: "Cette page ne déclare pas cette capacité.", code: "not_declared" });
    const en = await call(routes, as("person-b"), "/api/pages/page-1/data/team-board");
    expect(en.body).toEqual({ error: "This page does not declare this capability.", code: "not_declared" });
  });

  it("limits reads to 30 a minute per reader and page", async () => {
    const { routes } = world();
    for (let index = 0; index < 30; index++) expect((await call(routes, as("person-b"), "/api/pages/page-1/data/team-board")).status).toBe(200);
    expect((await call(routes, as("person-b"), "/api/pages/page-1/data/team-board")).body.code).toBe("rate_limited");
    expect((await call(routes, as("person-c"), "/api/pages/page-1/data/team-board")).status).toBe(200);
  });

  it("passes other paths and every write", async () => {
    const { routes } = world();
    expect((await call(routes, as("person-b"), "/api/pages/page-1/threads")).result).toBe(PASS);
    expect((await call(routes, as("person-b"), "/api/pages/page-1/data/team-board", "POST")).result).toBe(PASS);
  });
});

describe("page viewer and capabilities", () => {
  it("gives the reader their own name, page handle and role, never an id", async () => {
    const { routes } = world();
    const viewer = await call(routes, as("person-b"), "/api/pages/page-1/viewer?lang=fr");
    expect(viewer.body).toEqual({ name: "Name person-b", handle: "h-person-b", role: "signed_in", lang: "fr" });
    expect((await call(world({ caps: { data: ["team-board"], viewer: false, open: false } }).routes, as("person-b"), "/api/pages/page-1/viewer")).body.code).toBe("not_declared");
  });

  it("says what the version reads, for the reader's bar", async () => {
    const { routes } = world();
    expect((await call(routes, as("person-b"), "/api/pages/page-1/capabilities")).body).toEqual({
      version: 1,
      capabilities: { data: ["team-board"], viewer: true, open: true },
      reads: [{ name: "team-board", label: "The work of your coding teams" }],
    });
  });

  it("checks the version its person previews, for them only; a reader gets the published one", async () => {
    // v2 adds the data source; v1 (published) declares nothing
    const capsOf = (n?: number) => (n === 2 ? { data: ["team-board" as const], viewer: false, open: false } : null);
    const { routes } = world({ capsOf, record: page({ access: "org" }) });
    expect((await call(routes, as("person-a"), "/api/pages/page-1/capabilities?version=2")).body).toMatchObject({ version: 2, capabilities: { data: ["team-board"] } });
    expect((await call(routes, as("person-a"), "/api/pages/page-1/data/team-board?version=2")).status).toBe(200);
    expect((await call(routes, as("person-a"), "/api/pages/page-1/data/team-board")).body.code).toBe("not_declared");
    // another reader cannot ask for an unpublished version
    expect((await call(routes, as("person-b"), "/api/pages/page-1/data/team-board?version=2")).status).toBe(404);
    expect((await call(routes, as("person-b"), "/api/pages/page-1/capabilities")).body).toMatchObject({ version: 1, capabilities: { data: [] } });
  });
});

describe("page data: the live event", () => {
  it("tells only the reader whose bots changed, on their open page", async () => {
    const { routes, live, watch } = world();
    const writes = { b: [] as string[], c: [] as string[] };
    live.join("page-1", { id: "person-b", name: "B" }, { write: (frame: string) => { writes.b.push(frame); return true; }, end: () => {} } as never);
    live.join("page-1", { id: "person-c", name: "C" }, { write: (frame: string) => { writes.c.push(frame); return true; }, end: () => {} } as never);
    await call(routes, as("person-b"), "/api/pages/page-1/data/team-board");
    await call(routes, as("person-c"), "/api/pages/page-1/data/team-board");
    writes.b.length = 0;
    writes.c.length = 0;
    vi.useFakeTimers();
    try {
      watch.botChanged("bot-person-b");
      vi.runAllTimers();
    } finally {
      vi.useRealTimers();
    }
    expect(writes.b).toEqual(["event: data\ndata: {\"name\":\"team-board\"}\n\n"]);
    expect(writes.c).toEqual([]);
  });
});
