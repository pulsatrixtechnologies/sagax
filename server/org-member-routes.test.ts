// The member API's gate, permissions, waits and readings, with fake deps
// (server/org-member-routes.ts). The real server path is
// org-member-api.e2e.test.ts.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConsoleAssertion } from "./oidc-rp.ts";
import { createOrgMemberRoutes, MEMBER_PROGRESS_MIN_MS, QUESTION_DECLINED_MESSAGE, readThreadPage, replyAfter, summarizeTurn, type MemberPerson, type MemberRequest, type OrgMemberRouteDeps, type ThreadStatus } from "./org-member-routes.ts";

const ISS = "https://perspicax.example";
const ORIGIN = "https://sagax.example";
type Person = { principalId: string; name: string; active: boolean; admin: boolean; permissions: string[] };
const people = new Map<string, Person>();
const tokens = new Map<string, ConsoleAssertion>();
let jti = 0;
let performed: Array<{ person: MemberPerson; request: MemberRequest }> = [];
let recorded: Array<{ person: MemberPerson; action: string; after?: Record<string, unknown> }> = [];
let respond: (request: MemberRequest) => { status: number; body: unknown } = () => ({ status: 404, body: { error: "no" } });
let status: () => ThreadStatus | null = () => "idle";
let live: () => string | null = () => null;
let noted: Array<{ principalId: string; threadId: string; requestId: string }> = [];
let cards = new Map<string, { open: boolean; ownerPrincipalId: string | null; ownerName: string | null; adminOnly: boolean }>();
let clock = 1_000_000;
/** The person's open hidden conversation with a bot (#291). */
let hiddenThread: (botId: string, principalId: string) => string | null = () => "t1";
/** Confidential threads (#683): an AI client never reaches them. */
let confidentialThreads = new Set<string>();
/** The agent API's answer (server/agent-api.ts), faked. */
let agentReply: (tool: string, args: unknown) => { status: number; body: Record<string, unknown> } = () => ({ status: 404, body: {} });

function token(sub: string, role: ConsoleAssertion["role"] = "employee", actor: ConsoleAssertion["actor"] = "perspicax-mcp"): string {
  jti += 1;
  const id = `t${jti}`;
  tokens.set(id, { iss: ISS, sub, jti: `jti-member-${String(jti).padStart(8, "0")}`, iat: 0, exp: Math.floor(clock / 1000) + 60, serverId: "srv", role, teams: [], actor });
  return id;
}

const deps: OrgMemberRouteDeps = {
  identity: "perspicax",
  issuer: ISS,
  publicOrigin: () => ORIGIN,
  linkServerId: () => "srv",
  verify: async (bearer) => {
    const found = tokens.get(bearer);
    if (!found) throw new Error("The assertion does not verify.");
    return found;
  },
  personFor: (_iss, sub) => {
    const person = people.get(sub);
    return person ? { principalId: person.principalId, name: person.name, active: person.active, admin: person.admin } : null;
  },
  permissions: (principalId) => ({ admin: false, permissions: [...people.values()].find((p) => p.principalId === principalId)?.permissions ?? [] }),
  perform: async (person, request) => {
    performed.push({ person, request });
    return respond(request);
  },
  threadStatus: () => status(),
  resolvePerson: (ref) => [...people.entries()].find(([sub, p]) => sub === ref || p.principalId === ref)?.[1].principalId ?? null,
  record: (person, entry) => recorded.push({ person, action: entry.action, ...(entry.after ? { after: entry.after } : {}) }),
  liveText: () => live(),
  threadLink: (threadId, botId) => `${ORIGIN}/#thread=${threadId}${botId ? `&bot=${botId}` : ""}`,
  botOfThread: (threadId) => (threadId === "t1" ? "b1" : null),
  hiddenThreadOf: (botId, principalId) => hiddenThread(botId, principalId),
  confidential: (threadId) => confidentialThreads.has(threadId),
  agentApi: async (_person, tool, args) => agentReply(tool, args),
  noteAnsweredVia: (person, threadId, requestId) => noted.push({ principalId: person.principalId, threadId, requestId }),
  approvalAnswerer: (threadId, requestId) => {
    const card = cards.get(`${threadId}/${requestId}`);
    return card ? { found: true, ...card } : null;
  },
  version: () => "0.4.16",
  now: () => clock,
  sleep: async (ms) => {
    clock += ms;
  },
};

let server: Server;
let base = "";
beforeAll(async () => {
  const handle = createOrgMemberRoutes(deps);
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!(await handle(req, res, url))) {
      res.writeHead(418);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  people.clear();
  people.set("bob", { principalId: "pr_bob", name: "Bob", active: true, admin: false, permissions: ["clients.botsRead", "clients.botsMessage"] });
  people.set("ann", { principalId: "pr_ann", name: "Ann", active: true, admin: true, permissions: [] });
  people.set("out", { principalId: "pr_out", name: "Out", active: false, admin: false, permissions: ["clients.botsRead"] });
  performed = [];
  recorded = [];
  status = () => "idle";
  live = () => null;
  noted = [];
  cards = new Map();
  respond = () => ({ status: 404, body: { error: "no" } });
  hiddenThread = () => "t1";
  confidentialThreads = new Set();
  agentReply = () => ({ status: 404, body: {} });
  deps.readBotMemory = undefined;
});

/** A Sagax holding these cards in thread t1 (or `thread`): the page read
 * shows them, POST respond settles the one it names and closes it in the
 * store, as Sagax does, unless `keepOpen`. `delay` holds the respond. */
function serveCards(list: Array<Record<string, unknown>>, options: { thread?: string; keepOpen?: boolean; delay?: Promise<void>; owner?: string } = {}) {
  const thread = options.thread ?? "t1";
  for (const c of list) cards.set(`${thread}/${c.requestId as string}`, { open: c.answered === undefined, ownerPrincipalId: options.owner ?? "pr_bob", ownerName: "Bob", adminOnly: false });
  respond = ((request: MemberRequest) => {
    if (request.path.endsWith("/respond")) {
      const body = request.body as { requestId: string; behavior: string };
      const settle = () => {
        const c = list.find((entry) => entry.requestId === body.requestId);
        if (c && !options.keepOpen) {
          c.answered = body.behavior;
          cards.set(`${thread}/${body.requestId}`, { ...cards.get(`${thread}/${body.requestId}`)!, open: false });
        }
        return { status: 200, body: { ok: true, outcome: "answered" } };
      };
      return options.delay ? options.delay.then(settle) : settle();
    }
    return { status: 200, body: { messages: list.map((c, index) => ({ id: `c${index}`, role: "bot", kind: "options", at: 100 + index, card: c })) } };
  }) as typeof respond;
}
const respondCalls = () => performed.filter((p) => p.request.path.endsWith("/respond")).map((p) => p.request.body);
const bashCard = (extra: Record<string, unknown> = {}) => ({ title: "Run Bash?", subtitle: "uptime", options: ["Allow", "Deny"], requestId: "req_1", requestType: "permission", tool: "Bash", ...extra });
/** The real case: Quasar's ask_user with three options. */
const deliveryCard = (extra: Record<string, unknown> = {}) => ({ title: "Your bot has a question", subtitle: "Where should I deliver?", options: ["Livrer ici", "Livrer ici et par le relais", "Non"], requestId: "req_q", requestType: "question", ...extra });

