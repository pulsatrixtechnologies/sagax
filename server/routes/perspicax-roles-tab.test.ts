import { describe, expect, it, vi } from "vitest";

import type { RequestAuth } from "../auth/request-auth.ts";
import { RoleJournal } from "../perspicax/role-journal.ts";
import { botClientName, type RolesTabBody } from "../../shared/role-graph.ts";
import { createPerspicaxRoleRoutes } from "./perspicax-roles.ts";
import { chainRoleRoutes, createRoleTabRoutes, type JournalCall } from "./perspicax-roles-tab.ts";
import { PASS, type RouteContext } from "./table.ts";

const NOW = Date.UTC(2026, 10, 5, 18, 0);
const MIN = 60_000;
const ALEX = "pr_alex";
const SAM = "pr_sam";
const permission = { module: "Time & Expense", func: "Time Entry", path: "time/entries", operation: "Add" as const };

function setup(journalAnswer: (principalId: string, path: string) => JournalCall = () => ({ ok: false })) {
  let clock = NOW - 60 * MIN;
  const journal = new RoleJournal(null, () => clock);
  const perspicaxGet = vi.fn(async (principalId: string, path: string) => journalAnswer(principalId, path));
  const sendToAdmins = vi.fn(() => 2);
  const route = createPerspicaxRoleRoutes({
    actor: (auth) => (auth.kind === "session" ? auth.session.principalId : undefined),
    mayUseBot: (_auth, botId) => botId === "nova" || botId === "atlas",
    answerTransition: () => ({ status: 200, body: {} }),
    rules: () => ({ status: 200, body: { rules: [] } }),
    removeRule: () => ({ status: 200, body: {} }),
    more: chainRoleRoutes(async () => PASS, createRoleTabRoutes({ journal, perspicaxGet, sendToAdmins, now: () => NOW })),
  });
  const as = (principalId: string) => ({ kind: "session", via: "cookie", scopes: ["client"], session: { id: `s-${principalId}`, principalId, scopes: ["client"] } }) as unknown as RequestAuth;
  const invoke = async (principalId: string, method: string, path: string, body?: unknown) => {
    const out: { status?: number; body?: unknown } = {};
    const ctx = {
      req: {}, res: { headersSent: false, writableEnded: false }, url: new URL(`http://127.0.0.1${path}`), path, method, auth: as(principalId),
      json: (_res: unknown, status: number, value: unknown) => { out.status = status; out.body = value; },
      readBody: async () => body,
    } as unknown as RouteContext;
    const result = await route(ctx);
    return { ...out, passed: result === PASS };
  };
  const at = (value: number) => { clock = value; };
  return { journal, invoke, perspicaxGet, sendToAdmins, at };
}

function seed(journal: RoleJournal, at: (value: number) => void) {
  journal.noteRoles(ALEX, [{ slug: "service-desk", name: "Service Desk", id: "prof-desk" }]);
  journal.noteRoles(SAM, [{ slug: "full-access", name: "Full Access", id: "prof-full" }]);
  at(NOW - 30 * MIN);
  journal.logTransition({ principalId: ALEX, botId: "nova", threadId: "th-alex", from: { slug: "service-desk", name: "Service Desk" }, to: { slug: "", name: "" }, reason: "fallback", refusedTool: "cw_psa_query" });
  journal.logTransition({ principalId: SAM, botId: "nova", threadId: "th-sam", from: { slug: "", name: "" }, to: { slug: "full-access", name: "Full Access" }, reason: "switch" });
  journal.logRefusal({ principalId: ALEX, botId: "nova", threadId: "th-alex", role: { slug: "service-desk", name: "Service Desk" }, tool: "cw_psa_log_time", kind: "write", permission, target: "cw_member:nova" });
  journal.logRefusal({ principalId: SAM, botId: "nova", threadId: "th-sam", role: { slug: "full-access", name: "Full Access" }, tool: "cw_psa_write", kind: "write", permission });
}

const iso = (value: number) => new Date(value).toISOString();

