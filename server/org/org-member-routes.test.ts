// The member API's gate, permissions, waits and readings, with fake deps
// (server/org/org-member-routes.ts). The real server path is
// org-member-api.e2e.test.ts.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConsoleAssertion } from "../auth/oidc-rp.ts";
import type { ModelSelection } from "../../shared/model-selection.ts";
import { MCP_CREDENTIALS_REFUSED } from "../../shared/connector-refusal.ts";
import { serverApprovalWords } from "../approvals/approval-words.ts";
import { routeRefusal } from "../agent-api.ts";
import { VersionReads } from "../write-versions.ts";
import { createOrgMemberRoutes, describeMemberApproval, queuedSendWillStart, planAnswer, MEMBER_PROGRESS_MIN_MS, QUESTION_DECLINED_MESSAGE, readThreadPage, replyAfter, summarizeTurn, type MemberPerson, type MemberRequest, type OrgMemberRouteDeps, type ThreadStatus } from "./org-member-routes.ts";

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

// #4879: one client read a bot as idle while another client's turn ran in
// its own conversation with the bot (hidden from the app's dots, #291).
describe("bots: one run state over every path (#4879)", () => {
  const threadStatus = deps.threadStatus;
  afterEach(() => {
    deps.threadStatus = threadStatus;
    deps.agentConversationsOf = undefined;
    deps.agentConversationClient = undefined;
  });

  it("counts the person's AI client conversations and names the paths live now", async () => {
    respond = (request) => request.path === "/api/bots"
      ? { status: 200, body: { bots: [
        { id: "b1", name: "Orion", busy: false, activity: "idle", threadId: "t1" },
        { id: "b2", name: "Beacon", busy: false, activity: "waiting-on-you", threadId: "t2" },
        { id: "b3", name: "Atlas", busy: false, activity: "idle", threadId: "t3" },
      ] } }
      : { status: 200, body: { entries: [] } };
    const conversations: Record<string, string[]> = { b1: ["c-cursor", "c-grok"], b2: ["c-cursor-2"], b3: ["c-grok-3"] };
    const states: Record<string, ThreadStatus> = { "c-cursor": "working", "c-grok": "idle", "c-cursor-2": "working", "c-grok-3": "waiting" };
    const clients: Record<string, string> = { "c-cursor": "Cursor", "c-grok": "Grok", "c-cursor-2": "Cursor", "c-grok-3": "Grok" };
    deps.agentConversationsOf = (botId, principalId) => (principalId === "pr_bob" ? conversations[botId] ?? [] : []);
    deps.threadStatus = (threadId) => states[threadId] ?? "idle";
    deps.agentConversationClient = (threadId) => clients[threadId] ?? null;
    const got = await call("GET", "bots", token("bob"));
    expect(got.status).toBe(200);
    expect(got.body.bots).toEqual([
      expect.objectContaining({ id: "b3", status: "waiting", liveVia: ["Grok"] }),
      expect.objectContaining({ id: "b2", status: "waiting", liveVia: ["Sagax chat", "Cursor"] }),
      expect.objectContaining({ id: "b1", status: "working", liveVia: ["Cursor"] }),
    ]);
  });

  it("an idle bot has no live path", async () => {
    respond = (request) => request.path === "/api/bots"
      ? { status: 200, body: { bots: [{ id: "b1", name: "Orion", busy: false, activity: "idle", threadId: "t1" }] } }
      : { status: 200, body: { entries: [] } };
    deps.agentConversationsOf = () => ["c-cursor"];
    deps.threadStatus = () => "idle";
    const got = await call("GET", "bots", token("bob"));
    expect(got.body.bots).toEqual([expect.objectContaining({ id: "b1", status: "idle", liveVia: [] })]);
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
    expect(performed[0]!.request).toEqual({ method: "POST", path: "/api/bots/b1/messages", body: { text: "hi", threadId: "t1", busyMode: "after", aiClient: true } });
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
    expect(got.body.approval).toMatchObject({ id: "req_1", threadId: "t1", kind: "permission", answerWith: "decision", choices: [{ id: "1", label: "allow" }, { id: "2", label: "deny" }] });
  });

  it("opens a new thread when asked, and passes a Sagax refusal through", async () => {
    respond = (request) => request.path.endsWith("/tasks")
      ? { status: 201, body: { task: { threadId: "t9" } } }
      : { status: 403, body: { error: "This bot is not yours to use." } };
    const got = await call("POST", "bots/b1/messages", token("bob"), { text: "hello", newThread: true });
    expect(performed.map((p) => p.request.path)).toEqual(["/api/bots/b1/tasks", "/api/bots/b1/messages"]);
    // #1170: a new thread is never hidden; the person can see and close it
    expect(performed[0]!.request.body).toEqual({ confidential: false });
    expect(performed[1]!.request.body).toEqual({ text: "hello", threadId: "t9", busyMode: "after", aiClient: true });
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
        ["/api/bots/b1/messages", { text: "count the tickets", threadId: "t9", busyMode: "after", aiClient: true }],
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
      expect(performed.filter((p) => p.request.method === "POST").map((p) => [p.request.path, p.request.body])).toEqual([["/api/bots/b1/messages", { text: "again", threadId: "t7", busyMode: "after", aiClient: true }]]);
    });

    it("honors a thread the client names, as given", async () => {
      respond = sentTo("t5");
      await call("POST", "bots/b1/messages", token("bob"), { text: "here", threadId: "t5" });
      expect(performed.filter((p) => p.request.method === "POST").map((p) => [p.request.path, p.request.body])).toEqual([["/api/bots/b1/messages", { text: "here", threadId: "t5", busyMode: "after", aiClient: true }]]);
      expect(recorded[0]!.after).toEqual({ threadId: "t5", waited: false });
    });

    it("#3220: a queued prompt is anchored by its queue slot, never answered with the previous reply", async () => {
      let sentOnce = false;
      let looks = 0;
      status = () => (sentOnce && looks++ < 2 ? "working" : "idle");
      respond = (request) => {
        if (request.method === "POST") {
          sentOnce = true;
          return { status: 202, body: { ok: true, threadId: "t1", queueId: "q1" } };
        }
        return { status: 200, body: { messages: [
          { id: "m1", role: "user", kind: "text", text: "first", at: 1 },
          { id: "m2", role: "bot", kind: "text", text: "answer to first", at: 2 },
          { id: "m3", role: "user", kind: "text", text: "second", at: 3, queueId: "q1" },
          { id: "m4", role: "bot", kind: "text", text: "answer to second", at: 4 },
        ] } };
      };
      const got = await call("POST", "bots/b1/messages", token("bob"), { text: "second", threadId: "t1", wait: 30 });
      expect(performed.find((p) => p.request.method === "POST")!.request.body).toMatchObject({ busyMode: "after", aiClient: true });
      expect(got.body.reply).toBe("answer to second");
    });

    it("the Perspicax console is the person typing: their own conversation, nothing hidden", async () => {
      respond = sentTo("t1");
      await call("POST", "bots/b1/messages", token("bob", "employee", "console"), { text: "from the console" });
      expect(performed.filter((p) => p.request.method === "POST").map((p) => [p.request.path, p.request.body])).toEqual([["/api/bots/b1/messages", { text: "from the console" }]]);
      expect(recorded[0]!.after).toEqual({ threadId: "t1", waited: false });
    });
  });

  it("checks its body", async () => {
    for (const body of [{}, { text: "" }, { text: "x", wait: 121 }, { text: "x", wait: -1 }, { text: "x", extra: 1 }, { text: "x", threadId: "a/b" }, { text: "x", threadId: "t1", newThread: true }, { text: "x", sendId: "short" }, { text: "x", sendId: "send-0001-15chr" }]) {
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

  it("shows a routine run's result card in the chat it landed in (#3152)", () => {
    const page = { messages: [
      { id: "m1", role: "user", kind: "text", text: "hi", at: 1 },
      { id: "r1", role: "bot", kind: "routine.run", text: "Completed with problems.\n\nQuatre GO attendent la personne.", at: 2, routineRun: { runId: "run1", status: "completed" } },
    ] };
    expect(readThreadPage("t1", page, "m1").messages).toEqual([
      { id: "r1", role: "bot", kind: "routine.run", text: "Completed with problems.\n\nQuatre GO attendent la personne.", at: 2, sender: null },
    ]);
    expect(replyAfter(readThreadPage("t1", page, "m1").messages, null)).toBeNull();
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

  it("passes a route refusal on with the same code, sentence and field the agent API gives it", async () => {
    people.get("bob")!.permissions.push("clients.routinesRun");
    const body = { error: "org_bots_read_only", message: "Your administrator lets you use shared bots only.", field: "cwd" };
    respond = () => ({ status: 403, body });
    const got = await call("POST", "routines/r1/run", token("bob"), {});
    const agent = routeRefusal({ status: 403, body }, "fallback");
    expect(got.status).toBe(agent.status);
    expect(got.body).toMatchObject({ code: "org_bots_read_only", message: agent.message, field: "cwd" });
    expect(got.body.code).toBe(agent.code);
  });

  // the owner 2026-11-01: "when I invoke routines they start but it is unclear what
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

  it("a run keeps one threadId from queued to running (QA 0.8.67 G7)", async () => {
    people.get("bob")!.permissions.push("clients.routinesRun");
    respond = () => ({ status: 201, body: { run: { id: "run_q", routineId: "r1", status: "queued", botId: "b1", resultsThreadId: "t_report" } } });
    const queued = (await call("POST", "routines/r1/run", token("bob"), {})).body.run;
    expect(queued.threadId).toBe("t_report");
    expect(queued.executionThreadId).toBeUndefined();
    respond = () => ({ status: 200, body: { runs: [{ id: "run_q", routineId: "r1", status: "running", resultsThreadId: "t_report", threadId: "t_task", startedAt: 1 }] } });
    const running = (await call("GET", "routines/runs/run_q", token("bob"))).body.run;
    expect(running).toMatchObject({ threadId: "t_report", executionThreadId: "t_task" });
  });

  it("a run that completed with problems never reads as a plain success", async () => {
    people.get("bob")!.permissions.push("clients.routinesRun");
    respond = () => ({ status: 200, body: { runs: [{ id: "run_9", routineId: "r1", status: "completed", problems: "crm_login failed 2 times", startedAt: 1, finishedAt: 2 }] } });
    const got = await call("GET", "routines/runs/run_9", token("bob"));
    expect(got.body.run).toMatchObject({ id: "run_9", status: "completed", problems: "crm_login failed 2 times",
      outcome: "completed_with_problems", hasProblems: true });
  });

  // #2605: a run off its cron days must say what started it.
  it("a run says what started it, when it was due and why it was retried", async () => {
    people.get("bob")!.permissions.push("clients.routinesRun");
    respond = () => ({ status: 200, body: { runs: [
      { id: "run_s", routineId: "r1", status: "completed", triggerSource: "startup", startedAt: 1, finishedAt: 2 },
      { id: "run_r", routineId: "r1", status: "running", scheduledFor: 900, retried: "restarted", startedAt: 3 },
      { id: "run_m", routineId: "r1", status: "failed", manual: true, startedAt: 4, finishedAt: 5 },
    ] } });
    expect((await call("GET", "routines/runs/run_s", token("bob"))).body.run).toMatchObject({ trigger: "startup", outcome: "completed", hasProblems: false });
    expect((await call("GET", "routines/runs/run_r", token("bob"))).body.run).toMatchObject({ trigger: "schedule", scheduledFor: 900, retried: "restarted", outcome: "running" });
    expect((await call("GET", "routines/runs/run_m", token("bob"))).body.run).toMatchObject({ trigger: "manual", outcome: "failed" });
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
    expect(bash).toMatchObject({ kind: "permission", answerWith: "decision", choices: [{ id: "1", label: "allow" }, { id: "2", label: "deny" }], options: ["Allow", "Deny"], createdAt: 5, freeText: false });
    expect(delivery).toMatchObject({ kind: "question", answerWith: "option", freeText: true, expiresAt: 99,
      choices: [{ id: "1", label: "Livrer ici" }, { id: "2", label: "Livrer ici et par le relais" }, { id: "3", label: "Non" }] });
    expect(several).toMatchObject({ kind: "question", choices: [], freeText: false, questions: [
      { question: "Which file?", options: [{ id: "1", label: "README" }, { id: "2", label: "Guide" }] },
      { question: "Which branch?", options: [{ id: "1", label: "main" }, { id: "2", label: "dev" }] },
    ] });
    expect(routine).toMatchObject({ kind: "request", answerWith: "decision", choices: [{ id: "1", label: "Save" }, { id: "2", label: "Not now" }] });
    // #1940: when the card has no expiresAt, fill from createdAt + policy days.
    const withPolicy = readThreadPage("t1", { messages: [
      { id: "c1", role: "bot", kind: "options", at: 1_000, card: bashCard() },
    ] }, null, 7);
    expect(withPolicy.approvals[0]?.expiresAt).toBe(1_000 + 7 * 86_400_000);
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

  it("lists an open routine proposal card (manage_routine) on an idle thread (#1996)", async () => {
    status = () => "idle";
    hiddenThread = () => null;
    const proposal = { requestId: "req_rt", title: "Create the routine Osprey digest?", tool: "manage_routine", options: ["Approve", "Decline"], routineRequest: { operation: "create" } };
    cards.set("t1/req_rt", { open: true, ownerPrincipalId: "pr_bob", ownerName: "Bob", adminOnly: false });
    deps.openProposal = (threadId) => threadId === "t1";
    respond = (request) => {
      if (request.path === "/api/bots") return { status: 200, body: { bots: [
        { id: "b1", name: "Wren", threadId: "t1", tasks: [] },
        { id: "b2", name: "Atlas", threadId: "t3", tasks: [] },
      ] } };
      const thread = /\/api\/threads\/([\w-]+)\/messages/.exec(request.path)?.[1] ?? "";
      return { status: 200, body: { messages: thread === "t1" ? [{ id: "m1", role: "bot", kind: "options", at: 70, card: proposal }] : [] } };
    };
    try {
      const got = await call("GET", "approvals", token("bob"));
      expect(got.status, JSON.stringify(got.body)).toBe(200);
      expect(got.body.approvals.map((a: { id: string }) => a.id)).toEqual(["req_rt"]);
      expect(got.body.approvals[0]).toMatchObject({ threadId: "t1", botId: "b1", tool: "manage_routine", canAnswer: true });
      // the idle thread without a proposal is never read
      expect(performed.some((p) => p.request.path.includes("/t3/"))).toBe(false);
    } finally {
      deps.openProposal = undefined;
    }
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

  it("await_turn carries a card held down the handoff, with the thread to answer on (#2922)", async () => {
    serveCards([]);
    const child = { id: "req_c", threadId: "t9", kind: "permission", title: "Run Bash?", answerWith: "decision", choices: [{ id: "1", label: "allow" }, { id: "2", label: "deny" }], createdAt: 5 };
    cards.set("t9/req_c", { open: true, ownerPrincipalId: "pr_bob", ownerName: "Bob", adminOnly: false });
    agentReply = () => ({ status: 200, body: { handle: "turn_x", agent_id: "b1", thread_id: "t1", finished: false, status: "waiting_for_approval", reply: "", approvals: [child] } });
    const got = await call("POST", "agents/await_turn", token("bob"), { agent_id: "b1", handle: "turn_x" });
    expect(got.status).toBe(200);
    expect(got.body.approval).toMatchObject({ id: "req_c", threadId: "t9" });
    expect(got.body.next).toContain("thread_id t9");
    expect(got.body.next).toContain("approval_id req_c");
    // a card this person may not answer stays out
    cards.set("t9/req_c", { open: true, ownerPrincipalId: "pr_ann", ownerName: "Ann", adminOnly: false });
    expect((await call("POST", "agents/await_turn", token("bob"), { agent_id: "b1", handle: "turn_x" })).body.approval).toBeNull();
    // never a confidential child thread's card
    cards.set("t9/req_c", { open: true, ownerPrincipalId: "pr_bob", ownerName: "Bob", adminOnly: false });
    confidentialThreads.add("t9");
    expect((await call("POST", "agents/await_turn", token("bob"), { agent_id: "b1", handle: "turn_x" })).body.approval).toBeNull();
  });

  it("the card down the handoff is answered on its own thread, as the next text says (#2922)", async () => {
    serveCards([bashCard({ requestId: "req_c" })], { thread: "t9" });
    const child = { id: "req_c", threadId: "t9", kind: "permission", title: "Run Bash?", answerWith: "decision", choices: [], createdAt: 5 };
    agentReply = () => ({ status: 200, body: { handle: "turn_x", agent_id: "b1", thread_id: "t1", finished: false, status: "waiting_for_approval", reply: "", approvals: [child] } });
    const got = await call("POST", "agents/await_turn", token("bob"), { agent_id: "b1", handle: "turn_x" });
    expect(got.body.next).toContain("thread_id t9");
    const answered = await call("POST", "approvals/req_c", token("bob"), { threadId: "t9", decision: "allow" });
    expect(answered.status).toBe(200);
    expect(answered.body).toMatchObject({ answered: true, closed: true, decision: "allow" });
    expect(performed.find((p) => p.request.path.endsWith("/respond"))?.request.path).toBe("/api/threads/t9/respond");
  });

  it("a card an earlier turn left open in the conversation is not the one this turn waits on (#2922)", async () => {
    // the thread still shows an old routine proposal; the agent API scoped
    // this turn's cards to the new permission only
    serveCards([
      { title: "Save this routine?", subtitle: "", options: ["Save", "Not now"], requestId: "req_old", routineRequest: { version: 1 } },
      bashCard({ requestId: "req_new" }),
    ]);
    const now = { id: "req_new", threadId: "t1", kind: "permission", answerWith: "decision", choices: [], createdAt: 101 };
    agentReply = () => ({ status: 200, body: { handle: "turn_x", agent_id: "b1", thread_id: "t1", finished: false, status: "waiting_for_approval", reply: "", approvals: [now] } });
    const got = await call("POST", "agents/await_turn", token("bob"), { agent_id: "b1", handle: "turn_x" });
    expect(got.body.approval).toMatchObject({ id: "req_new", threadId: "t1" });
    expect(got.body.approvals.map((a: { id: string }) => a.id)).toEqual(["req_new"]);
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
      lastRun: { id: "run_new", status: "failed", startedAt: 30, endedAt: 40, trigger: "schedule", outcome: "failed", hasProblems: false },
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
    expect(detail.body.routine.lastRun).toEqual({ id: "run_new", status: "failed", startedAt: 30, endedAt: 40, trigger: "schedule", outcome: "failed", hasProblems: false });
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

  it("an instruction edit that keeps the masks it read saves the stored secrets, and the text unchanged saves nothing (#4971)", async () => {
    people.get("bob")!.permissions.push("clients.routinesRead", "clients.routinesWrite");
    const sent: Record<string, unknown>[] = [];
    respond = (request) => {
      if (request.method === "GET" && request.path === "/api/routines") return { status: 200, body: routineFixture() };
      if (request.method === "PATCH" && request.path === "/api/routines/r_bob") {
        sent.push((request.body ?? {}) as Record<string, unknown>);
        return { status: 200, body: { routine: { id: "r_bob", name: "Morning", botId: "b1", enabled: true, prompt: "x", schedule: { type: "daily" }, owner: { id: "pr_bob" } } } };
      }
      return { status: 404, body: { error: "no" } };
    };
    const read = (await call("GET", "routines/r_bob", token("bob"))).body.routine.instructions as string;
    expect(read).toMatch(/«redacted #1, \d+ chars»/);
    const edited = await call("PATCH", "routines/r_bob", token("bob"), { instructions: `Start here. ${read}` });
    expect(edited.status).toBe(200);
    const prompt = sent[0]!.prompt as string;
    expect(prompt).toContain(PLANTED_KEY);
    expect(prompt).toContain(PLANTED_WEBHOOK);
    expect(prompt).not.toContain("«redacted");
    const same = await call("PATCH", "routines/r_bob", token("bob"), { instructions: read });
    expect(same.status).toBe(200);
    expect(sent).toHaveLength(1);
  });

  it("answers each routine's version and refuses a write from a stale or unread copy with the current one (#4939)", async () => {
    people.get("bob")!.permissions.push("clients.routinesRead", "clients.routinesWrite");
    let updatedAt = 5;
    respond = (request) => {
      if (request.method === "GET" && request.path === "/api/routines") {
        return { status: 200, body: { routines: [{ id: "r_bob", name: "Morning", botId: "b1", enabled: true, prompt: "a", updatedAt, owner: { id: "pr_bob" } }], runs: [] } };
      }
      if (request.method === "PATCH" && request.path === "/api/routines/r_bob") {
        updatedAt += 1;
        return { status: 200, body: { routine: { id: "r_bob", name: "Morning", botId: "b1", enabled: false, prompt: "a", updatedAt, owner: { id: "pr_bob" } } } };
      }
      return { status: 404, body: { error: "no" } };
    };
    deps.versionReads = new VersionReads();
    try {
      const blind = await call("PATCH", "routines/r_bob", token("bob"), { enabled: false });
      expect(blind.status).toBe(409);
      expect(blind.body).toMatchObject({ code: "version_conflict", current_version: "5", conflict: "not_read" });
      const listed = await call("GET", "routines", token("bob"));
      expect(listed.body.routines[0].version).toBe("5");
      const stale = await call("PATCH", "routines/r_bob", token("bob"), { enabled: false, expected_version: "4" });
      expect(stale.status).toBe(409);
      expect(stale.body).toMatchObject({ current_version: "5", conflict: "stale" });
      expect(performed.filter((entry) => entry.request.method === "PATCH")).toEqual([]);
      const written = await call("PATCH", "routines/r_bob", token("bob"), { enabled: false });
      expect(written.status).toBe(200);
      expect(written.body.routine.version).toBe("6");
      // Two writes from the same copy at once: one lands, the other is refused.
      const read = await call("GET", "routines/r_bob", token("bob"));
      const both = await Promise.all([
        call("PATCH", "routines/r_bob", token("bob"), { enabled: true, expected_version: read.body.routine.version }),
        call("PATCH", "routines/r_bob", token("bob"), { enabled: false, expected_version: read.body.routine.version }),
      ]);
      expect(both.map((answer) => answer.status).sort()).toEqual([200, 409]);
      // The person in the console writes as before.
      const fromConsole = await call("PATCH", "routines/r_bob", token("bob", "employee", "console"), { enabled: true });
      expect(fromConsole.status).toBe(200);
    } finally {
      delete deps.versionReads;
    }
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

describe("a skill card answered through the member API (G4)", () => {
  const sha = "a".repeat(64);
  const approval = { kind: "request", choices: [{ id: "1", label: "Enable" }, { id: "2", label: "Not now" }], options: [] } as never;
  const card = { skillRequest: { preview: "---\nname: x\n---", sha256: sha } };
  it("echoes the reviewed hash on allow, never on deny", () => {
    const allow = planAnswer(approval, card, { decision: "allow" });
    expect(allow).toMatchObject({ ok: true, body: { behavior: "allow", reviewedSha256: sha } });
    const deny = planAnswer(approval, card, { decision: "deny" });
    expect(deny).toMatchObject({ ok: true, body: { behavior: "deny" } });
    expect((deny as { body: object }).body).not.toHaveProperty("reviewedSha256");
  });
});

describe("a permission answered by option id (#2922)", () => {
  it("lists allow and deny as choices and maps option 1 and 2 to them", () => {
    const card = { requestId: "req_p", requestType: "permission", tool: "Bash", title: "Run Bash?", options: ["Allow", "Deny"] };
    const approval = describeMemberApproval("t1", { at: 1 }, card);
    expect(approval.choices.map((c) => c.label)).toEqual(["allow", "deny"]);
    expect(planAnswer(approval, card, { option: "1" })).toMatchObject({ ok: true, decision: "allow", body: { behavior: "allow" } });
    expect(planAnswer(approval, card, { option: "2" })).toMatchObject({ ok: true, decision: "deny", body: { behavior: "deny" } });
    expect(planAnswer(approval, card, { option: "Allow" })).toMatchObject({ ok: true, decision: "allow" });
  });
});

describe("question title and decline in the person's language (#2633)", () => {
  const card = { requestId: "q-1", requestType: "question", title: "Your bot has a question", subtitle: "Quel créneau?", options: ["Lundi", "Mardi"] };
  const fr = (key: string) => ({ "question.card.title": "Votre bot a une question" } as Record<string, string>)[key] ?? key;

  it("words Sagax's generic question title in the reader's language, never a bot's own title", () => {
    expect(describeMemberApproval("t1", { at: 1 }, card, undefined, fr).title).toBe("Votre bot a une question");
    expect(describeMemberApproval("t1", { at: 1 }, { ...card, title: "Choix du créneau" }, undefined, fr).title).toBe("Choix du créneau");
    expect(describeMemberApproval("t1", { at: 1 }, card).title).toBe("Your bot has a question");
    expect(readThreadPage("t1", { messages: [{ id: "m1", role: "bot", kind: "options", card }] }, null, undefined, fr).approvals[0]?.title).toBe("Votre bot a une question");
  });

  it("a declined question says so to the respond route, which words it and keeps it off the person's messages", () => {
    const approval = describeMemberApproval("t1", { at: 1 }, { ...card, options: ["A", "B"] });
    const plan = planAnswer(approval, { ...card, options: ["A", "B"] }, { decision: "deny" });
    expect(plan).toMatchObject({ ok: true, decision: "deny", body: { behavior: "answer", message: QUESTION_DECLINED_MESSAGE, declined: true } });
  });
});


describe("list_pending_approvals gives each card its context (#2909)", () => {
  it("returns the question, the detail as readable text and what each answer does", () => {
    const card = {
      requestId: "q-1",
      requestType: "question",
      title: "Your bot has a question",
      subtitle: "| Copie | Date |\n|---|---|\n| Locale | 7 nov. |\n| Serveur | 8 nov. |",
      options: ["Locale", "Serveur"],
      questionRequest: { questions: [{ question: "Je garde la copie locale ou celle du serveur ?", options: [{ label: "Locale", description: "Garde tes changements" }, { label: "Serveur" }] }] },
    };
    const approval = describeMemberApproval("t1", { at: 1 }, card);
    expect(approval.choices).toEqual([{ id: "1", label: "Locale", description: "Garde tes changements" }, { id: "2", label: "Serveur" }]);
    expect(approval.context).toContain("Je garde la copie locale ou celle du serveur ?");
    expect(approval.context).toContain("Copie: Locale · Date: 7 nov.");
    expect(approval.context).toContain("• Locale: Garde tes changements");
    expect(approval.context).not.toContain("|");
  });
});

describe("#3515: the organization's connector reads the server's lines in the person's language", () => {
  const page = { messages: [
    { id: "m1", role: "user", kind: "text", text: "salut", at: 1 },
    { id: "s1", role: "bot", kind: "activity", tool: { name: "notice: Workspace: In the cloud", ok: true } },
    { id: "s2", role: "bot", kind: "activity", tool: { name: "Asked by Beta", ok: true } },
    { id: "s3", role: "bot", kind: "activity", tool: { name: "remote_tool", ok: false, output: `MCP error -32603: ${MCP_CREDENTIALS_REFUSED}` } },
    { id: "r1", role: "bot", kind: "routine.run", text: "Trois points.\n\nCompleted with problems.\n\nRoutine “Veille”", at: 2,
      routineRun: { runId: "run1", routineId: "rt", routineName: "Veille", status: "completed", summary: "Trois points.", problems: "x" } },
    { id: "c1", role: "bot", kind: "options", card: { title: "Your bot has a question", subtitle: "On continue ?", options: ["Yes", "No"], requestId: "q1", requestType: "question" } },
  ] };

  it("in French: the steps, a routine's line and an old question card", () => {
    const read = readThreadPage("t1", page, "m1", undefined, serverApprovalWords("fr").t, "fr-CA");
    const all = JSON.stringify(read);
    for (const english of ["In the cloud", "Asked by", "Completed with problems", "Routine “", "refused its credentials", "Your bot has a question", "\"Yes\""]) expect(all).not.toContain(english);
    expect(read.steps.recent.map((step) => step.tool)).toEqual(["Dans l'infonuagique", "Beta a demandé", "remote_tool"]);
    expect(read.steps.recent[2]!.error).toContain("ouvre Capacités > Installés et reconnecte-toi");
    expect(read.messages[0]!.text).toBe("Trois points.\n\nTerminée avec des problèmes.\n\nRoutine « Veille »");
    expect(read.approvals[0]).toMatchObject({ title: "Ton bot a une question", options: ["Oui", "Non"] });
  });

  it("in English: as stored, the refusal shortened at a sentence with its step", () => {
    const read = readThreadPage("t1", page, "m1", undefined, serverApprovalWords("en").t, "en");
    expect(read.steps.recent[0]!.tool).toBe("notice: Workspace: In the cloud");
    expect(read.steps.recent[2]!.error).toContain("open Capabilities > Installed and sign in to it again");
    expect(read.messages[0]!.text).toContain("Completed with problems.");
    expect(read.approvals[0]).toMatchObject({ options: ["Yes", "No"] });
  });

  it("an old card answers with its stored label, whether the person sends the shown one or the stored one", () => {
    const card = page.messages.at(-1)!.card as Record<string, unknown>;
    const approval = describeMemberApproval("t1", page.messages.at(-1)!, card, undefined, serverApprovalWords("fr").t);
    for (const option of ["Oui", "Yes", "oui", "1"]) {
      const plan = planAnswer(approval, card, { option });
      expect(plan, option).toMatchObject({ ok: true, picked: "Yes", body: { behavior: "answer", message: "Yes" } });
    }
    expect(planAnswer(approval, card, { option: "Non" })).toMatchObject({ ok: true, picked: "No" });
    expect(planAnswer(approval, card, { option: "No" })).toMatchObject({ ok: true, picked: "No" });
    expect(planAnswer(approval, card, { decision: "allow" })).toMatchObject({ ok: true, picked: "Yes" });
    expect(planAnswer(approval, card, { decision: "deny" })).toMatchObject({ ok: true, picked: "No" });
  });

  it("a run that ended failed says so with its reason; the row's text holds no marker", () => {
    const failed = { messages: [
      { id: "m1", role: "user", kind: "text", text: "salut", at: 1 },
      { id: "b1", role: "bot", kind: "text", text: "Je n'ai pas pu entrer.", at: 2, runStatus: { state: "failed", reason: "the login was refused" } },
    ] };
    const fr = readThreadPage("t1", failed, "m1", undefined, serverApprovalWords("fr").t, "fr-CA");
    expect(fr.messages[0]!.text).toBe("Je n'ai pas pu entrer.\n\nNon terminée : the login was refused");
    const en = readThreadPage("t1", failed, "m1", undefined, serverApprovalWords("en").t, "en");
    expect(en.messages[0]!.text).toBe("Je n'ai pas pu entrer.\n\nDid not finish: the login was refused");
  });

  it("a routine run's line says its times in the person's zone, and its failure once", () => {
    const since = Date.UTC(2026, 10, 10, 14, 0);
    const page = { messages: [
      { id: "m1", role: "user", kind: "text", text: "salut", at: 1 },
      { id: "r1", role: "bot", kind: "routine.run", text: "Trois points.\n\nCompleted with problems.\n\nRoutine “Veille”", at: 2,
        routineRun: { runId: "run-1", routineId: "rt-1", routineName: "Veille", status: "completed", summary: "Trois points.", problems: "a tool failed", repeat: { firstRunId: "run-0", count: 3, since, lastAt: since } } },
    ] };
    const utc = readThreadPage("t1", page, "m1", undefined, serverApprovalWords("fr").t, "fr-CA", "UTC").messages[0]!.text;
    const local = readThreadPage("t1", page, "m1", undefined, serverApprovalWords("fr").t, "fr-CA", "America/Toronto").messages[0]!.text;
    expect(utc).toContain("14");
    expect(local).toContain("9");
    expect(local).not.toBe(utc);
    // the language unknown: the stored line says how the run ended, once
    const failedRun = { messages: [
      { id: "m1", role: "user", kind: "text", text: "salut", at: 1 },
      { id: "r2", role: "bot", kind: "routine.run", text: "Routine “Veille”: failed\n\nthe login was refused", at: 2,
        runStatus: { state: "failed", reason: "the login was refused" },
        routineRun: { runId: "run-2", routineId: "rt-1", routineName: "Veille", status: "failed", error: "the login was refused" } },
    ] };
    const text = readThreadPage("t1", failedRun, "m1").messages[0]!.text;
    expect(text.split("the login was refused").length - 1).toBe(1);
  });
});


// #4490 review: a form holds up to 12 rows; an AI client answering through
// the MCP reads every one of them, each with its control
describe("a form card read by an AI client (#4490)", () => {
  it("lists all twelve rows with their kind", () => {
    const questions = Array.from({ length: 12 }, (_, index) => ({ question: `Row ${index + 1}`, kind: index % 2 ? "duration" : "yes_no", options: index % 2 ? [] : [{ label: "Yes", id: "yes" }, { label: "No", id: "no" }], ...(index === 11 ? { optional: true } : {}) }));
    const card = { requestId: "q-form", requestType: "question", title: "Time entries", subtitle: "Confirm each.", options: [], questionRequest: { version: 1, questions } };
    const approval = describeMemberApproval("t1", { at: 1 }, card);
    expect(approval.questions).toHaveLength(12);
    expect(approval.questions![1]).toMatchObject({ question: "Row 2", kind: "duration" });
    expect(approval.questions![11]).toMatchObject({ optional: true });
  });
});

describe("lot S1: the surface bot, hidden turns, a model per send, deleting a hidden conversation", () => {
  // Bob's surface bot is "sb"; Ann's ordinary bot is "b1".
  let surfaces: Map<string, string>;
  let made: number;
  let models: Map<string, ModelSelection>;
  let hiddenOwned: Map<string, { owner: string; botId: string }>;
  let opened: Array<{ botId: string; principalId: string; fresh: boolean }>;
  let forgotten: string[];
  beforeEach(() => {
    forgotten = [];
    surfaces = new Map([["sb", "pr_bob"]]);
    made = 0;
    models = new Map();
    hiddenOwned = new Map([["th_bob", { owner: "pr_bob", botId: "sb" }]]);
    opened = [];
    deps.ensureSurfaceBot = async (person, input) => {
      const existing = [...surfaces].find(([, owner]) => owner === person.principalId);
      if (existing) return { ok: true, id: existing[0], name: "Kept", created: false, approvalMode: "full" };
      if (input.name === "Refused") return { ok: false, reply: { status: 403, body: { error: "forbidden: only a member of the organization can create bots", code: "create_bots_members_only" } } };
      made += 1;
      surfaces.set(`sb_${person.principalId}`, person.principalId);
      return { ok: true, id: `sb_${person.principalId}`, name: input.name, created: true, approvalMode: "full" };
    };
    deps.surfaceBot = (botId) => surfaces.has(botId);
    // the server's rule: an outside agent's conversation is its person's; a
    // surface bot's is answered, and another person is refused by the app's routes
    deps.hiddenConversationOf = (threadId, principalId) => {
      const found = hiddenOwned.get(threadId);
      return found && (found.owner === principalId || surfaces.has(found.botId)) ? { botId: found.botId } : null;
    };
    deps.forgetThread = (threadId) => { forgotten.push(threadId); };
    deps.threadModel = (_botId, threadId) => models.get(threadId) ?? null;
    deps.agentConversation = (botId, person, fresh) => {
      opened.push({ botId, principalId: person.principalId, fresh });
      return `ac_${opened.length}`;
    };
  });
  afterEach(() => {
    deps.ensureSurfaceBot = undefined;
    deps.surfaceBot = undefined;
    deps.hiddenConversationOf = undefined;
    deps.threadModel = undefined;
    deps.agentConversation = undefined;
    deps.threadQueued = undefined;
    deps.forgetThread = undefined;
    deps.newThreadReceipt = undefined;
  });
  /** A Sagax that takes sends and model switches, and answers each send done. */
  const serveSends = () => {
    respond = (request) => {
      if (request.method === "PATCH") {
        const thread = request.path.split("/").pop()!;
        models.set(thread, (request.body as { modelSelection: ModelSelection }).modelSelection);
        return { status: 200, body: { task: {} } };
      }
      if (request.method === "POST" && request.path.endsWith("/messages")) {
        const body = request.body as { threadId: string };
        return { status: 200, body: { threadId: body.threadId, message: { id: `m_${body.threadId}` } } };
      }
      return { status: 200, body: { messages: [] } };
    };
  };

  it("makes the person's surface bot once, without clients.agentsCreate, and the same one after", async () => {
    people.get("bob")!.permissions = ["clients.botsMessage"];
    const first = await call("POST", "surface-bot", token("ann", "admin"), { name: "Helper" });
    expect(first.status).toBe(201);
    expect(first.body).toEqual({ bot: { id: "sb_pr_ann", name: "Helper", approvalMode: "full" }, created: true });
    expect(recorded.map((row) => row.action)).toEqual(["client.surface_bot"]);
    const again = await call("POST", "surface-bot", token("ann", "admin"), {});
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ bot: { id: "sb_pr_ann" }, created: false });
    expect(made).toBe(1);
    // a member's own, with their default keys only
    expect((await call("POST", "surface-bot", token("bob"), {})).body).toMatchObject({ bot: { id: "sb" }, created: false });
    expect((await call("POST", "surface-bot", token("ann", "admin"), { name: "two\nlines" })).body.code).toBe("bad_request");
    expect((await call("POST", "surface-bot", token("ann", "admin"), { name: "x", kind: "lasting" })).body.message).toBe("Unknown field: kind.");
    surfaces.clear();
    const refused = await call("POST", "surface-bot", token("ann", "admin"), { name: "Refused" });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("create_bots_members_only");
    expect((await call("GET", "capabilities", token("bob"))).body.routes).toEqual(expect.arrayContaining(["POST surface-bot", "DELETE threads/{id}", "POST threads/{id}/stop"]));
  });

  it("the console's hidden send lands in a hidden conversation, a plain one keeps the person's chat", async () => {
    serveSends();
    const hidden = await call("POST", "bots/b1/messages", token("bob", "employee", "console"), { text: "hi", hidden: true, newThread: true });
    expect(hidden.status).toBe(200);
    expect(hidden.body.threadId).toBe("ac_1");
    expect(opened).toEqual([{ botId: "b1", principalId: "pr_bob", fresh: true }]);
    const sent = performed.find((p) => p.request.path === "/api/bots/b1/messages")!;
    expect(sent.request.body).toMatchObject({ threadId: "ac_1", busyMode: "after", aiClient: true });
    expect(recorded.at(-1)?.after).toMatchObject({ threadId: "ac_1", hidden: true });
    performed = [];
    await call("POST", "bots/b1/messages", token("bob", "employee", "console"), { text: "plain" });
    expect(opened).toHaveLength(1);
    expect(performed.find((p) => p.request.path === "/api/bots/b1/messages")!.request.body).toEqual({ text: "plain" });
    expect((await call("POST", "bots/b1/messages", token("bob", "employee", "console"), { text: "x", hidden: "yes" })).body.code).toBe("bad_request");
  });

  it("toolScope narrows the conversation the send opens before anything is sent, never an existing one", async () => {
    serveSends();
    const narrowed: Array<{ botId: string; threadId: string; scope: unknown; sent: number }> = [];
    const sends = () => performed.filter((p) => p.request.path === "/api/bots/b1/messages").length;
    deps.narrowThreadTools = (botId, threadId, scope) => { narrowed.push({ botId, threadId, scope, sent: sends() }); return true; };
    const scope = { allow: ["mcp:host:tickets_query"] };
    const got = await call("POST", "bots/b1/messages", token("bob", "employee", "console"), { text: "read only", hidden: true, newThread: true, toolScope: scope });
    expect(got.status).toBe(200);
    // narrowed first: no message reached the bot before it
    expect(narrowed).toEqual([{ botId: "b1", threadId: "ac_1", scope, sent: 0 }]);
    expect(sends()).toBe(1);
    expect((await call("GET", "capabilities", token("bob"))).body.routes).toContain("POST bots/{id}/messages:toolScope");
    // an existing conversation, or no newThread: refused, nothing sent
    performed = [];
    for (const body of [{ text: "x", threadId: "t1", toolScope: scope }, { text: "x", toolScope: scope }]) {
      const refused = await call("POST", "bots/b1/messages", token("bob", "employee", "console"), body);
      expect(refused.status).toBe(400);
      expect(refused.body.message).toContain("newThread true");
    }
    // a selector the scope grammar refuses
    for (const toolScope of [{ allow: ["Bash"] }, { allow: "mcp:host:*" }, { only: [] }, []]) {
      expect((await call("POST", "bots/b1/messages", token("bob", "employee", "console"), { text: "x", newThread: true, toolScope })).status).toBe(400);
    }
    expect(sends()).toBe(0);
    // narrowing failed: nothing is sent
    deps.narrowThreadTools = () => false;
    const failed = await call("POST", "bots/b1/messages", token("bob", "employee", "console"), { text: "x", hidden: true, newThread: true, toolScope: scope });
    expect(failed.status).toBe(502);
    expect(sends()).toBe(0);
    // a server that cannot narrow says so, and never lists the feature
    deps.narrowThreadTools = undefined;
    expect((await call("POST", "bots/b1/messages", token("bob", "employee", "console"), { text: "x", newThread: true, toolScope: scope })).status).toBe(501);
    expect((await call("GET", "capabilities", token("bob"))).body.routes).not.toContain("POST bots/{id}/messages:toolScope");
    expect(sends()).toBe(0);
  });

  it("a send to a surface bot is always hidden; another person's reaches the app's one refusal, an admin's view included", async () => {
    serveSends();
    const own = await call("POST", "bots/sb/messages", token("bob", "employee", "console"), { text: "hi" });
    expect(own.status).toBe(200);
    expect(own.body.threadId).toBe("ac_1");
    expect(recorded.at(-1)?.after).toMatchObject({ surface: true });
    // the app's routes answer another person's session 404 (surfaceTargetRefused): passed through
    const served = respond;
    respond = (request) => (performed.at(-1)!.person.principalId !== "pr_bob" ? { status: 404, body: { error: "no such bot" } } : served(request));
    const other = await call("POST", "bots/sb/messages", token("ann", "admin", "console"), { text: "peek", hidden: true });
    expect(other.status).toBe(404);
    expect(performed.filter((p) => p.person.principalId === "pr_ann").map((p) => p.request.path)).toEqual(["/api/bots/sb/messages"]);
  });

  it("a new hidden conversation: its id with the answer (body, and a header before the stream's first event), and a retry of the same sendId lands in it, after a restart too", async () => {
    serveSends();
    // the durable receipts (server/commands.ts): they outlive the process
    const receipts = new Map<string, string>();
    deps.newThreadReceipt = { get: (key) => receipts.get(key) ?? null, put: (key, threadId) => { receipts.set(key, threadId); } };
    const first = await call("POST", "bots/sb/messages", token("bob", "employee", "console"), { text: "hi", newThread: true, sendId: "send-000000000001" });
    expect(first.body.threadId).toBe("ac_1");
    const again = await call("POST", "bots/sb/messages", token("bob", "employee", "console"), { text: "hi", newThread: true, sendId: "send-000000000001" });
    expect(again.body.threadId).toBe("ac_1");
    expect(opened).toHaveLength(1);
    expect(performed.filter((p) => p.request.path === "/api/bots/sb/messages").map((p) => (p.request.body as { threadId: string; sendId: string }))).toEqual([
      expect.objectContaining({ threadId: "ac_1", sendId: "send-000000000001" }), expect.objectContaining({ threadId: "ac_1", sendId: "send-000000000001" }),
    ]);
    // another sendId opens another; another person's same sendId never reaches it
    expect((await call("POST", "bots/sb/messages", token("bob", "employee", "console"), { text: "hi", newThread: true, sendId: "send-000000000002" })).body.threadId).toBe("ac_2");
    expect((await call("POST", "bots/b1/messages", token("ann", "admin", "console"), { text: "hi", hidden: true, newThread: true, sendId: "send-000000000001" })).body.threadId).toBe("ac_3");
    // streamed: the header carries it before any event
    const res = await fetch(`${base}/api/org/member/bots/sb/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${token("bob", "employee", "console")}`, "content-type": "application/json" },
      body: JSON.stringify({ text: "hi", newThread: true, sendId: "send-000000000003", stream: true }),
    });
    expect(res.headers.get("x-sagax-thread-id")).toBe("ac_4");
    const lines = (await res.text()).trim().split("\n").map((line) => JSON.parse(line) as { event: string; threadId?: string });
    expect(lines[0]).toMatchObject({ event: "started", threadId: "ac_4" });

    // a restart: a new process (fresh routes), the same receipts. The retry
    // lands in the same conversation with the same sendId (the message
    // route then answers it as the same message): nothing opened or run twice
    const restarted = createOrgMemberRoutes(deps);
    const second = createServer(async (req, res) => {
      if (!(await restarted(req, res, new URL(req.url ?? "/", "http://localhost")))) { res.writeHead(418); res.end(); }
    });
    await new Promise<void>((resolve) => second.listen(0, "127.0.0.1", resolve));
    try {
      performed = [];
      const after = await fetch(`http://127.0.0.1:${(second.address() as AddressInfo).port}/api/org/member/bots/sb/messages`, {
        method: "POST",
        headers: { authorization: `Bearer ${token("bob", "employee", "console")}`, "content-type": "application/json" },
        body: JSON.stringify({ text: "hi", newThread: true, sendId: "send-000000000001" }),
      });
      expect(((await after.json()) as { threadId: string }).threadId).toBe("ac_1");
      expect(opened).toHaveLength(4);
      expect(performed.filter((p) => p.request.path === "/api/bots/sb/messages").map((p) => p.request.body)).toEqual([expect.objectContaining({ threadId: "ac_1", sendId: "send-000000000001" })]);
    } finally {
      await new Promise<void>((resolve) => second.close(() => resolve()));
    }
  });

  it("two sends at once in one conversation on two models: queued, the second switches once the first is done", async () => {
    let state: ThreadStatus = "idle";
    status = () => state;
    let doneAfter = 0;
    deps.sleep = async (ms) => {
      clock += ms;
      if (state === "working" && --doneAfter <= 0) state = "idle";
    };
    respond = (request) => {
      if (request.method === "PATCH") {
        models.set("th_q", (request.body as { modelSelection: ModelSelection }).modelSelection);
        return { status: 200, body: { task: {} } };
      }
      if (request.path.endsWith("/messages")) {
        state = "working";
        doneAfter = 3;
        return { status: 200, body: { threadId: "th_q", message: { id: `m_${performed.length}` } } };
      }
      return { status: 200, body: { messages: [] } };
    };
    try {
      const first = { instanceId: "claude", model: "small" };
      const second = { instanceId: "codex", model: "large" };
      const [a, b] = await Promise.all([
        call("POST", "bots/sb/messages", token("bob", "employee", "console"), { text: "one", threadId: "th_q", modelSelection: first }),
        call("POST", "bots/sb/messages", token("bob", "employee", "console"), { text: "two", threadId: "th_q", modelSelection: second, wait: 30 }),
      ]);
      expect([a.status, b.status], JSON.stringify(b.body)).toEqual([200, 200]);
      // the first switch and send, then the second switch only once the first turn was done
      const said = (p: { request: MemberRequest }) => {
        const body = p.request.body as { modelSelection?: ModelSelection; text?: string };
        return `${p.request.method} ${body.modelSelection?.model ?? body.text}`;
      };
      expect(performed.filter((p) => p.request.method !== "GET").map(said)).toEqual(["PATCH small", "POST one", "PATCH large", "POST two"]);
      // and the second switch waited for the first turn to be done
      expect(state).toBe("working");
      // a card waiting in the conversation: said, nothing switched
      state = "waiting";
      performed = [];
      const carded = await call("POST", "bots/sb/messages", token("bob", "employee", "console"), { text: "three", threadId: "th_q", modelSelection: first });
      expect(carded.body.code).toBe("card_waiting");
      // busy on another model: the wait is the send's own; none given, said at once
      state = "working";
      doneAfter = 1_000;
      const startedAt = clock;
      const busy = await call("POST", "bots/sb/messages", token("bob", "employee", "console"), { text: "four", threadId: "th_q", modelSelection: first });
      expect(busy.body.code).toBe("conversation_busy");
      expect(clock - startedAt).toBeLessThan(1_000);
      const bounded = await call("POST", "bots/sb/messages", token("bob", "employee", "console"), { text: "five", threadId: "th_q", modelSelection: first, wait: 2 });
      expect(bounded.body.code).toBe("conversation_busy");
      expect(clock - startedAt).toBeLessThan(3_000);
      expect(performed.some((p) => p.request.method === "PATCH" || p.request.path.endsWith("/messages"))).toBe(false);
      expect(performed.some((p) => p.request.method === "PATCH" || p.request.path.endsWith("/messages"))).toBe(false);
    } finally {
      deps.sleep = async (ms) => { clock += ms; };
    }
  });

  it("a model per send: each conversation switched to its own before the send, never twice, and two at once never mix", async () => {
    serveSends();
    const fast = { instanceId: "claude", model: "small" };
    const deep: ModelSelection = { instanceId: "codex", model: "large", effort: "high" };
    const [a, b] = await Promise.all([
      call("POST", "bots/sb/messages", token("bob", "employee", "console"), { text: "one", threadId: "th_a", modelSelection: fast }),
      call("POST", "bots/sb/messages", token("bob", "employee", "console"), { text: "two", threadId: "th_b", modelSelection: deep }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(models.get("th_a")).toEqual(fast);
    expect(models.get("th_b")).toEqual(deep);
    const patches = performed.filter((p) => p.request.method === "PATCH").map((p) => p.request);
    expect(patches).toEqual(expect.arrayContaining([
      { method: "PATCH", path: "/api/bots/sb/tasks/th_a", body: { modelSelection: fast } },
      { method: "PATCH", path: "/api/bots/sb/tasks/th_b", body: { modelSelection: deep } },
    ]));
    // each switch lands before that conversation's send
    for (const thread of ["th_a", "th_b"]) {
      const at = (kind: string) => performed.findIndex((p) => p.request.method === kind && JSON.stringify(p.request).includes(thread));
      expect(at("PATCH")).toBeLessThan(at("POST"));
    }
    performed = [];
    await call("POST", "bots/sb/messages", token("bob", "employee", "console"), { text: "again", threadId: "th_a", modelSelection: fast });
    expect(performed.some((p) => p.request.method === "PATCH")).toBe(false);
    expect(recorded.at(-1)?.after).toMatchObject({ model: "small" });
    // the route's refusal passes through, and nothing is sent
    performed = [];
    respond = (request) => (request.method === "PATCH" ? { status: 403, body: { error: "This engine is not allowed in your organization." } } : { status: 200, body: {} });
    const refused = await call("POST", "bots/sb/messages", token("bob", "employee", "console"), { text: "x", threadId: "th_c", modelSelection: { instanceId: "other", model: "m" } });
    expect(refused.status).toBe(403);
    expect(refused.body.message).toBe("This engine is not allowed in your organization.");
    expect(performed.some((p) => p.request.path.endsWith("/messages"))).toBe(false);
    for (const bad of [{ model: "m" }, { instanceId: "c", model: "m", effort: "loud" }, { instanceId: "c", model: "m", fast: {} }, "claude"]) {
      expect((await call("POST", "bots/sb/messages", token("bob", "employee", "console"), { text: "x", modelSelection: bad })).body.code).toBe("bad_request");
    }
  });

  it("deletes a hidden conversation, stopping its turn first; another person's reaches the app's one refusal", async () => {
    let state: ThreadStatus = "working";
    status = () => state;
    respond = (request) => {
      if (performed.at(-1)!.person.principalId !== "pr_bob") return { status: 404, body: { error: "no such bot" } };
      if (request.path.endsWith("/interrupt")) state = "idle";
      return { status: 200, body: {} };
    };
    const deleted = await call("DELETE", "threads/th_bob", token("bob"));
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ deleted: true, threadId: "th_bob" });
    expect(performed.map((p) => `${p.request.method} ${p.request.path}`)).toEqual(["POST /api/bots/sb/interrupt", "DELETE /api/bots/sb/tasks/th_bob"]);
    expect(recorded.at(-1)).toMatchObject({ action: "client.thread_delete", after: { botId: "sb", surface: true } });
    expect(forgotten).toEqual(["th_bob"]);
    performed = [];
    state = "idle";
    expect((await call("DELETE", "threads/th_bob", token("ann", "admin"))).status).toBe(404);
    // a visible conversation is not this route's
    expect((await call("DELETE", "threads/t1", token("bob"))).status).toBe(404);
    expect(performed.filter((p) => p.person.principalId === "pr_bob")).toEqual([]);
    // once gone, it reads as gone
    hiddenOwned.delete("th_bob");
    expect((await call("DELETE", "threads/th_bob", token("bob"))).status).toBe(404);
  });

  it("stops a turn as the person; another person's reaches the app's one refusal", async () => {
    respond = () => (performed.at(-1)!.person.principalId !== "pr_bob" ? { status: 404, body: { error: "no such bot" } } : { status: 200, body: { ok: true } });
    deps.botOfThread = (threadId) => (threadId === "th_bob" ? "sb" : threadId === "t1" ? "b1" : null);
    try {
      const stopped = await call("POST", "threads/th_bob/stop", token("bob"), {});
      expect(stopped.status).toBe(200);
      expect(stopped.body).toMatchObject({ stopped: true, threadId: "th_bob" });
      expect(performed[0]!.request).toEqual({ method: "POST", path: "/api/bots/sb/interrupt", body: { threadId: "th_bob" } });
      expect(recorded.at(-1)).toMatchObject({ action: "client.stop", after: { surface: true } });
      expect((await call("POST", "threads/th_bob/stop", token("ann", "admin"), {})).status).toBe(404);
      performed = [];
      expect((await call("POST", "threads/nowhere/stop", token("bob"), {})).status).toBe(404);
      expect(performed).toEqual([]);
    } finally {
      deps.botOfThread = (threadId) => (threadId === "t1" ? "b1" : null);
    }
  });
});

describe("lot S1: a queued send keeps its conversation busy only while it will still start", () => {
  it("counts pending and dispatching sends, never one left interrupted", () => {
    expect(queuedSendWillStart([{ threadId: "t", status: "pending" }], "t")).toBe(true);
    expect(queuedSendWillStart([{ threadId: "t", status: "dispatching" }], "t")).toBe(true);
    expect(queuedSendWillStart([{ threadId: "t", status: "interrupted" }, { threadId: "u", status: "pending" }], "t")).toBe(false);
  });
});

describe("#4632: files with a message, on send_prompt's path", () => {
  const note = (text: string, paths: string[]) => `${text}\n\n[Files sent with this message, now in your Sagax workspace folder: ${paths.join(", ")}. Read them with workspace_read using those paths (relative to your workspace; it reads text), or with your file tools at the full paths: x.]`;
  let staged: Array<{ botId: string; text: string; files: unknown }> = [];
  let removed: Array<{ botId: string; paths: readonly string[] }> = [];
  let sent: Map<string, string> = new Map();
  let kept: Array<{ botId: string; threadId: string; paths: readonly string[] }> = [];
  beforeEach(() => {
    staged = [];
    removed = [];
    kept = [];
    sent = new Map();
    deps.recordStagedFiles = (botId, threadId, paths) => { kept.push({ botId, threadId, paths }); };
    deps.stageSendFiles = async (_person, botId, text, files) => {
      if (botId === "other") return { status: 404, code: "not_found", message: "No such bot." };
      staged.push({ botId, text, files });
      const paths = files.map((file) => `inbox/bob/${file.path}`);
      return { text: note(text, paths), staged: paths };
    };
    deps.removeStagedFiles = (botId, paths) => { removed.push({ botId, paths }); };
    deps.sentText = (_botId, threadId, sendId) => sent.get(`${threadId}|${sendId}`) ?? null;
    respond = (request) => request.method === "POST"
      ? { status: 202, body: { ok: true, threadId: "t1", message: { id: "m1" } } }
      : { status: 200, body: { messages: [] } };
  });
  afterEach(() => {
    deps.stageSendFiles = undefined;
    deps.removeStagedFiles = undefined;
    deps.recordStagedFiles = undefined;
    deps.sentText = undefined;
  });
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
  const pdf = Buffer.from("%PDF-1.4\n%%EOF\n").toString("base64");

  it("stages an image and a PDF as send_prompt does and sends the line that names them", async () => {
    const got = await call("POST", "bots/b1/messages", token("bob"), { text: "read these", files: [{ path: "photo.png", content_base64: png }, { path: "report.pdf", content_base64: pdf }] });
    expect(got.status, JSON.stringify(got.body)).toBe(200);
    expect(staged).toEqual([{ botId: "b1", text: "read these", files: [{ path: "photo.png", content_base64: png }, { path: "report.pdf", content_base64: pdf }] }]);
    const post = performed.find((p) => p.request.method === "POST")!;
    expect(post.request.body).toEqual({ text: note("read these", ["inbox/bob/photo.png", "inbox/bob/report.pdf"]), threadId: "t1", busyMode: "after", aiClient: true });
    expect(recorded.at(-1)?.after).toMatchObject({ files: 2 });
    // the conversation keeps what the server staged (never read from a line's text)
    expect(kept).toEqual([{ botId: "b1", threadId: "t1", paths: ["inbox/bob/photo.png", "inbox/bob/report.pdf"] }]);
    // the audit row names no file and carries no byte
    expect(JSON.stringify(recorded)).not.toContain("photo.png");
  });

  it("takes a body over 64 KiB when it carries files", async () => {
    const big = Buffer.alloc(200 * 1024, 7).toString("base64");
    expect((await call("POST", "bots/b1/messages", token("bob"), { text: "big", files: [{ path: "scan.png", content_base64: big }] })).status).toBe(200);
    expect(staged).toHaveLength(1);
  });

  it("refuses with send_prompt's own errors, and stages nothing", async () => {
    const nine = Array.from({ length: 9 }, (_, i) => ({ path: `f${i}.txt`, content_base64: "eA==" }));
    for (const files of [nine, "x", [{ name: "a" }], [{ path: "../a", content_base64: "eA==" }], [{ path: "/etc/a", content_base64: "eA==" }]]) {
      const got = await call("POST", "bots/b1/messages", token("bob"), { text: "x", files });
      expect(got.status, JSON.stringify(files).slice(0, 80)).toBe(400);
      expect(got.body.code).toBe("bad_request");
    }
    const tooBig = await call("POST", "bots/b1/messages", token("bob"), { text: "x", files: [{ path: "huge.pdf", content_base64: "A".repeat(Math.ceil((25 * 1024 * 1024 + 8) * 4 / 3)) }] });
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.code).toBe("file_too_large");
    expect(staged).toEqual([]);
    expect(performed.filter((p) => p.request.method === "POST")).toEqual([]);
  });

  it("capabilities lists POST bots/{id}/messages:files only when the server takes files", async () => {
    expect((await call("GET", "capabilities", token("bob"))).body.routes).toContain("POST bots/{id}/messages:files");
    deps.stageSendFiles = undefined;
    expect((await call("GET", "capabilities", token("bob"))).body.routes).not.toContain("POST bots/{id}/messages:files");
  });

  it("a bot the person does not reach is 404 and nothing is written or sent", async () => {
    const got = await call("POST", "bots/other/messages", token("bob"), { text: "x", files: [{ path: "a.png", content_base64: png }] });
    expect(got.status).toBe(404);
    expect(performed.filter((p) => p.request.method === "POST")).toEqual([]);
  });

  it("a send the message route refuses removes what it staged", async () => {
    respond = () => ({ status: 403, body: { error: "not your conversation" } });
    const got = await call("POST", "bots/b1/messages", token("bob"), { text: "x", threadId: "t9", files: [{ path: "a.png", content_base64: png }] });
    expect(got.status).toBe(403);
    expect(removed).toEqual([{ botId: "b1", paths: ["inbox/bob/a.png"] }]);
    expect(kept).toEqual([]);
  });

  it("a retry with the same sendId reuses the first line and stages nothing twice", async () => {
    const files = [{ path: "photo.png", content_base64: png }];
    await call("POST", "bots/b1/messages", token("bob"), { text: "look", sendId: "send-file-000001", files });
    const first = performed.find((p) => p.request.method === "POST")!.request.body as { text: string };
    sent.set("t1|send-file-000001", first.text);
    performed = [];
    await call("POST", "bots/b1/messages", token("bob"), { text: "look", sendId: "send-file-000001", files });
    expect(staged).toHaveLength(1);
    expect((performed.find((p) => p.request.method === "POST")!.request.body as { text: string }).text).toBe(first.text);
    expect(kept).toHaveLength(1);
  });
});
