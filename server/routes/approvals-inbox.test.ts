// The Approvals screen's routes with fake deps: who may read the list, what
// a bulk answer accepts, and that the server plans the bulk set again from
// the live cards (never what the client sent).
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { inboxKey, type InboxApproval } from "../../shared/approvals-inbox.ts";
import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../request-auth.ts";
import { createApprovalsInboxRoutes, inboxSpecialCard, type ApprovalsInboxDeps } from "./approvals-inbox.ts";
import { PASS } from "./table.ts";

function entry(id: string, patch: Partial<InboxApproval> = {}): InboxApproval {
  return {
    key: inboxKey("t1", id), threadId: "t1", requestId: id, botId: "b1", botName: "Nova",
    scope: "mine", kind: "permission", at: 1, decidable: true, bulk: true, ...patch,
  };
}

let server: Server;
let base = "";
let pending: InboxApproval[] = [];
let person: string | null = "pr_ada";
let answered: Array<{ requestId: string; decision: string; rule?: string }> = [];
let historyCalls = 0;

beforeEach(async () => {
  pending = [entry("r1"), entry("r2"), entry("q1", { kind: "question", bulk: "question" }), entry("k1", { needsKey: true, bulk: "needs-key" })];
  person = "pr_ada";
  answered = [];
  historyCalls = 0;
  const deps: ApprovalsInboxDeps = {
    viewer: () => (person ? { principalId: person } : null),
    pending: () => pending,
    history: () => {
      historyCalls++;
      return [{ at: "2026-10-19T12:00:00.000Z", decision: "allow", who: "Ada", botName: "Nova", threadId: "t1" }];
    },
    scopes: () => ({ org: false, team: false }),
    answer: async (_auth, item, decision, rule) => {
      answered.push({ requestId: item.requestId, decision, ...(rule ? { rule } : {}) });
      pending = pending.filter((row) => row.requestId !== item.requestId);
      return { ok: true };
    },
  };
  const handler = createApprovalsInboxRoutes(deps);
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    void handler({ req, res, url, path: url.pathname, method: req.method ?? "GET", auth: { kind: "loopback" } as unknown as RequestAuth, json, readBody })
      .then((out) => { if (out === PASS && !res.headersSent) json(res, 404, { error: "pass" }); });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const get = async (path: string) => {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json() as any };
};
const post = async (body: unknown) => {
  const res = await fetch(`${base}/api/approvals/bulk`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() as any };
};

describe("GET /api/approvals", () => {
  it("lists the person's cards and reads the history only when asked", async () => {
    const plain = await get("/api/approvals");
    expect(plain.status).toBe(200);
    expect(plain.body.pending).toHaveLength(4);
    expect(plain.body.history).toEqual([]);
    expect(historyCalls).toBe(0);
    const withHistory = await get("/api/approvals?history=1");
    expect(withHistory.body.history).toHaveLength(1);
    expect(historyCalls).toBe(1);
  });

  it("answers nothing to a caller that is no person", async () => {
    person = null;
    expect((await get("/api/approvals")).status).toBe(403);
    expect((await post({ decision: "allow", items: [{ threadId: "t1", requestId: "r1" }] })).status).toBe(403);
    expect(answered).toEqual([]);
  });

  it("passes other paths and methods on", async () => {
    expect((await get("/api/approvals/other")).body).toEqual({ error: "pass" });
    const res = await fetch(`${base}/api/approvals`, { method: "DELETE" });
    expect(await res.json()).toEqual({ error: "pass" });
  });
});

describe("POST /api/approvals/bulk", () => {
  it("answers the plain permissions once and leaves the rest, with the reason", async () => {
    const out = await post({ decision: "allow", items: ["r1", "r2", "q1", "k1", "gone"].map((requestId) => ({ threadId: "t1", requestId })) });
    expect(out.status).toBe(200);
    expect(out.body.answered).toBe(2);
    expect(answered).toEqual([{ requestId: "r1", decision: "allow" }, { requestId: "r2", decision: "allow" }]);
    const codes = Object.fromEntries(out.body.results.map((row: any) => [row.key, row.ok ? "ok" : row.code]));
    expect(codes).toEqual({ "t1:r1": "ok", "t1:r2": "ok", "t1:q1": "question", "t1:k1": "needs-key", "t1:gone": "gone" });
  });

  it("denies a card that needs a key for an Allow: a Deny never needs one", async () => {
    const out = await post({ decision: "deny", items: [{ threadId: "t1", requestId: "k1" }] });
    expect(out.body.answered).toBe(1);
    expect(answered).toEqual([{ requestId: "k1", decision: "deny" }]);
  });

  it("refuses anything that would remember a grant, whole, but each card's own Always allow", async () => {
    for (const extra of [{ always: true }, { rule: "deny" }, { rememberCommand: true }, { alwaysAllow: { botId: "b1", key: "Bash" } }, { stepUp: "x" }]) {
      const out = await post({ decision: "allow", items: [{ threadId: "t1", requestId: "r1" }], ...extra });
      expect(out.status).toBe(400);
      expect(out.body.code).toBe("bulk_once_only");
    }
    expect(answered).toEqual([]);
  });

  it("2026-10-19: a bulk Always allow passes rule allow to each card's answer, never with a Deny", async () => {
    const denied = await post({ decision: "deny", items: [{ threadId: "t1", requestId: "r1" }], rule: "allow" });
    expect(denied.status).toBe(400);
    expect(answered).toEqual([]);
    // 2026-10-20: one kind of rule only (same action, same type of target)
    pending = pending.map((row) => ({ ...row, alwaysRule: "x", alwaysKind: row.requestId === "r2" ? "mcp__cw__delete|id||" : "mcp__cw__update|id||" }));
    const mixed = await post({ decision: "allow", items: [{ threadId: "t1", requestId: "r1" }, { threadId: "t1", requestId: "r2" }], rule: "allow" });
    expect(mixed.status).toBe(409);
    expect(answered).toEqual([]);
    pending = pending.map((row) => ({ ...row, alwaysKind: "mcp__cw__update|id||" }));
    const out = await post({ decision: "allow", items: [{ threadId: "t1", requestId: "r1" }, { threadId: "t1", requestId: "r2" }], rule: "allow" });
    expect(out.status).toBe(200);
    expect(answered).toEqual([{ requestId: "r1", decision: "allow", rule: "allow" }, { requestId: "r2", decision: "allow", rule: "allow" }]);
  });

  it("refuses a malformed or oversized request", async () => {
    expect((await post({ decision: "maybe", items: [{ threadId: "t1", requestId: "r1" }] })).status).toBe(400);
    expect((await post({ decision: "allow", items: [] })).status).toBe(400);
    expect((await post({ decision: "allow", items: [{ threadId: "../x", requestId: "r1" }] })).status).toBe(400);
    expect((await post({ decision: "allow", items: Array.from({ length: 51 }, (_, i) => ({ threadId: "t1", requestId: `r${i}` })) })).status).toBe(400);
    expect(answered).toEqual([]);
  });

  it("plans from the live cards: a card the server no longer lists is not answered", async () => {
    pending = pending.map((row) => (row.requestId === "r2" ? { ...row, decidable: false, bulk: "not-yours" as const } : row));
    const out = await post({ decision: "allow", items: [{ threadId: "t1", requestId: "r2" }, { threadId: "t1", requestId: "r1" }, { threadId: "t1", requestId: "r1" }] });
    expect(answered).toEqual([{ requestId: "r1", decision: "allow" }]);
    expect(out.body.results).toHaveLength(2);
    expect(out.body.results.find((row: any) => row.key === "t1:r2").code).toBe("not-yours");
  });
});

describe("inboxSpecialCard", () => {
  const plain = { requestId: "r1", tool: "Bash", options: [] } as never;
  it("keeps a plain tool card bulk-answerable", () => {
    expect(inboxSpecialCard({ ...(plain as object), title: "Run" } as never)).toBe(false);
  });
  it("never lets a send in the person's name, an admin's card or a team memory into a bulk answer", () => {
    expect(inboxSpecialCard({ ...(plain as object), outboundRequest: { tool: "send_email", app: null } } as never)).toBe(true);
    expect(inboxSpecialCard({ ...(plain as object), adminApproval: true } as never)).toBe(true);
    expect(inboxSpecialCard({ ...(plain as object), teamMemoryRequest: { section: "s", entryId: "e" } } as never)).toBe(true);
  });
});
