// #3512: what waits on the person is read from one source (Today's rows,
// shared/waiting-items.ts): the pinned row (GET /api/approvals?waiting=1),
// Today and the list served to the organization's connector
// (GET /api/org/member/approvals) give the same count, every kind is in the
// connector's list with its text and options, and each item is answered or
// skipped through the connector's answer route.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { InboxApproval } from "../../shared/approvals-inbox.ts";
import type { PersonAttentionCard } from "../../shared/person-attention.ts";
import { waitingEntriesFrom, waitingItemsFrom } from "../../shared/waiting-items.ts";
import type { ConsoleAssertion } from "../auth/oidc-rp.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { createOrgMemberRoutes, type MemberPerson, type MemberRequest, type OrgMemberRouteDeps } from "../org/org-member-routes.ts";
import { createApprovalsInboxRoutes } from "../routes/approvals-inbox.ts";
import { PASS } from "../routes/table.ts";
import { markAttentionHandled, skipPersonRequestCard, todayRows, type TodayDeps, type TodayMessage } from "./today-rows.ts";

const NOW = 10_000_000;
const ISS = "https://idp.example";
const ORIGIN = "https://sagax.example";

/** One bot's conversation holding one item of each kind that is not an
 * option card: a "needs you" card, a parked teammate's input request (its
 * own ask) and an offer card (« Garder le brief du jour ? »). */
function conversation(): Record<string, TodayMessage[]> {
  return {
    conv: [
      { id: "m-needs", at: 1_000, role: "bot", attention: { kind: "human", items: [{ text: "Approve the invoice for acme" }], botId: "b1", botName: "Nimbus", threadId: "work-a", sourceMessageId: "s1", choices: ["Approve", "Hold"] } as PersonAttentionCard },
      { id: "m-input", at: 2_000, role: "bot", kind: "activity", inputRequest: { botId: "b2", threadId: "work-b", botName: "Ada", title: "Build host", question: "Which build host should I use?" } },
      { id: "m-offer", at: 3_000, role: "bot", kind: "options", card: { proactiveProposal: { id: "x1" } } },
    ],
    "work-a": [],
    "work-b": [],
  };
}

const offerCard = { title: "Garder le brief du jour ?", subtitle: "Si tu dis oui, je te l'envoie chaque jour à 8 h 00.", options: ["Oui", "Pas maintenant"], proactiveProposal: { id: "x1" } };

let messages: Record<string, TodayMessage[]> = conversation();
let proposalOpen = true;

function todayDeps(): TodayDeps {
  const bots = [{ id: "b1", name: "Nimbus" }];
  return {
    bots: () => bots,
    bot: (id) => bots.find((bot) => bot.id === id),
    threads: () => [{ threadId: "conv", title: "Planning" }],
    messages: (threadId) => messages[threadId] ?? [],
    isViewers: () => true,
    proposals: () => (proposalOpen ? [{ id: "x1", botId: "b1", threadId: "conv", messageId: "m-offer", createdAt: 3_000 }] : []),
    // the message as the conversation shows it: the offer with its words
    project: (_threadId, message) => (message.id === "m-offer" ? { ...message, card: offerCard } : message),
  };
}

/** An approval card and a question card, as Today lists option cards. */
function optionCardRows(): InboxApproval[] {
  return [
    { key: "conv:req_perm", threadId: "conv", requestId: "req_perm", messageId: "m-perm", botId: "b1", botName: "Nimbus", scope: "mine", kind: "permission", at: 500, decidable: true, bulk: true, tool: "Bash",
      message: { id: "m-perm", role: "bot", kind: "options", at: 500, card: { title: "Run Bash?", subtitle: "uptime", options: ["Allow", "Deny"], requestId: "req_perm", requestType: "permission", tool: "Bash" } } },
    { key: "conv:req_q", threadId: "conv", requestId: "req_q", messageId: "m-q", botId: "b1", botName: "Nimbus", scope: "mine", kind: "question", at: 600, decidable: true, bulk: "question",
      message: { id: "m-q", role: "bot", kind: "options", at: 600, card: { title: "Your bot has a question", subtitle: "Where should I deliver?", options: ["Here", "By mail"], requestId: "req_q", requestType: "question" } } },
  ];
}

/** Today's rows: the option cards, then the "needs you" cards, input
 * requests and offers (inboxPending). */
const today = (): InboxApproval[] => [...optionCardRows(), ...todayRows(todayDeps())];

// ── the connector's side (server/org/org-member-routes.ts) ─────────────
let performed: Array<{ person: MemberPerson; request: MemberRequest }> = [];
let settled: Array<{ messageId: string; how: string }> = [];
const tokens = new Map<string, ConsoleAssertion>();
let jti = 0;
function token(): string {
  jti += 1;
  const id = `tok${jti}`;
  tokens.set(id, { iss: ISS, sub: "ada", jti: `jti-waiting-${String(jti).padStart(8, "0")}`, iat: 0, exp: Math.floor(NOW / 1000) + 60, serverId: "srv", role: "employee", teams: [], actor: "perspicax-mcp" });
  return id;
}

