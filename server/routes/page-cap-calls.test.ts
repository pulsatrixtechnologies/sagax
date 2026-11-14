// Page capabilities that keep or act on something (#3413 lots 3 to 7). The
// blocking rule first, in every lot: reader B never gets reader A's data.
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import type { RequestAuth } from "../auth/request-auth.ts";
import type { PageCapabilities, PageStoreDoc } from "../../shared/page-capabilities.ts";
import { PageDataApprovals } from "../pages/page-data-approvals.ts";
import { PageSources } from "../pages/page-sources.ts";
import { PageStore } from "../pages/page-store.ts";
import type { PageRecord } from "../pages/published-pages.ts";
import { createPageDataRoutes, type PageDataRouteDeps } from "./page-data.ts";
import type { RouteContext } from "./table.ts";

const NOW = 1_800_000_000_000;
const as = (principalId: string | null, act = false) => ({ kind: "session", via: "cookie", scopes: ["client"], session: { principalId, ...(act ? { ephemeral: true, label: "Bot act" } : {}) } }) as unknown as RequestAuth;

function page(over: Partial<PageRecord> = {}): PageRecord {
  return { id: "page-1", ownerId: "person-a", botId: "lead-bot", threadId: "t", access: "org", status: "published", currentVersion: 1, expiresAt: null, versions: [{ n: 1, kind: "html", title: "Board", bytes: 100 }], ...over } as unknown as PageRecord;
}

const BASE: PageCapabilities = { data: [], viewer: false, open: false, files: [] };

export function world(options: { caps?: Partial<PageCapabilities>; record?: PageRecord; personalShared?: boolean; ownerBytes?: number; extra?: Partial<PageDataRouteDeps> } = {}) {
  const record = options.record ?? page();
  const store = new PageStore(null, () => NOW);
  const live = { store: vi.fn() };
  const deps: PageDataRouteDeps = {
    pages: {
      get: (id) => (id === record.id ? record : undefined),
      capabilities: () => ({ ...BASE, ...options.caps }),
      policy: () => ({ linkSharing: true, readerComments: true }) as ReturnType<PageDataRouteDeps["pages"]["policy"]>,
      readerHandle: (_pageId, by) => `h-${by}`,
      stateReadOnlyForData: () => options.personalShared === true,
      ownerBytes: () => options.ownerBytes ?? 0,
    },
    reader: (auth) => {
      const id = (auth as { session: { principalId: string | null } }).session.principalId;
      return id ? { principalId: id, computerOwner: false } : null;
    },
    names: (ids) => Object.fromEntries(ids.map((id) => [id, `Name ${id}`])),
    botAct: (auth) => (auth as { session: { ephemeral?: boolean } }).session.ephemeral === true,
    sources: new PageSources([]),
    approvals: new PageDataApprovals(null, () => NOW),
    store,
    live,
    now: () => NOW,
    ...options.extra,
  };
  return { routes: createPageDataRoutes(deps), store, live, deps };
}