async function call(method: string, path: string, bearer?: string, body?: unknown) {
  const res = await fetch(`${base}/api/org/member/${path}`, {
    method,
    headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as any, headers: res.headers };
}

describe("the member API gate", () => {
  it("keeps the marker and logs when a lookup throws before the route", async () => {
    const original = deps.personFor;
    const logged: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((line: unknown) => {
      logged.push(String(line));
    });
    deps.personFor = () => {
      throw new Error("directory exploded");
    };
    try {
      const got = await call("GET", "capabilities", token("bob"));
      expect(got.status).toBe(500);
      expect(got.headers.get("x-sagax-member-api")).toBe("1");
      expect(got.body.code).toBe("server_error");
      expect(logged.some((line) => line.includes("[org-member] GET capabilities") && line.includes("directory exploded"))).toBe(true);
    } finally {
      deps.personFor = original;
      spy.mockRestore();
    }
  });

  it("answers only with a fresh assertion for an active person, never twice the same", async () => {
    expect((await call("GET", "capabilities")).body.code).toBe("assertion_missing");
    expect((await call("GET", "capabilities", "nope")).body.code).toBe("assertion_invalid");
    expect((await call("GET", "capabilities", token("stranger"))).body.code).toBe("unknown_person");
    expect((await call("GET", "capabilities", token("out"))).body.code).toBe("person_disabled");
    const once = token("bob");
    const first = await call("GET", "capabilities", once);
    expect(first.status).toBe(200);
    expect(first.headers.get("x-sagax-member-api")).toBe("1");
    expect(first.body).toMatchObject({ api: 1, version: "0.4.16" });
    expect(first.body.routes).toEqual(expect.arrayContaining(["GET bots", "POST bots/{id}/messages", "GET threads/{id}", "GET routines", "GET routines/{id}", "PATCH routines/{id}", "POST routines/{id}/run", "GET routines/runs/{id}", "GET bots/{id}/rules", "GET bots/{id}/docs", "GET bots/{id}/memory", "GET bots/{id}/connectors", "POST approvals/{id}", "POST people/{id}/nudge"]));
    expect((await call("GET", "capabilities", once)).body.code).toBe("assertion_replayed");
    expect((await call("GET", "nowhere", token("bob"))).status).toBe(404);
    expect((await call("POST", "bots", token("bob"), {})).status).toBe(405);
  });

  it("refuses a route without its permission, naming the key; an admin holds every key", async () => {
    const refused = await call("POST", "routines/r1/run", token("bob"), {});
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: "forbidden_permission", permission: "clients.routinesRun" });
    expect(performed).toEqual([]);
    respond = () => ({ status: 201, body: { run: { id: "run_1", routineId: "r1", status: "queued", botId: "b1" } } });
    const allowed = await call("POST", "routines/r1/run", token("ann", "admin"), {});
    expect(allowed.status).toBe(201);
    expect(allowed.body.run).toMatchObject({ id: "run_1", routineId: "r1", status: "queued" });
    expect(performed[0]).toMatchObject({ person: { principalId: "pr_ann", admin: true }, request: { method: "POST", path: "/api/routines/r1/run" } });
    expect(recorded).toEqual([{ person: expect.objectContaining({ principalId: "pr_ann", actor: "perspicax-mcp" }), action: "client.routine_run", after: { runId: "run_1" } }]);
  });

  it("an admin role in the assertion alone does not make a member an admin", async () => {
    const refused = await call("POST", "routines/r1/run", token("bob", "admin"), {});
    expect(refused.body.permission).toBe("clients.routinesRun");
  });
});

describe("bots", () => {
  it("lists own, shared and catalogue bots with their status, and who can be messaged", async () => {
    respond = (request) => request.path === "/api/bots"
      ? { status: 200, body: { bots: [
        { id: "b1", name: "Orion", busy: true, activity: "working", threadId: "t1" },
        { id: "b2", name: "Beacon", busy: false, activity: "waiting-on-you", threadId: "t2" },
      ] } }
      : { status: 200, body: { entries: [
        { id: "b1", name: "Orion", title: "Ops", description: "", owner: { principalId: "pr_bob", name: "Bob" }, source: "mine", archived: false },
        { id: "b2", name: "Beacon", title: "", description: "", owner: { principalId: "pr_ann", name: "Ann" }, source: "shared", archived: false },
        { id: "b3", name: "Atlas", title: "", description: "", owner: { principalId: "pr_ann", name: "Ann" }, source: "organization", archived: false },
      ] } };
    const got = await call("GET", "bots", token("bob"));
    expect(got.status).toBe(200);
    expect(got.body.bots).toEqual([
      expect.objectContaining({ id: "b3", name: "Atlas", source: "organization", status: "idle", canMessage: false, threadId: null }),
      expect.objectContaining({ id: "b2", name: "Beacon", source: "shared", status: "waiting", canMessage: true, threadId: "t2" }),
      expect.objectContaining({ id: "b1", name: "Orion", source: "mine", status: "working", canMessage: true, threadId: "t1", owner: { principalId: "pr_bob", sub: "bob", name: "Bob" } }),
    ]);
  });
});

