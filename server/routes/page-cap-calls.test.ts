// Page capabilities that keep or act on something (#3413 lots 3 to 7). The
// blocking rule first, in every lot: reader B never gets reader A's data.
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

import type { RequestAuth } from "../auth/request-auth.ts";
import type { ConnectorHub } from "../connectors/hub.ts";
import type { ConnectorAccount } from "../connectors/types.ts";
import type { PageCapabilities, PageStoreDoc } from "../../shared/page-capabilities.ts";
import { pageActVerdict } from "../pages/page-act-verdict.ts";
import { PageDataApprovals } from "../pages/page-data-approvals.ts";
import { CustomRuleStore } from "../rules/custom-rules-store.ts";
import { PageSources } from "../pages/page-sources.ts";
import { PageFiles } from "../pages/page-files.ts";
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

describe("files added by readers (lot 5)", () => {
  const ADD = { files: ["add" as const] };
  const TEXT = Buffer.from("hello from A").toString("base64");
  function withFiles(options: Parameters<typeof world>[0] = {}) {
    const files = new PageFiles(null, () => NOW);
    return { ...world({ caps: ADD, ...options, extra: { files, ...options.extra } }), files };
  }

  it("gives a reader their own files only: B never lists nor reads the file A added", async () => {
    const { routes } = withFiles({ record: page({ ownerId: "person-o" }) });
    const added = await call(routes, A, "/api/pages/page-1/files", "POST", { name: "a.txt", mime: "text/plain", data: TEXT });
    expect(added.status).toBe(200);
    expect(added.body).toMatchObject({ name: "a.txt", mime: "text/plain", size: 12, by: "h-person-a", writer: "Name person-a", mine: true });
    const id = String(added.body.id);
    expect((await call(routes, B, "/api/pages/page-1/files")).body).toEqual({ files: [] });
    expect((await call(routes, B, `/api/pages/page-1/files/${id}`)).status).toBe(404);
    expect((await call(routes, B, `/api/pages/page-1/files/${id}`, "DELETE")).status).toBe(404);
    // A reads it back, bytes and all
    expect((await call(routes, A, `/api/pages/page-1/files/${id}`)).body).toMatchObject({ id, data: TEXT, mine: true });
    // the page's person reads every file of its readers
    const owner = await call(routes, as("person-o"), "/api/pages/page-1/files");
    expect((owner.body.files as Array<{ id: string; mine: boolean }>).map((file) => [file.id, file.mine])).toEqual([[id, false]]);
  });

  it("refuses a file on a shared page that reads personal data, before keeping anything", async () => {
    const { routes, files } = withFiles({ personalShared: true, caps: { ...ADD, data: ["team-board"] } });
    const answer = await call(routes, B, "/api/pages/page-1/files", "POST", { name: "b.txt", mime: "text/plain", data: TEXT });
    expect(answer.body.code).toBe("shared_write_after_data");
    expect(files.bytes("page-1")).toBe(0);
  });

  it("refuses an undeclared add, a type or name that is not allowed, and bad base64", async () => {
    const download = withFiles({ caps: { files: ["download"] } });
    expect((await call(download.routes, B, "/api/pages/page-1/files", "POST", { name: "b.txt", mime: "text/plain", data: TEXT })).body.code).toBe("not_declared");
    const { routes } = withFiles();
    expect((await call(routes, B, "/api/pages/page-1/files", "POST", { name: "b.html", mime: "text/html", data: TEXT })).body.code).toBe("bad_request");
    expect((await call(routes, B, "/api/pages/page-1/files", "POST", { name: "..", mime: "text/plain", data: TEXT })).body.code).toBe("bad_request");
    expect((await call(routes, B, "/api/pages/page-1/files", "POST", { name: "b.txt", mime: "text/plain", data: "not base64!" })).body.code).toBe("bad_request");
    expect((await call(routes, as(null), "/api/pages/page-1/files")).body.code).toBe("sign_in");
  });

  it("keeps a file within the page person's share", async () => {
    const { routes } = withFiles({ ownerBytes: 50 * 1024 * 1024 });
    expect((await call(routes, A, "/api/pages/page-1/files", "POST", { name: "a.txt", mime: "text/plain", data: TEXT })).body.code).toBe("too_large");
  });

  it("lets its writer remove a file", async () => {
    const { routes, files } = withFiles();
    const id = String((await call(routes, A, "/api/pages/page-1/files", "POST", { name: "a.txt", mime: "text/plain", data: TEXT })).body.id);
    expect((await call(routes, A, `/api/pages/page-1/files/${id}`, "DELETE")).body).toEqual({ ok: true });
    expect(files.bytes("page-1")).toBe(0);
  });
});