const memberDeps: OrgMemberRouteDeps = {
  identity: "perspicax",
  issuer: ISS,
  publicOrigin: () => ORIGIN,
  linkServerId: () => "srv",
  verify: async (bearer) => {
    const found = tokens.get(bearer);
    if (!found) throw new Error("no");
    return found;
  },
  personFor: () => ({ principalId: "pr_ada", name: "Ada", active: true, admin: false }),
  permissions: () => ({ admin: false, permissions: ["clients.botsRead", "clients.botsMessage"] }),
  perform: async (person, request) => {
    performed.push({ person, request });
    if (request.path.endsWith("/proactive/x1")) proposalOpen = false;
    return { status: 200, body: { ok: true } };
  },
  threadStatus: () => "idle",
  resolvePerson: () => null,
  record: () => {},
  liveText: () => null,
  threadLink: () => null,
  botOfThread: () => "b1",
  confidential: () => false,
  approvalAnswerer: (_threadId, requestId) => ({ found: true, open: true, ownerPrincipalId: "pr_ada", ownerName: "Ada", adminOnly: false, ...(requestId ? {} : {}) }),
  now: () => NOW,
  // the one source, as server/index.ts reads it for the person
  waitingItems: () => waitingEntriesFrom(today(), NOW).map(({ item, row }) => ({ item, ...(row.message ? { message: row.message } : {}) })),
  settleRequest: (_person, where, how) => {
    settled.push({ messageId: where.messageId, how });
    const deps = { ...todayDeps(), patch: (threadId: string, messageId: string, attention: PersonAttentionCard) => { patchMessage(threadId, messageId, { attention }); },
      patchRequest: (threadId: string, messageId: string, inputRequest: NonNullable<TodayMessage["inputRequest"]>) => { patchMessage(threadId, messageId, { inputRequest }); } };
    if (how === "handled") return markAttentionHandled(deps, where.botId, where.threadId, where.messageId, NOW);
    return skipPersonRequestCard({ ...deps, close: (threadId, message) => {
      if (message.inputRequest) patchMessage(threadId, message.id, { inputRequest: { ...message.inputRequest, expired: true, skipped: true } });
      else if (message.attention) patchMessage(threadId, message.id, { attention: { ...message.attention, handledAt: NOW, closed: "skipped" } as PersonAttentionCard });
      return true;
    } }, where.botId, where.threadId, where.messageId);
  },
};

function patchMessage(threadId: string, messageId: string, patch: Partial<TodayMessage>): void {
  messages[threadId] = (messages[threadId] ?? []).map((row) => (row.id === messageId ? { ...row, ...patch } : row));
}

// ── the app's side: GET /api/approvals?waiting=1 (the pinned row) ──────
const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const readBody = async (req: IncomingMessage) => {
  let text = "";
  for await (const chunk of req) text += chunk;
  return text ? JSON.parse(text) : null;
};

let member: Server;
let app: Server;
let memberBase = "";
let appBase = "";
beforeAll(async () => {
  const memberHandle = createOrgMemberRoutes(memberDeps);
  member = createServer(async (req, res) => {
    if (!(await memberHandle(req, res, new URL(req.url ?? "/", "http://localhost")))) json(res, 418, {});
  });
  const inbox = createApprovalsInboxRoutes({
    viewer: () => ({ principalId: "pr_ada" }),
    pending: () => today(),
    history: () => [],
    scopes: () => ({ org: true, team: false }),
    answer: async () => ({ ok: true }),
    now: () => NOW,
  });
  app = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    void inbox({ req, res, url, path: url.pathname, method: req.method ?? "GET", auth: { kind: "loopback" } as unknown as RequestAuth, json, readBody } as never)
      .then((out) => { if (out === PASS && !res.headersSent) json(res, 404, {}); });
  });
  await new Promise<void>((resolve) => member.listen(0, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
  memberBase = `http://127.0.0.1:${(member.address() as AddressInfo).port}`;
  appBase = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
});
afterAll(async () => {
  member.closeAllConnections();
  app.closeAllConnections();
  await new Promise<void>((resolve) => member.close(() => resolve()));
  await new Promise<void>((resolve) => app.close(() => resolve()));
});
beforeEach(() => {
  messages = conversation();
  proposalOpen = true;
  performed = [];
  settled = [];
});