describe("sending", () => {
  const page = (...messages: Array<Record<string, unknown>>) => ({ status: 200, body: { messages } });

  it("waits for the reply and answers it, recording no text", async () => {
    let sent = false;
    let looks = 0;
    status = () => (sent && looks++ < 3 ? "working" : "idle");
    respond = (request) => {
      if (request.method === "POST") {
        sent = true;
        return { status: 202, body: { ok: true, threadId: "t1", message: { id: "m1" } } };
      }
      return page({ id: "m0", role: "bot", kind: "text", text: "earlier", at: 1 }, { id: "m1", role: "user", kind: "text", text: "hi", at: 2 },
        { id: "s1", role: "bot", kind: "activity", tool: { name: "Bash", ok: true } }, { id: "m2", role: "bot", kind: "text", text: "Done: 3 tickets.", at: 3 });
    };
    const got = await call("POST", "bots/b1/messages", token("bob"), { text: "hi", wait: 30 });
    expect(got.status).toBe(200);
    expect(got.body).toMatchObject({ botId: "b1", threadId: "t1", messageId: "m1", status: "done", pending: false, reply: "Done: 3 tickets.", cursor: "m2" });
    // the AI client continues its hidden conversation (#291), never the person's open chat
    expect(performed[0]!.request).toEqual({ method: "POST", path: "/api/bots/b1/messages", body: { text: "hi", threadId: "t1" } });
    expect(recorded).toEqual([{ person: expect.objectContaining({ principalId: "pr_bob" }), action: "client.message", after: { threadId: "t1", waited: true, hidden: true } }]);
    expect(JSON.stringify(recorded)).not.toContain("hi\"");
  });

  it("answers pending with the thread id when the bot is still working at the end of the wait", async () => {
    status = () => "working";
    respond = (request) => request.method === "POST"
      ? { status: 202, body: { ok: true, threadId: "t1", message: { id: "m1" } } }
      : page({ id: "m1", role: "user", kind: "text", text: "long job", at: 2 });
    const start = clock;
    const got = await call("POST", "bots/b1/messages", token("bob"), { text: "long job", wait: 5 });
    expect(got.body).toMatchObject({ threadId: "t1", pending: true, status: "working", reply: null, cursor: "m1" });
    expect(clock - start).toBeGreaterThanOrEqual(5_000);
  });

  it("stops waiting at a card and lists it", async () => {
    status = () => "waiting";
    respond = (request) => request.method === "POST"
      ? { status: 202, body: { ok: true, threadId: "t1", message: { id: "m1" } } }
      : page({ id: "m1", role: "user", kind: "text", text: "deploy", at: 2 },
        { id: "c1", role: "bot", kind: "options", card: { title: "Run Bash?", subtitle: "uptime", options: ["Allow", "Deny"], requestId: "req_1", tool: "Bash" } });
    const start = clock;
    const got = await call("POST", "bots/b1/messages", token("bob"), { text: "deploy", wait: 60 });
    expect(clock - start).toBeLessThan(1_000);
    expect(got.body).toMatchObject({ pending: true, status: "waiting", approvals: [{ id: "req_1", threadId: "t1", title: "Run Bash?", tool: "Bash", options: ["Allow", "Deny"] }] });
    // the card the turn waits on, in line, with how to answer it
    expect(got.body.approval).toMatchObject({ id: "req_1", threadId: "t1", kind: "permission", answerWith: "decision", choices: [] });
  });

  it("opens a new thread when asked, and passes a Sagax refusal through", async () => {
    respond = (request) => request.path.endsWith("/tasks")
      ? { status: 201, body: { task: { threadId: "t9" } } }
      : { status: 403, body: { error: "This bot is not yours to use." } };
    const got = await call("POST", "bots/b1/messages", token("bob"), { text: "hello", newThread: true });
    expect(performed.map((p) => p.request.path)).toEqual(["/api/bots/b1/tasks", "/api/bots/b1/messages"]);
    // #1170: a new thread is never hidden; the person can see and close it
    expect(performed[0]!.request.body).toEqual({ confidential: false });
    expect(performed[1]!.request.body).toEqual({ text: "hello", threadId: "t9" });
    expect(got.status).toBe(403);
    expect(got.body).toMatchObject({ code: "forbidden", message: "This bot is not yours to use." });
    expect(recorded).toEqual([]);
  });

  describe("an AI client works in a hidden conversation (#291)", () => {
    const sentTo = (threadId: string) => (request: MemberRequest) => request.path.endsWith("/tasks")
      ? { status: 201, body: { task: { threadId: "t9" } } }
      : request.method === "POST"
        ? { status: 202, body: { ok: true, threadId, message: { id: "m1" } } }
        : page({ id: "m1", role: "user", kind: "text", text: "x", at: 2 });

    it("starts the person's chat with the bot when they have none, never a hidden one (#1170)", async () => {
      hiddenThread = () => null;
      respond = sentTo("t9");
      const got = await call("POST", "bots/b1/messages", token("bob"), { text: "count the tickets" });
      expect(got.status).toBe(200);
      expect(performed.filter((p) => p.request.method === "POST").map((p) => [p.request.path, p.request.body])).toEqual([
        ["/api/bots/b1/tasks", { confidential: false }],
        ["/api/bots/b1/messages", { text: "count the tickets", threadId: "t9" }],
      ]);
      expect(recorded[0]!.after).toEqual({ threadId: "t9", waited: false, hidden: true });
    });

    it("continues the hidden conversation it already has with that bot, for that person", async () => {
      const asked: string[] = [];
      hiddenThread = (botId, principalId) => {
        asked.push(`${botId}/${principalId}`);
        return "t7";
      };
      respond = sentTo("t7");
      await call("POST", "bots/b1/messages", token("bob"), { text: "again" });
      expect(asked).toEqual(["b1/pr_bob"]);
      expect(performed.filter((p) => p.request.method === "POST").map((p) => [p.request.path, p.request.body])).toEqual([["/api/bots/b1/messages", { text: "again", threadId: "t7" }]]);
    });

    it("honors a thread the client names, as given", async () => {
      respond = sentTo("t5");
      await call("POST", "bots/b1/messages", token("bob"), { text: "here", threadId: "t5" });
      expect(performed.filter((p) => p.request.method === "POST").map((p) => [p.request.path, p.request.body])).toEqual([["/api/bots/b1/messages", { text: "here", threadId: "t5" }]]);
      expect(recorded[0]!.after).toEqual({ threadId: "t5", waited: false });
    });

    it("the Perspicax console is the person typing: their own conversation, nothing hidden", async () => {
      respond = sentTo("t1");
      await call("POST", "bots/b1/messages", token("bob", "employee", "console"), { text: "from the console" });
      expect(performed.filter((p) => p.request.method === "POST").map((p) => [p.request.path, p.request.body])).toEqual([["/api/bots/b1/messages", { text: "from the console" }]]);
      expect(recorded[0]!.after).toEqual({ threadId: "t1", waited: false });
    });
  });

  it("checks its body", async () => {
    for (const body of [{}, { text: "" }, { text: "x", wait: 121 }, { text: "x", wait: -1 }, { text: "x", extra: 1 }, { text: "x", threadId: "a/b" }, { text: "x", threadId: "t1", newThread: true }, { text: "x", sendId: "short" }]) {
      expect((await call("POST", "bots/b1/messages", token("bob"), body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(performed).toEqual([]);
  });
});

describe("threads, approvals and nudges", () => {
  it("reads the messages after a cursor, the steps and the pending cards", () => {
    const read = readThreadPage("t1", { messages: [
      { id: "m1", role: "user", kind: "text", text: "go", at: 1, sender: { name: "Bob" } },
      { id: "s1", role: "bot", kind: "activity", tool: { name: "Read", ok: true, input: "secret path" } },
      { id: "c1", role: "bot", kind: "options", card: { title: "Allow?", subtitle: "", options: ["Allow"], requestId: "r1" } },
      { id: "c2", role: "bot", kind: "options", card: { title: "Old", subtitle: "", options: [], requestId: "r0", answered: "allow" } },
      { id: "m2", role: "bot", kind: "text", text: "half way", at: 3 },
    ] }, "m1");
    expect(read.messages).toEqual([{ id: "m2", role: "bot", kind: "text", text: "half way", at: 3, sender: null }]);
    expect(read.steps).toEqual({ count: 1, recent: [{ tool: "Read", ok: true }] });
    expect(read.approvals.map((a) => a.id)).toEqual(["r1"]);
    expect(read.cursor).toBe("m2");
    expect(read.gap).toBe(false);
    expect(JSON.stringify(read)).not.toContain("secret path");
    expect(readThreadPage("t1", { messages: [] }, "gone").gap).toBe(true);
    expect(replyAfter(read.messages, null)).toBe("half way");
    expect(replyAfter(read.messages, "m2")).toBeNull();
  });

  it("serves a thread through the person's own read", async () => {
    status = () => "working";
    respond = () => ({ status: 200, body: { messages: [{ id: "m1", role: "user", kind: "text", text: "go", at: 1 }, { id: "m2", role: "bot", kind: "text", text: "on it", at: 2 }] } });
    const got = await call("GET", "threads/t1?since=m1", token("bob"));
    expect(got.body).toMatchObject({ threadId: "t1", status: "working", messages: [{ id: "m2", text: "on it" }], cursor: "m2" });
    expect(performed[0]!.request).toMatchObject({ method: "GET", path: "/api/threads/t1/messages" });
    respond = () => ({ status: 404, body: { error: "no such conversation" } });
    expect((await call("GET", "threads/t1", token("bob"))).body).toMatchObject({ code: "not_found", message: "no such conversation" });
  });

  it("answers a card as the person and nudges by Perspicax user id", async () => {
    people.get("bob")!.permissions.push("clients.approvalsAnswer", "clients.peopleNudge");
    serveCards([bashCard()], { owner: "pr_ann" });
    expect((await call("POST", "approvals/req_1", token("bob"), { decision: "maybe", threadId: "t1" })).status).toBe(400);
    const answered = await call("POST", "approvals/req_1", token("bob"), { decision: "deny", threadId: "t1" });
    expect(answered.body).toEqual({ answered: true, closed: true, decision: "deny", state: "denied" });
    expect(performed.findLast((p) => p.request.method === "POST")!.request).toEqual({ method: "POST", path: "/api/threads/t1/respond", body: { requestId: "req_1", behavior: "deny" } });
    respond = (request) => request.path === "/api/nudges" ? { status: 200, body: { ok: true, id: "n1", at: 5 } } : { status: 200, body: { ok: true } };
    const nudged = await call("POST", "people/ann/nudge", token("bob"), {});
    expect(nudged.body).toEqual({ ok: true, id: "n1", at: 5 });
    expect(performed.at(-1)!.request).toEqual({ method: "POST", path: "/api/nudges", body: { principalId: "pr_ann" } });
    expect((await call("POST", "people/nobody/nudge", token("bob"), {})).status).toBe(404);
    expect(recorded.map((r) => r.action)).toEqual(["client.approval", "client.nudge"]);
  });

  it("nudges from list_agents owner.principal_id alone (#1637)", async () => {
    people.get("bob")!.permissions.push("clients.peopleNudge");
    const owner = { principal_id: "pr_ann", name: "Ann" };
    agentReply = (tool) => tool === "list_agents"
      ? { status: 200, body: { agents: [{ id: "b1", name: "Orion", description: "", status: "idle", temporary: false, owner }] } }
      : { status: 404, body: {} };
    const listed = await call("POST", "agents/list_agents", token("bob"), {});
    expect(listed.status).toBe(200);
    expect((listed.body.agents as Array<{ owner: typeof owner }>)[0]?.owner).toEqual(owner);
    respond = (request) => request.path === "/api/nudges" ? { status: 200, body: { ok: true, id: "n2", at: 6 } } : { status: 200, body: { ok: true } };
    const nudged = await call("POST", `people/${owner.principal_id}/nudge`, token("bob"), {});
    expect(nudged.body).toEqual({ ok: true, id: "n2", at: 6 });
    expect(performed.at(-1)!.request).toEqual({ method: "POST", path: "/api/nudges", body: { principalId: "pr_ann" } });
    expect(recorded.map((r) => r.action)).toContain("client.nudge");
  });

  it("passes a refusal's permission through", async () => {
    people.get("bob")!.permissions.push("clients.routinesRun");
    respond = () => ({ status: 403, body: { error: "Only the bot's owner can run it now.", code: "run_now_not_allowed", permission: "routines.runNowAny" } });
    const got = await call("POST", "routines/r1/run", token("bob"), {});
    expect(got.status).toBe(403);
    expect(got.body).toMatchObject({ code: "forbidden_permission", permission: "routines.runNowAny", message: "Only the bot's owner can run it now." });
  });

  // JC 2026-11-01: "when I invoke routines they start but it is unclear what
  // started". sagax_routine_run (Perspicax) reaches this route.
  it("a start through the MCP passes on its receipt; a refused start says why and names the run under way", async () => {
    people.get("bob")!.permissions.push("clients.routinesRun");
    const receipt = "Started “Overdue invoices” on Ledger (run run_1). Status: queued. It is number 2 of 2 runs waiting for this bot.";
    respond = () => ({ status: 201, body: { run: { id: "run_1", routineId: "r1", status: "queued", botId: "b1", attention: "Waits for a free slot on this bot" },
      standing: { status: "queued", position: 2, queuedForBot: 2, reason: "Waits for a free slot on this bot" }, message: receipt } });
    const started = await call("POST", "routines/r1/run", token("bob"), {});
    expect(started.status).toBe(201);
    expect(started.body).toMatchObject({ message: receipt, standing: { position: 2, queuedForBot: 2 }, run: { id: "run_1", attention: "Waits for a free slot on this bot" } });

    respond = () => ({ status: 409, body: { error: "A run of this routine is already in progress.", code: "run_in_flight", runId: "run_0",
      message: "“Overdue invoices” already has a run under way (run run_0); no second run was started. Status: running now." } });
    const refused = await call("POST", "routines/r1/run", token("bob"), {});
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: "run_in_flight", runId: "run_0", message: expect.stringContaining("no second run was started") });
  });

  it("a run that completed with problems never reads as a plain success", async () => {
    people.get("bob")!.permissions.push("clients.routinesRun");
    respond = () => ({ status: 200, body: { runs: [{ id: "run_9", routineId: "r1", status: "completed", problems: "crm_login failed 2 times", startedAt: 1, finishedAt: 2 }] } });
    const got = await call("GET", "routines/runs/run_9", token("bob"));
    expect(got.body.run).toMatchObject({ id: "run_9", status: "completed", problems: "crm_login failed 2 times" });
  });
});

/** A streamed answer, split into its NDJSON events. */
async function stream(method: string, path: string, bearer: string, body?: unknown) {
  const res = await fetch(`${base}/api/org/member/${path}`, {
    method,
    headers: { authorization: `Bearer ${bearer}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, events: res.headers.get("content-type")?.startsWith("application/x-ndjson") ? text.trim().split("\n").map((line) => JSON.parse(line) as any) : [] };
}

describe("the streamed turn (lot C.3)", () => {
  const page = (...messages: Array<Record<string, unknown>>) => ({ status: 200, body: { messages } });
  const card = (answered?: Record<string, unknown>) => ({ id: "c1", role: "bot", kind: "options", card: { title: "Run Bash?", subtitle: "rm -rf build", options: ["Allow", "Deny"], requestId: "req_1", tool: "Bash", ...answered } });

  it("streams progress at most every 2 s with the steps and the words being written, then the approval, then a final waiting answer", async () => {
    let looks = 0;
    status = () => (looks++ < 30 ? "working" : "waiting");
    live = () => `Looking at the build ${looks}`;
    respond = (request) => request.method === "POST"
      ? { status: 202, body: { ok: true, threadId: "t1", message: { id: "m1" } } }
      : looks < 30
        ? page({ id: "m1", role: "user", kind: "text", text: "clean the build", at: 2 }, { id: "s1", role: "bot", kind: "activity", tool: { name: "Read", ok: true, input: "private" } })
        : page({ id: "m1", role: "user", kind: "text", text: "clean the build", at: 2 }, { id: "s1", role: "bot", kind: "activity", tool: { name: "Read", ok: true } }, card());
    const got = await stream("POST", "bots/b1/messages", token("bob"), { text: "clean the build", wait: 60, stream: true });
    expect(got.status).toBe(200);
    expect(got.headers.get("x-sagax-member-api")).toBe("1");
    const kinds = got.events.map((e) => e.event);
    expect(kinds[0]).toBe("started");
    expect(got.events[0]).toMatchObject({ botId: "b1", threadId: "t1", messageId: "m1" });
    expect(kinds.slice(-2)).toEqual(["approval", "final"]);
    const progress = got.events.filter((e) => e.event === "progress");
    expect(progress.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < progress.length; i += 1) expect(progress[i].elapsedMs - progress[i - 1].elapsedMs).toBeGreaterThanOrEqual(MEMBER_PROGRESS_MIN_MS);
    expect(progress[0]).toMatchObject({ status: "working", steps: { count: 1, recent: [{ tool: "Read", ok: true }] } });
    expect(progress[0].partial).toMatch(/^Looking at the build/);
    expect(got.text).not.toContain("private");
    expect(got.events.at(-2).approval).toMatchObject({ id: "req_1", threadId: "t1", tool: "Bash", title: "Run Bash?", options: ["Allow", "Deny"] });
    expect(got.events.at(-1)).toMatchObject({ status: "waiting", pending: true, threadId: "t1", summary: {
      approvals: [{ id: "req_1", tool: "Bash", decision: "pending", by: null, via: null }],
      threadUrl: `${ORIGIN}/#thread=t1&bot=b1`,
    } });
  });

  it("an approval answered from the AI client is marked with its via; the watch then ends with the structured summary", async () => {
    people.get("bob")!.permissions.push("clients.approvalsAnswer");
    serveCards([bashCard()]);
    expect((await call("POST", "approvals/req_1", token("bob"), { threadId: "t1", decision: "allow" })).body).toEqual({ answered: true, closed: true, decision: "allow", state: "allowed" });
    expect(noted).toEqual([{ principalId: "pr_bob", threadId: "t1", requestId: "req_1" }]);
    expect(recorded.at(-1)).toMatchObject({ action: "client.approval", after: { requestId: "req_1", decision: "allow" } });

    let looks = 0;
    // The waiting flag lags one look behind the answered card: keep watching.
    status = () => (looks++ === 0 ? "waiting" : looks < 6 ? "working" : "idle");
    respond = () => page(
      { id: "m0", role: "bot", kind: "text", text: "before", at: 1 },
      { id: "m1", role: "user", kind: "text", text: "clean the build", at: 2 },
      { id: "s1", role: "bot", kind: "activity", tool: { name: "Read", ok: true } },
      card({ answered: "allow", answeredBy: { kind: "session", name: "Bob", via: "ai-client" } }),
      { id: "s2", role: "bot", kind: "activity", tool: { name: "Bash", ok: true, files: ["build/clean.log"] } },
      { id: "s3", role: "bot", kind: "activity", tool: { name: "Write", ok: false, files: ["never.txt"] } },
      { id: "m2", role: "bot", kind: "text", text: "Build cleaned.", at: 3 },
      { id: "d1", role: "bot", kind: "digest", text: "", digest: { usage: { input: 1200, output: 300, costUsd: 0.0123 }, files: { added: ["build/clean.log", "notes.md"], changed: [], deleted: ["old.tmp"] } } },
    );
    const got = await stream("GET", "threads/t1/stream?anchor=m1&wait=60", token("bob"));
    expect(got.status).toBe(200);
    expect(got.events[0]).toMatchObject({ event: "started", botId: "b1", threadId: "t1", messageId: "m1" });
    expect(got.events.some((e) => e.event === "approval")).toBe(false);
    const final = got.events.at(-1);
    expect(final).toMatchObject({ event: "final", status: "done", pending: false, reply: "Build cleaned.", approvals: [] });
    expect(final.summary).toEqual({
      text: "Build cleaned.",
      toolCalls: [{ tool: "Read", ok: true }, { tool: "Bash", ok: true }, { tool: "Write", ok: false }],
      toolCallCount: 3,
      files: ["build/clean.log", "notes.md"],
      cost: { inputTokens: 1200, outputTokens: 300, costUsd: 0.0123, turns: 1 },
      approvals: [{ id: "req_1", tool: "Bash", title: "Run Bash?", decision: "allow", by: "Bob", via: "ai-client" }],
      threadUrl: `${ORIGIN}/#thread=t1&bot=b1`,
    });
  });

  it("a thread the person cannot read, a missing permission or a bad wait is refused as JSON, before any stream", async () => {
    respond = () => ({ status: 404, body: { error: "no such conversation" } });
    const unreadable = await stream("GET", "threads/t1/stream?wait=5", token("bob"));
    expect(unreadable.status).toBe(404);
    expect(JSON.parse(unreadable.text)).toMatchObject({ code: "not_found" });
    expect((await call("GET", "threads/t1/stream?wait=0", token("bob"))).status).toBe(400);
    expect((await call("GET", "threads/t1/stream?anchor=a/b", token("bob"))).status).toBe(400);
    people.get("bob")!.permissions = ["clients.botsMessage"];
    const refused = await call("GET", "threads/t1/stream", token("bob"));
    expect(refused.body).toMatchObject({ code: "forbidden_permission", permission: "clients.botsRead" });
    expect((await call("POST", "bots/b1/messages", token("bob"), { text: "x", stream: "yes" })).status).toBe(400);
  });

  it("a send without stream still answers JSON, now with the summary", async () => {
    respond = (request) => request.method === "POST"
      ? { status: 202, body: { ok: true, threadId: "t1", message: { id: "m1" } } }
      : page({ id: "m1", role: "user", kind: "text", text: "hi", at: 2 }, { id: "m2", role: "bot", kind: "text", text: "Hello.", at: 3 });
    const got = await call("POST", "bots/b1/messages", token("bob"), { text: "hi", wait: 10 });
    expect(got.headers.get("content-type")).toContain("application/json");
    expect(got.body).toMatchObject({ status: "done", reply: "Hello.", summary: { text: "Hello.", toolCallCount: 0, files: [], cost: null, approvals: [] } });
  });

  it("summarizes what followed the anchor only, with every card outcome", () => {
    const summary = summarizeTurn({ messages: [
      { id: "s0", role: "bot", kind: "activity", tool: { name: "Old", ok: true, files: ["old.txt"] } },
      { id: "m1", role: "user", kind: "text", text: "go" },
      { id: "c1", role: "bot", kind: "options", card: { title: "A", requestId: "r1", answered: "deny", answeredBy: { kind: "session", name: "Ann" } } },
      { id: "c2", role: "bot", kind: "options", card: { title: "B", requestId: "r2", expired: true } },
      { id: "c3", role: "bot", kind: "options", card: { title: "C", requestId: "r3", answered: "answer", answeredBy: { kind: "loopback" } } },
      { id: "d1", role: "bot", kind: "digest", digest: { usage: { input: 10, output: 5 } } },
      { id: "d2", role: "bot", kind: "digest", digest: { usage: { input: 1, output: 2, costUsd: 0.5 } } },
    ] }, "m1", null);
    expect(summary.toolCalls).toEqual([]);
    expect(summary.files).toEqual([]);
    expect(summary.text).toBeNull();
    expect(summary.cost).toEqual({ inputTokens: 11, outputTokens: 7, costUsd: 0.5, turns: 2 });
    expect(summary.approvals.map((a) => [a.id, a.decision, a.by])).toEqual([["r1", "deny", "Ann"], ["r2", "expired", null], ["r3", "answered", "this computer"]]);
  });
});