describe("page.propose (lot 6): the page proposes a new version of itself", () => {
  const PROPOSE = { propose: true as const };
  function withPropose(options: Parameters<typeof world>[0] = {}) {
    const propose = vi.fn((_pageId: string, input: { content: string; by: string }) => ({ ok: true as const, version: { n: 2 }, input }));
    return { ...world({ caps: PROPOSE, ...options, extra: { propose, redact: (text: string) => text.replace(/sk-[a-z0-9]+/g, "[secret]"), ...options.extra } }), propose };
  }

  it("lets the page's person and its editors propose, as their own edit; any other reader gets not_allowed", async () => {
    const { routes, propose } = withPropose({ record: page({ editors: ["person-e"] }) });
    expect((await call(routes, A, "/api/pages/page-1/proposals", "POST", { content: "<p>v2</p>", title: "Board v2" })).body).toEqual({ version: 2 });
    expect(propose.mock.calls[0]![1]).toEqual({ kind: "html", content: "<p>v2</p>", title: "Board v2", by: "person-a" });
    expect((await call(routes, as("person-e"), "/api/pages/page-1/proposals", "POST", { content: "<p>v3</p>" })).status).toBe(200);
    expect(propose.mock.calls[1]![1].by).toBe("person-e");
    const b = await call(routes, B, "/api/pages/page-1/proposals", "POST", { content: "<p>B's</p>" });
    expect(b.body.code).toBe("not_allowed");
    expect(propose).toHaveBeenCalledTimes(2);
  });

  it("refuses a proposal once the page reads personal data and is shared, and an undeclared one", async () => {
    const shared = withPropose({ personalShared: true, caps: { propose: true, data: ["team-board"] } });
    expect((await call(shared.routes, A, "/api/pages/page-1/proposals", "POST", { content: "<p>x</p>" })).body.code).toBe("shared_write_after_data");
    expect(shared.propose).not.toHaveBeenCalled();
    const none = world({ extra: { propose: vi.fn() } });
    expect((await call(none.routes, A, "/api/pages/page-1/proposals", "POST", { content: "<p>x</p>" })).body.code).toBe("not_declared");
  });

  it("masks secret-shaped text, as a person's own edit, and refuses an empty or oversized version", async () => {
    const { routes, propose } = withPropose();
    await call(routes, A, "/api/pages/page-1/proposals", "POST", { content: "<p>key sk-abc123</p>" });
    expect(propose.mock.calls[0]![1].content).toBe("<p>key [secret]</p>");
    expect((await call(routes, A, "/api/pages/page-1/proposals", "POST", { content: "  " })).body.code).toBe("bad_request");
    expect((await call(routes, A, "/api/pages/page-1/proposals", "POST", { content: "x".repeat(513 * 1024) })).body.code).toBe("too_large");
  });
});