describe("GET /api/bots/:id/roles", () => {
  it("serves the asking person's graph and refusals only, never another person's", async () => {
    const { journal, invoke, at } = setup();
    seed(journal, at);
    const alex = await invoke(ALEX, "GET", "/api/bots/nova/roles");
    expect(alex.status).toBe(200);
    const body = alex.body as RolesTabBody;
    expect(body.journal).toBe("local");
    expect(body.edges).toMatchObject([{ from: "service-desk", to: "", count: 1, history: [{ threadId: "th-alex", reason: "fallback" }] }]);
    expect(body.missing).toMatchObject([{ role: { slug: "service-desk" }, member: "nova", count: 1 }]);
    const text = JSON.stringify(body);
    expect(text).not.toContain("th-sam");
    expect(text).not.toContain("full-access");

    const sam = (await invoke(SAM, "GET", "/api/bots/nova/roles")).body as RolesTabBody;
    expect(JSON.stringify(sam)).not.toContain("th-alex");
    expect(JSON.stringify(sam)).not.toContain("service-desk");
  });

  it("reads Perspicax's journal with the person's own bearer and drops rows of another bot or a profile not held", async () => {
    const rows = [
      { ts: iso(NOW - 31 * MIN), tool: "cw_psa_query", client_name: botClientName("nova"), mcp_session: "m1", acting_as: "prof-desk", outcome: "error" },
      { ts: iso(NOW - 30 * MIN), tool: "cw_psa_query", client_name: botClientName("nova"), mcp_session: "m1", acting_as: null, outcome: "ok" },
      // Sam's profile, and another bot: never Alex's graph
      { ts: iso(NOW - 29 * MIN), tool: "cw_psa_write", client_name: botClientName("nova"), mcp_session: "m1", acting_as: "prof-full", outcome: "ok" },
      { ts: iso(NOW - 28 * MIN), tool: "cw_psa_query", client_name: botClientName("atlas"), mcp_session: "m1", acting_as: "prof-desk", outcome: "ok" },
    ];
    const { journal, invoke, at, perspicaxGet } = setup(() => ({ ok: true, body: { items: rows, total: rows.length, page: 1, page_size: 200 } }));
    seed(journal, at);
    const body = (await invoke(ALEX, "GET", "/api/bots/nova/roles")).body as RolesTabBody;
    expect(perspicaxGet).toHaveBeenCalledTimes(1);
    const [principal, path] = perspicaxGet.mock.calls[0]!;
    expect(principal).toBe(ALEX);
    expect(path).toMatch(/^\/api\/v1\/me\/journal\/requests\?/);
    expect(new URL(`http://x${path}`).searchParams.get("client")).toBe("Pulsa Bot (nova)");
    expect(body.journal).toBe("perspicax");
    expect(body.edges).toMatchObject([{ from: "service-desk", to: "", count: 1, history: [{ source: "both", threadId: "th-alex", reason: "fallback", refusedTool: "cw_psa_query" }] }]);
    expect(body.nodes.map((node) => node.slug).sort()).toEqual(["", "service-desk"]);
    expect(JSON.stringify(body)).not.toContain("prof-full");
  });

  it("answers 404 for a bot the person may not use, and passes other role paths on", async () => {
    const { invoke } = setup();
    expect((await invoke(ALEX, "GET", "/api/bots/hidden/roles")).status).toBe(404);
    expect((await invoke(ALEX, "GET", "/api/bots/nova/roles/elsewhere")).passed).toBe(true);
    expect((await invoke(ALEX, "DELETE", "/api/bots/nova/roles")).status).toBe(405);
  });
});

describe("POST /api/bots/:id/roles/missing/send", () => {
  it("sends the person's own missing permission to the admins and marks it sent", async () => {
    const { journal, invoke, at, sendToAdmins } = setup();
    seed(journal, at);
    const [mine] = journal.refusalsFor(ALEX, "nova");
    const answer = await invoke(ALEX, "POST", "/api/bots/nova/roles/missing/send", { id: mine!.id });
    expect(answer.status).toBe(200);
    expect(sendToAdmins).toHaveBeenCalledWith(expect.objectContaining({ actor: ALEX, botId: "nova", missing: expect.objectContaining({ id: mine!.id, member: "nova" }) }));
    expect(journal.refusalsFor(ALEX, "nova")[0]!.sentAt).toBeDefined();
    const body = (await invoke(ALEX, "GET", "/api/bots/nova/roles")).body as RolesTabBody;
    expect(body.missing[0]!.sentAt).toBeDefined();
  });

  it("never sends another person's refusal, nor one of another bot", async () => {
    const { journal, invoke, at, sendToAdmins } = setup();
    seed(journal, at);
    const [sams] = journal.refusalsFor(SAM, "nova");
    expect((await invoke(ALEX, "POST", "/api/bots/nova/roles/missing/send", { id: sams!.id })).status).toBe(404);
    const [mine] = journal.refusalsFor(ALEX, "nova");
    expect((await invoke(ALEX, "POST", "/api/bots/atlas/roles/missing/send", { id: mine!.id })).status).toBe(404);
    expect((await invoke(ALEX, "POST", "/api/bots/nova/roles/missing/send", {})).status).toBe(400);
    expect(sendToAdmins).not.toHaveBeenCalled();
    expect(journal.refusalsFor(SAM, "nova")[0]!.sentAt).toBeUndefined();
  });

  it("says so when no administrator can be reached, and leaves the refusal unsent", async () => {
    const { journal, invoke, at, sendToAdmins } = setup();
    sendToAdmins.mockReturnValue(0);
    seed(journal, at);
    const [mine] = journal.refusalsFor(ALEX, "nova");
    expect((await invoke(ALEX, "POST", "/api/bots/nova/roles/missing/send", { id: mine!.id })).status).toBe(409);
    expect(journal.refusalsFor(ALEX, "nova")[0]!.sentAt).toBeUndefined();
  });
});