async function connector(method: string, path: string, body?: unknown) {
  const res = await fetch(`${memberBase}/api/org/member/${path}`, {
    method,
    headers: { authorization: `Bearer ${token()}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as any };
}
async function pinned(botId = "b1") {
  const res = await fetch(`${appBase}/api/approvals?waiting=1&botId=${botId}`);
  return await res.json() as any;
}
const counts = async () => ({
  today: today().length,
  pinned: (await pinned()).waiting.length as number,
  connector: (await connector("GET", "approvals?status=pending")).body.count as number,
});

describe("one source for what waits on the person (#3512)", () => {
  it("the pinned row, Today and the connector's list give the same count, one item of each kind", async () => {
    const items = waitingItemsFrom(today(), NOW);
    expect(items.map((item) => item.kind)).toEqual(["approval", "question", "request", "request", "proposal"]);
    expect(await counts()).toEqual({ today: 5, pinned: 5, connector: 5 });
  });

  it("serves an offer card and a question in words to the connector with their text, options, age and how to answer", async () => {
    const listed = (await connector("GET", "approvals?status=pending")).body.approvals as any[];
    const offer = listed.find((row) => row.id === "proactive:x1");
    expect(offer).toMatchObject({
      threadId: "conv", botId: "b1", botName: "Nimbus", waitingKind: "proposal", kind: "question", answerWith: "option",
      title: "Garder le brief du jour ?", text: "Garder le brief du jour ?\n\nSi tu dis oui, je te l'envoie chaque jour à 8 h 00.",
      choices: [{ id: "1", label: "Oui" }, { id: "2", label: "Pas maintenant" }], freeText: false, canAnswer: true, skippable: true, ageMs: NOW - 3_000,
    });
    const needs = listed.find((row) => row.id === "attention:m-needs");
    expect(needs).toMatchObject({ waitingKind: "request", text: "Approve the invoice for acme", choices: [{ id: "1", label: "Approve" }, { id: "2", label: "Hold" }], freeText: true });
    const input = listed.find((row) => row.id === "attention:m-input");
    expect(input).toMatchObject({ waitingKind: "request", title: "Which build host should I use?", text: "Which build host should I use?", choices: [], freeText: true });
    // the option cards keep the shape they always had, with the new fields beside
    expect(listed.find((row) => row.id === "req_q")).toMatchObject({ kind: "question", answerWith: "option", waitingKind: "question", skippable: true });
    expect(listed.find((row) => row.id === "req_perm")).toMatchObject({ kind: "permission", answerWith: "decision", waitingKind: "approval" });
  });

  it("answers an offer by option and a question in words by text, through the connector's answer route; each leaves every surface at once", async () => {
    const offer = await connector("POST", "approvals/proactive:x1", { threadId: "conv", option: "Oui" });
    expect(offer.status, JSON.stringify(offer.body)).toBe(200);
    expect(offer.body).toMatchObject({ closed: true, decision: "allow", state: "allowed", option: "Oui" });
    expect(performed.at(-1)?.request).toMatchObject({ method: "POST", path: "/api/bots/b1/proactive/x1", body: { accept: true } });

    const words = await connector("POST", "approvals/attention:m-input", { threadId: "conv", text: "The second one" });
    expect(words.status, JSON.stringify(words.body)).toBe(200);
    expect(words.body).toMatchObject({ closed: true, state: "answered" });
    // the words go to the waiting work's thread, as the app sends them
    expect(performed.at(-1)?.request).toMatchObject({ method: "POST", path: "/api/bots/b2/messages", body: { text: "The second one", threadId: "work-b" } });
    expect(settled).toEqual([{ messageId: "m-input", how: "handled" }]);
    expect(await counts()).toEqual({ today: 3, pinned: 3, connector: 3 });
  });

  it("skips an offer, a question in words and an option card through the connector", async () => {
    expect((await connector("POST", "approvals/proactive:x1", { threadId: "conv", skip: true })).body).toMatchObject({ closed: true, state: "skipped" });
    expect(performed.at(-1)?.request).toMatchObject({ path: "/api/bots/b1/proactive/x1", body: { skip: true } });
    // an older client's deny skips a question in words
    expect((await connector("POST", "approvals/attention:m-needs", { threadId: "conv", decision: "deny" })).body).toMatchObject({ closed: true, state: "skipped" });
    expect((await connector("POST", "approvals/attention:m-input", { threadId: "conv", skip: true })).body).toMatchObject({ closed: true, state: "skipped" });
    expect(settled).toEqual([{ messageId: "m-needs", how: "skipped" }, { messageId: "m-input", how: "skipped" }]);
    expect((await connector("POST", "approvals/req_q", { threadId: "conv", skip: true })).body).toMatchObject({ closed: true, state: "skipped" });
    expect(performed.at(-1)?.request).toMatchObject({ path: "/api/threads/conv/respond", body: { requestId: "req_q", skip: true } });
    expect(await counts()).toEqual({ today: 2, pinned: 2, connector: 2 });
    // gone: nothing waits under that id any more
    expect((await connector("POST", "approvals/attention:m-input", { threadId: "conv", text: "late" })).status).toBe(404);
  });

  it("a question in words whose ask closed elsewhere leaves every surface at the same time", async () => {
    // the parked work got its answer in its own thread (settleInputRequests)
    patchMessage("conv", "m-input", { inputRequest: { ...messages.conv!.find((row) => row.id === "m-input")!.inputRequest!, answered: true } });
    expect(await counts()).toEqual({ today: 4, pinned: 4, connector: 4 });
  });
});