describe("who may answer a card (lot C.3)", () => {
  const ok = () => ({ status: 200, body: { ok: true, messages: [] } });

  it("the bot's owner answers the cards of their own bots without clients.approvalsAnswer", async () => {
    serveCards([bashCard()]);
    const check = await call("GET", "approvals/req_1?threadId=t1", token("bob"));
    expect(check.body).toEqual({ id: "req_1", threadId: "t1", open: true, canAnswer: true, whoCanApprove: { kind: "owner", principalId: "pr_bob", name: "Bob", sentence: "The bot's owner, Bob." } });
    const answered = await call("POST", "approvals/req_1", token("bob"), { threadId: "t1", decision: "allow" });
    expect(answered.status, JSON.stringify(answered.body)).toBe(200);
    expect(respondCalls()).toEqual([{ requestId: "req_1", behavior: "allow" }]);
  });

  it("a member cannot answer on a bot they do not own; the permission alone does not beat Sagax's owner rule", async () => {
    cards.set("t2/req_2", { open: true, ownerPrincipalId: "pr_ann", ownerName: "Ann", adminOnly: false });
    respond = ok;
    const check = await call("GET", "approvals/req_2?threadId=t2", token("bob"));
    expect(check.body).toMatchObject({ canAnswer: false, permission: "clients.approvalsAnswer", whoCanApprove: { kind: "owner", principalId: "pr_ann", name: "Ann" } });
    const before = performed.length;
    const refused = await call("POST", "approvals/req_2", token("bob"), { threadId: "t2", decision: "allow" });
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: "forbidden_permission", permission: "clients.approvalsAnswer" });
    expect(performed.length).toBe(before);
    expect(noted).toEqual([]);
    // Granted by an admin: the gate lets them through, the check still names
    // Sagax's own rule (the owner answers).
    people.get("bob")!.permissions.push("clients.approvalsAnswer");
    const granted = await call("GET", "approvals/req_2?threadId=t2", token("bob"));
    expect(granted.body).toMatchObject({ canAnswer: false, reason: "Only the bot owner can answer this approval." });
    expect(granted.body.permission).toBeUndefined();
  });

  it("an admin answers a server command of a member's bot; the member owner cannot", async () => {
    serveCards([bashCard({ requestId: "req_3" })], { thread: "t3" });
    cards.set("t3/req_3", { open: true, ownerPrincipalId: "pr_bob", ownerName: "Bob", adminOnly: true });
    const admin = await call("GET", "approvals/req_3?threadId=t3", token("ann", "admin"));
    expect(admin.body).toMatchObject({ canAnswer: true, whoCanApprove: { kind: "admin" } });
    const owner = await call("GET", "approvals/req_3?threadId=t3", token("bob"));
    expect(owner.body).toMatchObject({ canAnswer: false, reason: "Only an organization admin can approve this command.", whoCanApprove: { kind: "admin", sentence: expect.stringContaining("organization admin") } });
    expect((await call("POST", "approvals/req_3", token("ann", "admin"), { threadId: "t3", decision: "deny" })).status).toBe(200);
  });

  it("an answered card, an unknown card or an unreadable thread is said so", async () => {
    cards.set("t1/req_9", { open: false, ownerPrincipalId: "pr_bob", ownerName: "Bob", adminOnly: false });
    respond = ok;
    expect((await call("GET", "approvals/req_9?threadId=t1", token("bob"))).body).toMatchObject({ open: false, canAnswer: false });
    expect((await call("GET", "approvals/nope?threadId=t1", token("bob"))).status).toBe(404);
    expect((await call("GET", "approvals/req_9", token("bob"))).status).toBe(400);
    respond = () => ({ status: 404, body: { error: "no such conversation" } });
    expect((await call("GET", "approvals/req_9?threadId=t1", token("bob"))).body).toMatchObject({ code: "not_found", message: "no such conversation" });
  });
});