export async function call(routes: ReturnType<typeof createPageDataRoutes>, auth: RequestAuth, path: string, method = "GET", body: unknown = null) {
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

const A = as("person-a");
const B = as("person-b");

describe("store (lot 3): collections a page keeps", () => {
  it("keeps a reader collection per reader: B never reads A's document, nor A B's", async () => {
    const { routes } = world({ caps: { store: { prefs: { write: "signed_in", scope: "reader" } } } });
    expect((await call(routes, A, "/api/pages/page-1/store/prefs/theme", "PUT", { value: { dark: true, secret: "a-only" } })).status).toBe(200);
    // B asks for the same id: nothing, and B's list is empty
    expect((await call(routes, B, "/api/pages/page-1/store/prefs/theme")).status).toBe(404);
    const listed = await call(routes, B, "/api/pages/page-1/store/prefs");
    expect(listed.body).toEqual({ docs: [] });
    expect(JSON.stringify(listed.body)).not.toContain("a-only");
    // B writes the same id: B's own document, A's stays
    await call(routes, B, "/api/pages/page-1/store/prefs/theme", "PUT", { value: { dark: false } });
    expect((await call(routes, A, "/api/pages/page-1/store/prefs/theme")).body).toMatchObject({ id: "theme", value: { dark: true, secret: "a-only" }, mine: true });
    expect((await call(routes, B, "/api/pages/page-1/store/prefs/theme")).body).toMatchObject({ id: "theme", value: { dark: false }, mine: true });
    // B cannot delete A's document either
    await call(routes, B, "/api/pages/page-1/store/prefs/theme", "DELETE");
    expect((await call(routes, A, "/api/pages/page-1/store/prefs/theme")).status).toBe(200);
  });

  it("refuses a shared write once the page reads personal data and is shared; a reader collection stays the reader's", async () => {
    const { routes } = world({ personalShared: true, caps: { data: ["team-board"], store: { votes: { write: "signed_in", scope: "shared" }, mine: { write: "signed_in", scope: "reader" } } } });
    const shared = await call(routes, B, "/api/pages/page-1/store/votes", "POST", { value: { board: "B's board" } });
    expect(shared.status).toBe(409);
    expect(shared.body.code).toBe("shared_write_after_data");
    expect((await call(routes, A, "/api/pages/page-1/store/votes")).body).toEqual({ docs: [] });
    expect((await call(routes, B, "/api/pages/page-1/store/mine", "POST", { value: { board: "B's board" } })).status).toBe(200);
  });

  it("shares a shared collection with every reader, names its writer by handle, never an id", async () => {
    const { routes, live } = world({ caps: { store: { votes: { write: "signed_in", scope: "shared" } } } });
    const added = await call(routes, A, "/api/pages/page-1/store/votes", "POST", { value: { pick: "x" } });
    expect(added.status).toBe(200);
    const doc = added.body as unknown as PageStoreDoc;
    expect(doc).toMatchObject({ value: { pick: "x" }, by: "h-person-a", name: "Name person-a", at: NOW, mine: true });
    expect(live.store).toHaveBeenCalledWith("page-1", "votes", undefined);
    const seen = (await call(routes, B, "/api/pages/page-1/store/votes")).body.docs as PageStoreDoc[];
    expect(seen).toEqual([{ ...doc, mine: false }]);
    expect(JSON.stringify(seen)).not.toContain("\"person-a\"");
  });

  it("tells only the writer's own bar about a reader collection", async () => {
    const { routes, live } = world({ caps: { store: { prefs: { write: "signed_in", scope: "reader" } } } });
    await call(routes, B, "/api/pages/page-1/store/prefs", "POST", { value: 1 });
    expect(live.store).toHaveBeenCalledWith("page-1", "prefs", "person-b");
  });

  it("refuses an undeclared collection and a reader not signed in, before anything is kept", async () => {
    const { routes, store } = world({ caps: { store: { votes: { write: "signed_in", scope: "shared" } } } });
    expect((await call(routes, B, "/api/pages/page-1/store/other", "POST", { value: 1 })).body.code).toBe("not_declared");
    expect((await call(routes, as(null), "/api/pages/page-1/store/votes", "POST", { value: 1 })).body.code).toBe("sign_in");
    expect(store.bytes("page-1")).toBe(0);
  });

  it("applies the declared write level: editors only, the page's person only", async () => {
    const { routes } = world({ caps: { store: { decisions: { write: "editors", scope: "shared" } } } });
    expect((await call(routes, B, "/api/pages/page-1/store/decisions", "POST", { value: 1 })).body.code).toBe("not_allowed");
    expect((await call(routes, A, "/api/pages/page-1/store/decisions", "POST", { value: 1 })).status).toBe(200);
    // anyone may read it
    expect(((await call(routes, B, "/api/pages/page-1/store/decisions")).body.docs as unknown[]).length).toBe(1);
  });

  it("filters, sorts and caps a list", async () => {
    const { routes } = world({ caps: { store: { votes: { write: "signed_in", scope: "shared" } } } });
    for (const [id, score, team] of [["a", 3, "x"], ["b", 1, "x"], ["c", 2, "y"]] as const) await call(routes, A, `/api/pages/page-1/store/votes/${id}`, "PUT", { value: { score, team } });
    const q = encodeURIComponent(JSON.stringify({ where: { team: "x" }, order: { by: "score", desc: true }, limit: 5 }));
    expect(((await call(routes, B, `/api/pages/page-1/store/votes?q=${q}`)).body.docs as PageStoreDoc[]).map((doc) => doc.id)).toEqual(["a", "b"]);
    expect((await call(routes, B, `/api/pages/page-1/store/votes?q=${encodeURIComponent("{\"nope\":1}")}`)).body.code).toBe("bad_request");
  });

  it("keeps a document within its size and the page person's share", async () => {
    const { routes } = world({ caps: { store: { votes: { write: "signed_in", scope: "shared" } } } });
    expect((await call(routes, A, "/api/pages/page-1/store/votes", "POST", { value: "x".repeat(33 * 1024) })).body.code).toBe("too_large");
    const full = world({ ownerBytes: 50 * 1024 * 1024, caps: { store: { votes: { write: "signed_in", scope: "shared" } } } });
    expect((await call(full.routes, A, "/api/pages/page-1/store/votes", "POST", { value: 1 })).body.code).toBe("too_large");
  });
});

describe("model.ask (lot 4): one answer on the reader's own account", () => {
  const MODEL = { model: true as const };
  function withModel(over: Partial<PageDataRouteDeps> = {}, options: Parameters<typeof world>[0] = {}) {
    const ask = vi.fn(async ({ viewer, text }: { viewer: { principalId?: string }; text: string }) => `answer for ${viewer.principalId}: ${text.length}`);
    const made = world({ caps: MODEL, ...options, extra: { model: { ask }, ...over } });
    return { ...made, ask };
  }

  it("asks with the reader's own account, never the page owner's: B's answer is B's", async () => {
    const { routes, ask } = withModel();
    const b = await call(routes, B, "/api/pages/page-1/model", "POST", { prompt: "Summarize" });
    expect(b.status).toBe(200);
    expect(b.body).toEqual({ text: "answer for person-b: 9" });
    expect(ask.mock.calls[0]![0].viewer.principalId).toBe("person-b");
    expect(JSON.stringify(b.body)).not.toContain("person-a");
  });

  it("refuses an undeclared model and a reader not signed in, before asking", async () => {
    const none = world({ extra: { model: { ask: vi.fn() } } });
    expect((await call(none.routes, B, "/api/pages/page-1/model", "POST", { prompt: "x" })).body.code).toBe("not_declared");
    const { routes, ask } = withModel();
    expect((await call(routes, as(null), "/api/pages/page-1/model", "POST", { prompt: "x" })).body.code).toBe("sign_in");
    expect(ask).not.toHaveBeenCalled();
  });

  it("puts the page's system words and schema before the question, and parses the JSON answer", async () => {
    const ask = vi.fn(async () => "```json\n{\"ok\":true}\n```");
    const { routes } = world({ caps: MODEL, extra: { model: { ask } } });
    const answer = await call(routes, B, "/api/pages/page-1/model", "POST", { prompt: "Q?", system: "Be brief.", schema: { type: "object" } });
    expect(answer.body).toEqual({ text: "```json\n{\"ok\":true}\n```", value: { ok: true } });
    const sent = (ask.mock.calls[0] as unknown as [{ text: string }])[0].text;
    expect(sent.startsWith("Be brief.")).toBe(true);
    expect(sent).toContain(JSON.stringify({ type: "object" }));
    expect(sent.endsWith("Q?")).toBe(true);
  });

  it("limits questions to 10 a minute per reader and page, and a prompt to 32 KB", async () => {
    const { routes } = withModel();
    for (let index = 0; index < 10; index++) expect((await call(routes, B, "/api/pages/page-1/model", "POST", { prompt: "x" })).status).toBe(200);
    expect((await call(routes, B, "/api/pages/page-1/model", "POST", { prompt: "x" })).body.code).toBe("rate_limited");
    expect((await call(routes, A, "/api/pages/page-1/model", "POST", { prompt: "x" })).status).toBe(200);
    expect((await call(routes, A, "/api/pages/page-1/model", "POST", { prompt: "x".repeat(33 * 1024) })).body.code).toBe("too_large");
    expect((await call(routes, A, "/api/pages/page-1/model", "POST", { prompt: "" })).body.code).toBe("bad_request");
  });

  it("applies the organization's Deny, and Ask first through the reader's own card", async () => {
    const deny = withModel({ actRule: () => "deny" });
    expect((await call(deny.routes, B, "/api/pages/page-1/model", "POST", { prompt: "x" })).body).toMatchObject({ code: "denied", reason: "org_rule" });
    expect(deny.ask).not.toHaveBeenCalled();
    const first = withModel({ actRule: ({ tool }) => (tool === "page_model" ? "ask" : "none") });
    const asked = await call(first.routes, B, "/api/pages/page-1/model", "POST", { prompt: "x" });
    expect(asked.status).toBe(409);
    expect(asked.body).toMatchObject({ code: "ask_first", source: "model", version: 1 });
    // a bot's act copy cannot answer, another person neither; the reader can
    const id = String(asked.body.approvalId);
    expect((await call(first.routes, as("person-b", true), `/api/pages/page-1/data-approvals/${id}`, "POST", { answer: "once" })).status).toBe(403);
    expect((await call(first.routes, A, `/api/pages/page-1/data-approvals/${id}`, "POST", { answer: "once" })).status).toBe(404);
    expect((await call(first.routes, B, `/api/pages/page-1/data-approvals/${id}`, "POST", { answer: "once" })).status).toBe(200);
    expect((await call(first.routes, B, "/api/pages/page-1/model", "POST", { prompt: "x" })).status).toBe(200);
  });

  it("says unavailable when no model of the reader can answer", async () => {
    const { routes } = world({ caps: MODEL, extra: { model: { ask: vi.fn(async () => { throw new Error("none"); }) } } });
    expect((await call(routes, B, "/api/pages/page-1/model", "POST", { prompt: "x" })).body.code).toBe("unavailable");
  });
});