describe("connector.call (lot 7): the reader's own connectors", () => {
  const CONNECTORS = { connectors: { GitHub: ["search_issues", "create_issue"] } };
  const accountOf = (who: string) => ({
    provider: "chatgpt-apps", instanceId: "i", slot: 0, key: `k-${who}`, label: `${who} account`, auth: "signed-in", at: 1,
    connectors: [{ name: "GitHub", state: "connected", tools: [{ id: "search_issues" }, { id: "create_issue" }] }],
  }) as unknown as ConnectorAccount;
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });
  // the bot's own approval path, as server/index.ts wires it: the reader's
  // rules and the organization's (rulesOf), their bot's level, and the
  // organization's Always allow policy on every page card
  function withConnectors(options: { full?: boolean; rule?: "deny" | "ask"; own?: { who: string; behavior: "deny" | "ask" | "allow" }; alwaysAllow?: boolean; keyed?: boolean; caps?: Partial<PageCapabilities>; who?: string[] } = {}) {
    const hubCall = vi.fn(async (input: { principalId: string; account: ConnectorAccount; tool: string; arguments: Record<string, unknown> }) => ({ text: `${input.tool} for ${input.principalId} on ${input.account.label}` }));
    const hub = { callable: () => true, ruleTool: (_p: unknown, entry: { name: string }, tool: string) => `${entry.name}__${tool}`, outbound: (id: string) => id.endsWith("create_issue"), call: hubCall } as unknown as ConnectorHub;
    const journal = vi.fn();
    const has = new Set(options.who ?? ["person-a", "person-b"]);
    const dir = mkdtempSync(join(tmpdir(), "page-rules-"));
    dirs.push(dir);
    const rules = new CustomRuleStore(join(dir, "rules.json"), () => NOW);
    if (options.rule) rules.addOrgRule({ when: "utiliser l'outil GitHub__create_issue", behavior: options.rule });
    if (options.rule) rules.addOrgRule({ when: "utiliser l'outil GitHub__search_issues", behavior: options.rule });
    if (options.own) rules.add({ ownerId: options.own.who, botId: null, when: "utiliser l'outil GitHub__create_issue", behavior: options.own.behavior });
    if (options.alwaysAllow === false) rules.setOrgAlwaysAllow(false);
    const made = world({
      caps: options.caps ?? CONNECTORS,
      extra: {
        approvals: new PageDataApprovals(null, () => NOW, () => rules.orgPolicy().alwaysAllow),
        connectors: {
          principal: (viewer) => viewer.principalId ?? "",
          accounts: (principalId) => (has.has(principalId) ? [accountOf(principalId)] : []),
          hub: () => hub,
          verdict: (viewer, input) => pageActVerdict({
            rules: rules.rulesOf(viewer.principalId ?? "", `bot-of-${viewer.principalId}`),
            call: { tool: input.tool, mcpTool: input.mcpTool, summary: input.summary, input: input.input, hints: { readOnly: input.readOnly } },
            botId: `bot-of-${viewer.principalId}`,
            level: options.full ? "full" : "ask",
            keyed: options.keyed === true,
            home: "/Users/example",
          }),
          journal,
        },
      },
    });
    return { ...made, hubCall, journal, rules };
  }
  const read = { connector: "GitHub", tool: "search_issues", arguments: { q: "bug" } };
  const change = { connector: "GitHub", tool: "create_issue", arguments: { title: "x" } };

  it("calls with the reader's own account, never the page owner's: B's answer is B's", async () => {
    const { routes, hubCall } = withConnectors();
    const b = await call(routes, B, "/api/pages/page-1/connector", "POST", read);
    expect(b.status).toBe(200);
    expect(b.body).toEqual({ connector: "GitHub", account: "person-b account", tool: "search_issues", text: "search_issues for person-b on person-b account" });
    expect(hubCall.mock.calls[0]![0]).toMatchObject({ principalId: "person-b", arguments: { q: "bug" } });
    expect(JSON.stringify(b.body)).not.toContain("person-a");
  });

  it("answers not_found to a reader who has no such connector, without reaching the owner's", async () => {
    const { routes, hubCall } = withConnectors({ who: ["person-a"] });
    expect((await call(routes, B, "/api/pages/page-1/connector", "POST", read)).body.code).toBe("not_found");
    expect(hubCall).not.toHaveBeenCalled();
  });

  it("refuses a connector or tool the version does not name exactly, and a reader not signed in", async () => {
    const { routes, hubCall } = withConnectors({ caps: { connectors: { GitHub: ["search_issues"] } } });
    expect((await call(routes, B, "/api/pages/page-1/connector", "POST", change)).body.code).toBe("not_declared");
    expect((await call(routes, B, "/api/pages/page-1/connector", "POST", { ...read, connector: "github" })).body.code).toBe("not_declared");
    expect((await call(routes, as(null), "/api/pages/page-1/connector", "POST", read)).body.code).toBe("sign_in");
    expect(hubCall).not.toHaveBeenCalled();
  });

  it("runs a read at once and writes it in the reader's journal", async () => {
    const { routes, journal } = withConnectors();
    expect((await call(routes, B, "/api/pages/page-1/connector", "POST", read)).status).toBe(200);
    expect(journal).toHaveBeenCalledWith(expect.objectContaining({ mcpTool: "GitHub__search_issues", decision: "auto-approved", source: "connector-read", viewer: { principalId: "person-b", computerOwner: false } }));
  });

  it("runs a change only from a click, and through the reader's card: Allow once is one call", async () => {
    const { routes, hubCall, journal } = withConnectors();
    expect((await call(routes, B, "/api/pages/page-1/connector", "POST", change)).body.code).toBe("bad_request");
    const asked = await call(routes, B, "/api/pages/page-1/connector", "POST", { ...change, click: true });
    expect(asked.status).toBe(409);
    expect(asked.body).toMatchObject({ code: "ask_first", source: "connector:GitHub__create_issue", label: "GitHub: create_issue (person-b account)", version: 1 });
    expect(hubCall).not.toHaveBeenCalled();
    // another person and a bot's act copy cannot answer the reader's card
    const id = String(asked.body.approvalId);
    expect((await call(routes, A, `/api/pages/page-1/data-approvals/${id}`, "POST", { answer: "once" })).status).toBe(404);
    expect((await call(routes, as("person-b", true), `/api/pages/page-1/data-approvals/${id}`, "POST", { answer: "once" })).status).toBe(403);
    expect((await call(routes, B, `/api/pages/page-1/data-approvals/${id}`, "POST", { answer: "once" })).status).toBe(200);
    expect((await call(routes, B, "/api/pages/page-1/connector", "POST", { ...change, click: true })).status).toBe(200);
    expect(hubCall).toHaveBeenCalledTimes(1);
    expect(journal).toHaveBeenLastCalledWith(expect.objectContaining({ decision: "user-approved", source: "user" }));
    // once was one call: the next change asks again
    expect((await call(routes, B, "/api/pages/page-1/connector", "POST", { ...change, click: true })).status).toBe(409);
    // A's own approval never covers B
    expect((await call(routes, A, "/api/pages/page-1/connector", "POST", { ...change, click: true })).status).toBe(409);
  });

  it("keeps Always allow for that page and tool", async () => {
    const { routes } = withConnectors();
    const asked = await call(routes, B, "/api/pages/page-1/connector", "POST", { ...change, click: true });
    await call(routes, B, `/api/pages/page-1/data-approvals/${String(asked.body.approvalId)}`, "POST", { answer: "always" });
    expect((await call(routes, B, "/api/pages/page-1/connector", "POST", { ...change, click: true })).status).toBe(200);
    expect((await call(routes, B, "/api/pages/page-1/connector", "POST", { ...change, click: true })).status).toBe(200);
  });

  it("runs a clicked change without a card at the reader's Full access, as their bot would", async () => {
    const { routes, journal } = withConnectors({ full: true });
    expect((await call(routes, B, "/api/pages/page-1/connector", "POST", { ...change, click: true })).status).toBe(200);
    expect(journal).toHaveBeenCalledWith(expect.objectContaining({ decision: "auto-approved", source: "full-access" }));
  });

  it("applies the organization's Deny and Ask first, even on a read and at Full access", async () => {
    const deny = withConnectors({ rule: "deny", full: true });
    expect((await call(deny.routes, B, "/api/pages/page-1/connector", "POST", read)).body).toMatchObject({ code: "denied", reason: "org_rule" });
    expect(deny.journal).toHaveBeenCalledWith(expect.objectContaining({ decision: "auto-denied" }));
    expect(deny.hubCall).not.toHaveBeenCalled();
    const ask = withConnectors({ rule: "ask", full: true });
    const asked = await call(ask.routes, B, "/api/pages/page-1/connector", "POST", read);
    expect(asked.status).toBe(409);
    // the card says the organization asks, not the page
    expect(asked.body).toMatchObject({ by: "org", always: true });
  });

  it("applies the reader's own Refuse rule at Full access, as their bot would; another reader's rule is not theirs", async () => {
    const { routes, hubCall, journal } = withConnectors({ full: true, own: { who: "person-b", behavior: "deny" } });
    const b = await call(routes, B, "/api/pages/page-1/connector", "POST", { ...change, click: true });
    expect(b.status).toBe(403);
    expect(b.body).toMatchObject({ code: "denied", reason: "person_rule" });
    expect(journal).toHaveBeenCalledWith(expect.objectContaining({ decision: "auto-denied", source: "custom-rule-deny" }));
    expect(hubCall).not.toHaveBeenCalled();
    // B's rule never reaches A: A at Full access runs the change
    expect((await call(routes, A, "/api/pages/page-1/connector", "POST", { ...change, click: true })).status).toBe(200);
    expect(hubCall.mock.calls[0]![0]).toMatchObject({ principalId: "person-a" });
  });

  it("holds a change at Full access for the reader's own Ask first rule or security key: their card says it is their rule", async () => {
    const own = withConnectors({ full: true, own: { who: "person-b", behavior: "ask" } });
    expect((await call(own.routes, B, "/api/pages/page-1/connector", "POST", { ...change, click: true })).body).toMatchObject({ code: "ask_first", by: "person" });
    expect(own.hubCall).not.toHaveBeenCalled();
    const keyed = withConnectors({ full: true, keyed: true });
    expect((await call(keyed.routes, B, "/api/pages/page-1/connector", "POST", { ...change, click: true })).body).toMatchObject({ code: "ask_first", by: "person" });
    expect(keyed.hubCall).not.toHaveBeenCalled();
  });

  it("runs a change at Ask for the reader's own Allow rule, as their bot would", async () => {
    const { routes, journal } = withConnectors({ own: { who: "person-b", behavior: "allow" } });
    expect((await call(routes, B, "/api/pages/page-1/connector", "POST", { ...change, click: true })).status).toBe(200);
    expect(journal).toHaveBeenCalledWith(expect.objectContaining({ decision: "auto-approved", source: "custom-rule" }));
    // A has no such rule: A's change asks
    expect((await call(routes, A, "/api/pages/page-1/connector", "POST", { ...change, click: true })).status).toBe(409);
  });

  it("never keeps Always allow while the organization turned it off, and the card does not offer it", async () => {
    const { routes, hubCall, rules } = withConnectors({ alwaysAllow: false });
    const asked = await call(routes, B, "/api/pages/page-1/connector", "POST", { ...change, click: true });
    expect(asked.body).toMatchObject({ code: "ask_first", by: "page", always: false });
    // an answer "always" counts once
    expect((await call(routes, B, `/api/pages/page-1/data-approvals/${String(asked.body.approvalId)}`, "POST", { answer: "always" })).status).toBe(200);
    expect((await call(routes, B, "/api/pages/page-1/connector", "POST", { ...change, click: true })).status).toBe(200);
    expect((await call(routes, B, "/api/pages/page-1/connector", "POST", { ...change, click: true })).status).toBe(409);
    expect(hubCall).toHaveBeenCalledTimes(1);
    // one kept before the organization turned it off is not honoured
    rules.setOrgAlwaysAllow(true);
    const again = await call(routes, B, "/api/pages/page-1/connector", "POST", { ...change, click: true });
    await call(routes, B, `/api/pages/page-1/data-approvals/${String(again.body.approvalId)}`, "POST", { answer: "always" });
    expect((await call(routes, B, "/api/pages/page-1/connector", "POST", { ...change, click: true })).status).toBe(200);
    rules.setOrgAlwaysAllow(false);
    expect((await call(routes, B, "/api/pages/page-1/connector", "POST", { ...change, click: true })).status).toBe(409);
  });
});