describe("the AI-client approval loop (2026-10-17)", () => {
  it("describes how each card is answered: permission by decision, question by option", () => {
    const read = readThreadPage("t1", { messages: [
      { id: "c1", role: "bot", kind: "options", at: 5, card: bashCard() },
      { id: "c2", role: "bot", kind: "options", at: 6, card: deliveryCard({ expiresAt: 99 }) },
      { id: "c3", role: "bot", kind: "options", at: 7, card: { title: "Q", subtitle: "", options: [], requestId: "req_m", requestType: "question",
        questionRequest: { version: 1, questions: [{ question: "Which file?", options: [{ label: "README" }, { label: "Guide" }] }, { question: "Which branch?", options: [{ label: "main" }, { label: "dev" }], custom: false }] } } },
      { id: "c4", role: "bot", kind: "options", at: 8, card: { title: "Save this routine?", subtitle: "", options: ["Save", "Not now"], requestId: "req_r", routineRequest: { version: 1 } } },
    ] }, null);
    const [bash, delivery, several, routine] = read.approvals;
    expect(bash).toMatchObject({ kind: "permission", answerWith: "decision", choices: [], options: ["Allow", "Deny"], createdAt: 5, freeText: false });
    expect(delivery).toMatchObject({ kind: "question", answerWith: "option", freeText: true, expiresAt: 99,
      choices: [{ id: "1", label: "Livrer ici" }, { id: "2", label: "Livrer ici et par le relais" }, { id: "3", label: "Non" }] });
    expect(several).toMatchObject({ kind: "question", choices: [], freeText: false, questions: [
      { question: "Which file?", options: [{ id: "1", label: "README" }, { id: "2", label: "Guide" }] },
      { question: "Which branch?", options: [{ id: "1", label: "main" }, { id: "2", label: "dev" }] },
    ] });
    expect(routine).toMatchObject({ kind: "request", answerWith: "decision", choices: [{ id: "1", label: "Save" }, { id: "2", label: "Not now" }] });
  });

  it("a bare allow on a three-option question is 409 option_required with the options; nothing is answered", async () => {
    serveCards([deliveryCard()]);
    const got = await call("POST", "approvals/req_q", token("bob"), { threadId: "t1", decision: "allow" });
    expect(got.status).toBe(409);
    expect(got.body).toMatchObject({ code: "option_required", freeText: true, options: [{ id: "1", label: "Livrer ici" }, { id: "2", label: "Livrer ici et par le relais" }, { id: "3", label: "Non" }] });
    expect(got.body.message).toContain("1. Livrer ici; 2. Livrer ici et par le relais; 3. Non");
    expect(respondCalls()).toEqual([]);
    expect(recorded).toEqual([]);
    const unknown = await call("POST", "approvals/req_q", token("bob"), { threadId: "t1", option: "ailleurs" });
    expect(unknown.body).toMatchObject({ code: "option_unknown", options: expect.any(Array) });
  });

  it("an option by label or by id answers the question with its words and closes the card", async () => {
    serveCards([deliveryCard()]);
    const got = await call("POST", "approvals/req_q", token("bob"), { threadId: "t1", option: "livrer ici et par le relais" });
    expect(got.status, JSON.stringify(got.body)).toBe(200);
    expect(got.body).toEqual({ answered: true, closed: true, decision: "allow", state: "answered", option: "Livrer ici et par le relais" });
    expect(respondCalls()).toEqual([{ requestId: "req_q", behavior: "answer", message: "Livrer ici et par le relais" }]);
    expect(recorded.at(-1)).toMatchObject({ action: "client.approval", after: { requestId: "req_q", decision: "allow", answer: "option" } });
    expect(JSON.stringify(recorded)).not.toContain("relais");
    expect(noted).toEqual([{ principalId: "pr_bob", threadId: "t1", requestId: "req_q" }]);
    serveCards([deliveryCard({ requestId: "req_q2" })]);
    const byId = await call("POST", "approvals/req_q2", token("bob"), { threadId: "t1", option: "1" });
    expect(byId.body).toMatchObject({ closed: true, option: "Livrer ici" });
    expect(respondCalls().at(-1)).toEqual({ requestId: "req_q2", behavior: "answer", message: "Livrer ici" });
  });

  it("a bare allow takes the only option or the yes of a yes/no pair; deny takes the no, or declines", async () => {
    serveCards([deliveryCard({ requestId: "one", options: ["Go ahead"] }), deliveryCard({ requestId: "yn", options: ["Non", "Oui"] }), deliveryCard({ requestId: "yn2", options: ["Yes", "No"] }), deliveryCard({ requestId: "three" })]);
    expect((await call("POST", "approvals/one", token("bob"), { threadId: "t1", decision: "allow" })).body).toMatchObject({ closed: true, option: "Go ahead" });
    expect((await call("POST", "approvals/yn", token("bob"), { threadId: "t1", decision: "allow" })).body).toMatchObject({ closed: true, option: "Oui" });
    expect((await call("POST", "approvals/yn2", token("bob"), { threadId: "t1", decision: "deny" })).body).toMatchObject({ closed: true, decision: "deny", state: "denied", option: "No" });
    const declined = await call("POST", "approvals/three", token("bob"), { threadId: "t1", decision: "deny" });
    expect(declined.body).toMatchObject({ closed: true, decision: "deny", state: "denied" });
    expect(respondCalls().map((b) => (b as { message?: string }).message)).toEqual(["Go ahead", "Oui", "No", QUESTION_DECLINED_MESSAGE]);
  });

  it("text answers a question in the person's words; several questions take one option each", async () => {
    const questions = [{ question: "Which file?", options: [{ label: "README" }, { label: "Guide" }] }, { question: "Which branch?", options: [{ label: "main" }, { label: "dev" }] }];
    serveCards([deliveryCard({ requestId: "free" }), { title: "Q", subtitle: "", options: [], requestId: "multi", requestType: "question", questionRequest: { version: 1, questions } }]);
    expect((await call("POST", "approvals/free", token("bob"), { threadId: "t1", text: "Au bureau de Laval" })).body).toMatchObject({ closed: true, state: "answered" });
    expect(respondCalls().at(-1)).toEqual({ requestId: "free", behavior: "answer", message: "Au bureau de Laval" });
    const one = await call("POST", "approvals/multi", token("bob"), { threadId: "t1", option: "README" });
    expect(one.status).toBe(409);
    expect(one.body).toMatchObject({ code: "option_required", questions: [{ question: "Which file?" }, { question: "Which branch?" }] });
    const both = await call("POST", "approvals/multi", token("bob"), { threadId: "t1", option: ["Guide", "2"] });
    expect(both.body, JSON.stringify(both.body)).toMatchObject({ closed: true, option: "Guide | dev" });
    const message = (respondCalls().at(-1) as { message: string }).message;
    expect(message).toContain("Which file?");
    expect(message).toContain("Guide");
    expect(message).toContain("dev");
  });

  it("closed only once the card really is: an answer Sagax takes but leaves open is 409 not_closed", async () => {
    serveCards([bashCard()], { keepOpen: true });
    const got = await call("POST", "approvals/req_1", token("bob"), { threadId: "t1", decision: "allow" });
    expect(got.status).toBe(409);
    expect(got.body).toMatchObject({ code: "not_closed", closed: false });
    expect(got.body.answered).toBeUndefined();
    expect(recorded).toEqual([]);
  });

  it("idempotent: a closed card answers alreadyAnswered, and two calls at once answer it once", async () => {
    serveCards([bashCard()]);
    expect((await call("POST", "approvals/req_1", token("bob"), { threadId: "t1", decision: "allow" })).body).toMatchObject({ closed: true, state: "allowed" });
    const again = await call("POST", "approvals/req_1", token("bob"), { threadId: "t1", decision: "allow" });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ closed: true, alreadyAnswered: true, state: "allowed", decision: "allow" });
    expect(respondCalls()).toHaveLength(1);

    let release!: () => void;
    const delay = new Promise<void>((resolve) => { release = resolve; });
    serveCards([deliveryCard()], { delay });
    const first = call("POST", "approvals/req_q", token("bob"), { threadId: "t1", option: "Non" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const second = call("POST", "approvals/req_q", token("bob"), { threadId: "t1", option: "Non" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(a.body).toMatchObject({ closed: true, option: "Non" });
    expect(b.body).toMatchObject({ closed: true, alreadyAnswered: true });
    expect(respondCalls().filter((body) => (body as { requestId: string }).requestId === "req_q")).toHaveLength(1);
  });

  it("a confidential thread's card is never answered nor listed (#683)", async () => {
    serveCards([bashCard()]);
    confidentialThreads.add("t1");
    expect((await call("POST", "approvals/req_1", token("bob"), { threadId: "t1", decision: "allow" })).status).toBe(404);
    expect(respondCalls()).toEqual([]);
  });

  it("lists the person's pending approvals across their threads, through their own read, never a confidential one", async () => {
    status = () => "waiting";
    hiddenThread = (botId) => (botId === "b1" ? "h1" : null);
    const pages: Record<string, Array<Record<string, unknown>>> = {
      t1: [deliveryCard()],
      h1: [bashCard({ requestId: "req_h" })],
      t2: [bashCard({ requestId: "req_secret" })],
      t3: [bashCard({ requestId: "req_other" })],
    };
    for (const [thread, list] of Object.entries(pages)) for (const c of list) cards.set(`${thread}/${c.requestId as string}`, { open: true, ownerPrincipalId: "pr_bob", ownerName: "Bob", adminOnly: false });
    confidentialThreads.add("t2");
    respond = (request) => {
      if (request.path === "/api/bots") return { status: 200, body: { bots: [
        { id: "b1", name: "Quasar", threadId: "t1", tasks: [{ threadId: "t1" }, { threadId: "t2" }] },
        { id: "b2", name: "Atlas", threadId: "t3", tasks: [] },
      ] } };
      const thread = /\/api\/threads\/([\w-]+)\/messages/.exec(request.path)?.[1] ?? "";
      // Sagax's own read: t3 is someone else's private thread.
      if (thread === "t3") return { status: 404, body: { error: "no such conversation" } };
      return { status: 200, body: { messages: (pages[thread] ?? []).map((c, index) => ({ id: `${thread}-${index}`, role: "bot", kind: "options", at: thread === "h1" ? 50 : 60, card: c })) } };
    };
    const got = await call("GET", "approvals?status=pending", token("bob"));
    expect(got.status, JSON.stringify(got.body)).toBe(200);
    expect(got.body.count).toBe(2);
    expect(got.body.approvals.map((a: { id: string }) => a.id)).toEqual(["req_h", "req_q"]);
    expect(got.body.approvals[1]).toMatchObject({ threadId: "t1", botId: "b1", botName: "Quasar", kind: "question", canAnswer: true, choices: [{ id: "1", label: "Livrer ici" }, expect.anything(), expect.anything()] });
    expect(JSON.stringify(got.body)).not.toContain("req_secret");
    expect(JSON.stringify(got.body)).not.toContain("req_other");
    expect(performed.some((p) => p.request.path.includes("/t2/"))).toBe(false);
    expect((await call("GET", "approvals?status=done", token("bob"))).status).toBe(400);
    // an idle thread is not read at all
    status = () => "idle";
    performed = [];
    expect((await call("GET", "approvals", token("bob"))).body).toEqual({ approvals: [], count: 0 });
    expect(performed.map((p) => p.request.path)).toEqual(["/api/bots"]);
  });

  it("send_prompt and await_turn that stop on a card carry it in line, with what to call next", async () => {
    agentReply = (tool) => ({ status: 200, body: { handle: "turn_x", agent_id: "b1", thread_id: "t1", finished: false, status: "waiting_for_approval", reply: "", next: "old", tool } });
    serveCards([deliveryCard()]);
    const got = await call("POST", "agents/await_turn", token("bob"), { agent_id: "b1", handle: "turn_x" });
    expect(got.status).toBe(200);
    expect(got.body.approval).toMatchObject({ id: "req_q", threadId: "t1", answerWith: "option", choices: expect.any(Array) });
    expect(got.body.next).toContain("sagax_approve");
    expect(got.body.next).toContain("approval_id req_q");
    expect(got.body.next).toContain("option");
    // a finished turn is left as it was
    agentReply = () => ({ status: 200, body: { thread_id: "t1", finished: true, status: "finished", reply: "done" } });
    expect((await call("POST", "agents/await_turn", token("bob"), { agent_id: "b1" })).body).toEqual({ thread_id: "t1", finished: true, status: "finished", reply: "done" });
    // never a confidential thread's card
    agentReply = () => ({ status: 200, body: { thread_id: "t1", finished: false, status: "waiting_for_approval", reply: "" } });
    confidentialThreads.add("t1");
    expect((await call("POST", "agents/send_prompt", token("bob"), { agent_id: "b1", prompt: "x" })).body.approval).toBeUndefined();
  });
});

const PLANTED_KEY = "sk-ant-abcdefghijklmnopqrstuvwxyz";
const PLANTED_WEBHOOK = "whsec_plantedkeyvalue";
const LONG = "A".repeat(2500);

function routineFixture() {
  return {
    routines: [
      {
        id: "r_bob", name: "Morning", botId: "b1", enabled: true, nextRunAt: 50,
        owner: { id: "pr_bob", name: "Bob" },
        suspended: { reason: "paused", at: 4 },
        prompt: `${LONG} ${PLANTED_KEY} ${PLANTED_WEBHOOK}`,
        schedule: { type: "webhook", hour: 9, token: PLANTED_WEBHOOK, signingSecret: "keep-me-out" },
      },
      { id: "r_ann", name: "Ann's", botId: "b2", enabled: true, owner: { id: "pr_ann", name: "Ann" }, prompt: `ANN PROMPT ${PLANTED_KEY}`, schedule: { type: "daily" } },
      { id: "r_red", name: "Hidden", botId: "b1", enabled: true, owner: { id: "pr_bob" }, redacted: true, prompt: "SHOULD NOT LEAK" },
      { id: "r_none", name: "Nobody", botId: "b1", enabled: true, prompt: "NO OWNER" },
    ],
    runs: [
      { id: "run_old", routineId: "r_bob", status: "completed", startedAt: 10, finishedAt: 20, output: "SECRET OUTPUT" },
      { id: "run_new", routineId: "r_bob", status: "failed", startedAt: 30, endedAt: 40, output: "NEWER SECRET", error: "boom" },
      { id: "run_ann", routineId: "r_ann", status: "completed", startedAt: 99, output: "ANN OUTPUT" },
      { id: "run_redacted", routineId: "r_bob", redacted: true, status: "completed", startedAt: 100, output: "REDACTED OUTPUT" },
    ],
  };
}

function catalogFixture() {
  return {
    entries: [
      { id: "b1", source: "mine", name: "Orion", owner: { principalId: "pr_bob", name: "Bob" } },
      { id: "b2", source: "shared", name: "Beacon", owner: { principalId: "pr_ann", name: "Ann" } },
    ],
  };
}

describe("owner-scoped routine and bot reads", () => {
  it("refuses the reads without their permission and performs nothing", async () => {
    expect((await call("GET", "routines", token("bob"))).body).toMatchObject({ code: "forbidden_permission", permission: "clients.routinesRead" });
    people.get("bob")!.permissions = ["clients.botsMessage"];
    expect((await call("GET", "bots/b1/rules", token("bob"))).body).toMatchObject({ code: "forbidden_permission", permission: "clients.botsRead" });
    expect((await call("GET", "bots/b1/memory", token("bob"))).status).toBe(403);
    expect(performed).toEqual([]);
    expect(recorded).toEqual([]);
  });

  it("lists only the caller's routines, and the detail keeps the full redacted instructions", async () => {
    people.get("bob")!.permissions.push("clients.routinesRead");
    respond = (request) => request.path === "/api/routines" ? { status: 200, body: routineFixture() } : { status: 404, body: { error: "no" } };
    const listed = await call("GET", "routines", token("bob"));
    expect(listed.status).toBe(200);
    expect(listed.body.routines.map((row: { id: string }) => row.id)).toEqual(["r_bob"]);
    expect(listed.body.routines[0]).toEqual({
      id: "r_bob", name: "Morning", botId: "b1", enabled: true, suspended: { reason: "paused", at: 4 },
      schedule: { type: "webhook", hour: 9 }, nextRunAt: 50,
      lastRun: { id: "run_new", status: "failed", startedAt: 30, endedAt: 40 },
    });
    expect(JSON.stringify(listed.body)).not.toContain("instructions");
    expect(JSON.stringify(listed.body)).not.toContain("ANN PROMPT");
    expect(JSON.stringify(listed.body)).not.toContain("SHOULD NOT LEAK");
    expect(JSON.stringify(listed.body)).not.toContain("NO OWNER");
    expect(JSON.stringify(listed.body)).not.toContain(PLANTED_WEBHOOK);
    expect(JSON.stringify(listed.body)).not.toContain("SECRET OUTPUT");

    const detail = await call("GET", "routines/r_bob", token("bob"));
    expect(detail.status).toBe(200);
    expect(detail.body.routine.instructions.length).toBeGreaterThan(2000);
    expect(detail.body.routine.instructions).toContain("«redacted");
    expect(detail.body.routine.instructions).not.toContain(PLANTED_KEY);
    expect(detail.body.routine.instructions).not.toContain(PLANTED_WEBHOOK);
    expect(detail.body.routine.schedule).toEqual({ type: "webhook", hour: 9 });
    expect(detail.body.routine.lastRun).toEqual({ id: "run_new", status: "failed", startedAt: 30, endedAt: 40 });
    expect(JSON.stringify(detail.body)).not.toContain("output");
    expect(JSON.stringify(detail.body)).not.toContain("signingSecret");
    expect(recorded).toEqual([]);
  });

  it("hides another person's routine, an admin's view included, without returning its text", async () => {
    people.get("bob")!.permissions.push("clients.routinesRead");
    respond = () => ({ status: 200, body: routineFixture() });
    const missing = await call("GET", "routines/r_ann", token("bob"));
    expect(missing.status).toBe(404);
    expect(JSON.stringify(missing.body)).not.toContain("ANN PROMPT");
    const admin = await call("GET", "routines/r_bob", token("ann", "admin"));
    expect(admin.status).toBe(404);
    expect(JSON.stringify(admin.body)).not.toContain(PLANTED_KEY);
    expect(recorded).toEqual([]);
  });

  it("lets the owner enable, rename, reschedule and rewrite instructions; audits without the text (#1891)", async () => {
    people.get("bob")!.permissions.push("clients.routinesRead", "clients.routinesWrite");
    respond = (request) => {
      if (request.method === "GET" && request.path === "/api/routines") return { status: 200, body: routineFixture() };
      if (request.method === "PATCH" && request.path === "/api/routines/r_bob") {
        const body = (request.body && typeof request.body === "object" ? request.body : {}) as Record<string, unknown>;
        expect(body).toMatchObject({
          enabled: false,
          name: "Evening",
          prompt: "Report the close of day.",
          schedule: { type: "cron", expression: "0 18 * * 1-5", timeZone: "America/Toronto" },
        });
        expect(body).not.toHaveProperty("instructions");
        return {
          status: 200,
          body: {
            routine: {
              id: "r_bob",
              name: "Evening",
              botId: "b1",
              enabled: false,
              prompt: "Report the close of day.",
              schedule: { type: "cron", expression: "0 18 * * 1-5", timeZone: "America/Toronto" },
              nextRunAt: 90,
              owner: { id: "pr_bob" },
            },
          },
        };
      }
      return { status: 404, body: { error: "no" } };
    };
    const patched = await call("PATCH", "routines/r_bob", token("bob"), {
      enabled: false,
      name: "Evening",
      instructions: "Report the close of day.",
      schedule: { type: "cron", expression: "0 18 * * 1-5", timeZone: "America/Toronto" },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.routine).toMatchObject({
      id: "r_bob", name: "Evening", enabled: false,
      instructions: "Report the close of day.",
      schedule: { type: "cron", expression: "0 18 * * 1-5", timeZone: "America/Toronto" },
    });
    expect(performed.filter((entry) => entry.request.method === "PATCH")).toEqual([
      expect.objectContaining({
        person: expect.objectContaining({ principalId: "pr_bob" }),
        request: expect.objectContaining({
          method: "PATCH",
          path: "/api/routines/r_bob",
          body: expect.objectContaining({ enabled: false, name: "Evening", prompt: "Report the close of day." }),
        }),
      }),
    ]);
    expect(recorded).toEqual([{
      person: expect.objectContaining({ principalId: "pr_bob", actor: "perspicax-mcp" }),
      action: "client.routine_update",
      after: { fields: ["enabled", "name", "instructions", "schedule"] },
    }]);
    expect(JSON.stringify(recorded)).not.toContain("Report the close");
  });

  it("refuses a routine write without clients.routinesWrite and never performs (#1891 Ask/Deny)", async () => {
    people.get("bob")!.permissions = ["clients.routinesRead"];
    const refused = await call("PATCH", "routines/r_bob", token("bob"), { enabled: true });
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: "forbidden_permission", permission: "clients.routinesWrite" });
    expect(performed).toEqual([]);
    expect(recorded).toEqual([]);
  });

  it("refuses patching another person's routine without calling Sagax (#1891)", async () => {
    people.get("bob")!.permissions.push("clients.routinesWrite");
    respond = () => ({ status: 200, body: routineFixture() });
    const missing = await call("PATCH", "routines/r_ann", token("bob"), { enabled: false });
    expect(missing.status).toBe(404);
    expect(performed.every((entry) => entry.request.method !== "PATCH")).toBe(true);
    expect(recorded).toEqual([]);
    // An admin assertion still only manages routines they own as that person.
    const admin = await call("PATCH", "routines/r_bob", token("ann", "admin"), { enabled: false });
    expect(admin.status).toBe(404);
    expect(performed.filter((entry) => entry.request.method === "PATCH")).toEqual([]);
  });

  it("rejects an empty or unknown routine patch body (#1891)", async () => {
    people.get("bob")!.permissions.push("clients.routinesWrite");
    expect((await call("PATCH", "routines/r_bob", token("bob"), {})).body.code).toBe("bad_request");
    expect((await call("PATCH", "routines/r_bob", token("bob"), { botId: "b1" })).body).toMatchObject({
      code: "bad_request", message: expect.stringContaining("Unknown field"),
    });
    expect(performed).toEqual([]);
  });

  it("reads rules, documents, memory and connector names only for a bot the caller owns", async () => {
    const secretText = `${LONG} ${PLANTED_KEY} ${PLANTED_WEBHOOK}`;
    deps.readBotMemory = (botId) => botId === "b1" ? { text: secretText } : { text: "OTHER MEMORY" };
    respond = (request) => {
      if (request.path === "/api/bot-catalog") return { status: 200, body: catalogFixture() };
      if (request.path === "/api/bot-catalog/b1") {
        return { status: 200, body: {
          soul: "SOUL SECRET", memories: ["MEMORY SECRET"],
          integrations: [
            { name: "mail", kind: "mcp", url: "https://example.invalid/hook?token=abc" },
            { name: "browser", kind: "browser" },
            { name: "off", kind: "mcp", enabled: false },
          ],
        } };
      }
      if (request.path === "/api/bots/b1/workspace") {
        return { status: 200, body: {
          workspacePath: "/data/secret/path",
          soul: { path: "SOUL.md" },
          entries: [
            { path: "docs/notes.md", kind: "file" },
            { path: "RULES.md", kind: "file" },
            { path: "MEMORY.md", kind: "file" },
            { path: "docs", kind: "dir" },
            { path: "SOUL.md", kind: "file" },
          ],
        } };
      }
      if (request.path === "/api/bots/b1/workspace/file") {
        return { status: 200, body: { path: request.query?.path, text: secretText, hash: "deadbeefhash" } };
      }
      if (request.path === "/api/bots/b1/rules") {
        return { status: 200, body: { template: "TEMPLATE SECRET", sets: [{ id: "s1", name: "Hours", enabled: true, file: "rules/hours.md", text: secretText, hash: "abc" }] } };
      }
      return { status: 404, body: { error: "no" } };
    };

    const rules = await call("GET", "bots/b1/rules", token("bob"));
    expect(rules.status).toBe(200);
    expect(rules.body.rules).toContain("«redacted");
    expect(rules.body.rules).not.toContain(PLANTED_KEY);
    expect(rules.body.sets).toEqual([{ id: "s1", name: "Hours", enabled: true, text: expect.stringContaining("«redacted") }]);
    expect(JSON.stringify(rules.body)).not.toContain("deadbeefhash");
    expect(JSON.stringify(rules.body)).not.toContain("TEMPLATE SECRET");
    expect(JSON.stringify(rules.body)).not.toContain("rules/hours.md");

    const docs = await call("GET", "bots/b1/docs", token("bob"));
    expect(docs.body).toEqual({ docs: ["docs/notes.md"] });
    expect(JSON.stringify(docs.body)).not.toContain("workspacePath");
    expect(JSON.stringify(docs.body)).not.toContain("/data/secret");

    const one = await call("GET", "bots/b1/docs?path=docs/notes.md", token("bob"));
    expect(one.status).toBe(200);
    expect(one.body.path).toBe("docs/notes.md");
    expect(one.body.text.length).toBeGreaterThan(2000);
    expect(one.body.text).not.toContain(PLANTED_WEBHOOK);
    expect(one.body.hash).toBeUndefined();

    const memory = await call("GET", "bots/b1/memory", token("bob"));
    expect(memory.body.text).toContain("«redacted");
    expect(memory.body.text).not.toContain(PLANTED_KEY);
    expect(performed.some((row) => row.request.path.includes("/memory"))).toBe(false);

    const connectors = await call("GET", "bots/b1/connectors", token("bob"));
    expect(connectors.body.connectors).toEqual([
      { name: "mail", kind: "mcp", enabled: true, scope: "bot" },
      { name: "browser", kind: "browser", enabled: true, scope: "bot" },
      { name: "off", kind: "mcp", enabled: false, scope: "bot" },
    ]);
    const dumped = JSON.stringify(connectors.body);
    expect(dumped).not.toContain("token=");
    expect(dumped).not.toContain("SOUL SECRET");
    expect(dumped).not.toContain("MEMORY SECRET");
    expect(dumped).not.toContain("https://");
    expect(recorded).toEqual([]);
  });

  it("rejects a document path that is not docs/<name>.md before any read", async () => {
    for (const path of ["docs/../RULES.md", "RULES.md", "memory/topic.md", "docs/../../MEMORY.md"]) {
      performed = [];
      const got = await call("GET", `bots/b1/docs?path=${encodeURIComponent(path)}`, token("bob"));
      expect(got.status, path).toBe(400);
      expect(got.body.code).toBe("bad_request");
      expect(performed, path).toEqual([]);
    }
  });

  it("answers 404 for a bot the caller does not own and does not open its files", async () => {
    respond = (request) => request.path === "/api/bot-catalog" ? { status: 200, body: catalogFixture() } : { status: 200, body: { text: "LEAKED", sets: [], entries: [], integrations: [] } };
    for (const path of ["bots/b2/rules", "bots/b2/docs", "bots/b2/memory", "bots/b2/connectors"]) {
      performed = [];
      const got = await call("GET", path, token("bob"));
      expect(got.status, path).toBe(404);
      expect(JSON.stringify(got.body), path).not.toContain("LEAKED");
      expect(performed.map((row) => row.request.path), path).toEqual(["/api/bot-catalog"]);
    }
    performed = [];
    const admin = await call("GET", "bots/b1/rules", token("ann", "admin"));
    expect(admin.status).toBe(404);
    expect(performed.map((row) => row.request.path)).toEqual(["/api/bot-catalog"]);
    expect(recorded).toEqual([]);
  });
});
