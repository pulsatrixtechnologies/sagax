// Who may answer an approval card on a workspace several people share, and
// the record of who did. The real server runs against the fake ACP CLI in
// "permission" mode (every turn asks to run `echo hi`), with an email
// sign-in list naming one admin and two members, whose sessions are issued
// before boot. The bots are shared with both members (direct grants).
//
// Since "refuse non-owner approval answers on every thread" (aa8a349fc) an
// approval card is its bot owner's to answer, whoever sent the request:
//   1. the member who sent the request, and any other member, are refused on
//      either respond route; the owner answers
//   2. starting the thread does not make a member an answerer either
//   3. a thread a bot opened for a member's request: still the owner's
//   4. a card that names nobody (sent by the operator at this computer): the
//      owner answers, a member may not
//   5. the operator at this computer answers the cards of a bot it owns; an
//      admin who does not own a bot may not, nor the operator another's
//   6. a session-less local service (service loopback trust) answers none
//   7. the decision row and the card both name who answered
//   8. Undo on a change that applied without a person follows the same
//      rule: the owner may, a member may not, even the one who started the
//      thread
//
// No new card, prompt or gate appears anywhere: the provider's own approval
// is the card, and these only decide whose answer it accepts.
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DecisionRow } from "./decision-log.ts";
import { SessionRegistry } from "./sessions.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLI = join(SERVER_DIR, "testing", "fake-acp-cli.ts");
const PORT = await freePortBlock([0, 1]);
const BASE = `http://127.0.0.1:${PORT}`;
const posixOnly = describe.skipIf(process.platform === "win32");
const BOSS = "boss@example.test";
const ADA = "ada@example.test";
const BOB = "bob@example.test";
const CAPABILITY_KEY = "card-answerers-fixture-capability";

let child: ChildProcess;
let home: string;
let log = "";
const tokens: Record<string, string> = {};
const sessionIds: Record<string, string> = {};

const RELAY = "r".repeat(43);

const api = async (method: string, path: string, body?: unknown, as?: string, relay = false): Promise<{ status: number; body: any }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(as ? { authorization: `Bearer ${tokens[as]}` } : {}),
      ...(relay ? { "x-sagax-worker-relay": RELAY } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

async function start(env: NodeJS.ProcessEnv = {}) {
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: join(SERVER_DIR, ".."),
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      HOME: home, USERPROFILE: home, SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "", SAGAX_PORT: String(PORT), SAGAX_WEBHOOK_PORT: String(PORT + 1),
      SAGAX_TEST_INTERNAL_CAPABILITY_KEY: CAPABILITY_KEY, ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (c) => (log += c));
  child.stderr!.on("data", (c) => (log += c));
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`server never came up:\n${log}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function waitFor<T>(read: () => Promise<T | null | undefined>, ms = 30_000): Promise<T | null> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 250));
  }
}

// Read as the bot's owner: an approval card is withheld from anyone else.
const openCard = (threadId: string, owner: string | null = BOSS) => waitFor(async () => {
  const { body } = await api("GET", `/api/threads/${threadId}/messages`, undefined, owner ?? undefined);
  return (body.messages ?? []).find((m: any) => m.kind === "options" && m.card?.requestId && !m.card.answered) ?? null;
});
const settledCard = (threadId: string, requestId: string, owner: string | null = BOSS) => waitFor(async () => {
  const { body } = await api("GET", `/api/threads/${threadId}/messages`, undefined, owner ?? undefined);
  return (body.messages ?? []).find((m: any) => m.card?.requestId === requestId && m.card.answeredBy) ?? null;
});
const decision = (requestId: string, kind: DecisionRow["decision"]) => waitFor(async () => {
  const { body } = await api("GET", "/api/decisions", undefined, BOSS);
  return ((body.decisions ?? []) as DecisionRow[]).find((row) => row.requestId === requestId && row.decision === kind) ?? null;
});

/** A bot owned by `owner` (a session), or by the operator at this computer. */
// New bots start on Approve for me (51647a630); these cases are about who answers a card, so each bot is on Ask, where every tool asks.
async function makeBot(name: string, owner: string | null = BOSS) {
  const as = owner ?? undefined;
  const created = await api("POST", "/api/bots", { name }, as);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const patched = await api("PATCH", `/api/bots/${created.body.bot.id}`, { modelSelection: { instanceId: "grok", model: "fake-model" }, approvalMode: "ask",
    // Off: on a machine with a container runtime and a prepared image, Auto attaches a Local VM and a second turn waits for its desktop.
    computer: "off" }, as);
  expect(patched.status).toBe(200);
  // Anyone else reaches a person's bot only once its owner shares it.
  for (const email of [BOSS, ADA, BOB].filter((email) => email !== owner)) {
    const granted = await api("POST", `/api/bots/${created.body.bot.id}/direct-grants`, { userId: email }, as);
    expect(granted.status, JSON.stringify(granted.body)).toBe(200);
  }
  return created.body.bot as { id: string; threadId: string };
}

async function cardFrom(bot: { id: string }, threadId: string, sender?: string, owner: string | null = BOSS) {
  const sent = await api("POST", `/api/bots/${bot.id}/messages`, { text: "run it", threadId }, sender);
  expect(sent.status, JSON.stringify(sent.body)).toBe(202);
  const card = await openCard(threadId, owner);
  expect(card, `no approval card appeared:\n${log.slice(-2_000)}`).not.toBeNull();
  return card.card.requestId as string;
}

const refusal = /Only the bot owner can answer this approval/;

posixOnly("who may answer an approval card on a shared workspace", () => {
  beforeAll(async () => {
    chmodSync(FAKE_CLI, 0o755);
    home = mkdtempSync(join(tmpdir(), "omb-card-answerers-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      signIn: { admins: [BOSS], members: [ADA, BOB] },
      instances: { grok: { driver: "grokAgent", environment: { FAKE_ACP_MODE: "permission" }, config: { cli: FAKE_CLI, fullAuto: false } } },
    }));
    const role = (email: string) => (email === BOSS ? ["admin", "client"] as const : ["client"] as const);
    const registry = new SessionRegistry({ file: join(data, "sessions.json"), emailScopes: (email) => [...role(email)] });
    for (const email of [BOSS, ADA, BOB]) {
      const issued = registry.issue({ label: `${email.split("@")[0]}'s laptop`, email, scopes: [...role(email)] });
      tokens[email] = issued.token;
      sessionIds[email] = issued.session.id;
    }
    registry.close(); // a clean close keeps account sessions across the server's boot
    await start();
  }, 40_000);

  afterAll(async () => {
    await waitForExit(child, { signal: "SIGTERM" });
    await removeTempDir(home);
  });

  it("refuses the member who sent the request, and any other member; the owner answers", async () => {
    const bot = await makeBot("Requested");
    const requestId = await cardFrom(bot, bot.threadId, ADA);

    for (const as of [ADA, BOB]) {
      for (const [path, body] of [
        [`/api/threads/${bot.threadId}/respond`, { requestId, behavior: "allow" }],
        [`/api/threads/${bot.threadId}/respond`, { requestId, behavior: "deny" }],
        [`/api/bots/${bot.id}/respond`, { requestId, behavior: "allow", threadId: bot.threadId }],
      ] as const) {
        const refused = await api("POST", path, body, as);
        expect(refused.status, `${as} ${path}`).toBe(403);
        expect(refused.body.error).toMatch(refusal);
      }
    }
    expect((await openCard(bot.threadId))?.card.requestId).toBe(requestId); // still open

    const answered = await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId, behavior: "allow" }, BOSS);
    expect(answered.status, JSON.stringify(answered.body)).toBe(200);
    expect(answered.body.outcome).not.toBe("unavailable");
    const row = await decision(requestId, "user-approved");
    expect(row?.actor).toEqual({ kind: "session", sessionId: sessionIds[BOSS], label: "boss's laptop", email: BOSS });
    expect((await settledCard(bot.threadId, requestId))?.card.answeredBy).toEqual({ kind: "session", name: BOSS });
  }, 90_000);

  it("does not make the member who started a thread an answerer", async () => {
    const bot = await makeBot("Started");
    const task = await api("POST", `/api/bots/${bot.id}/tasks`, { title: "Bob's thread" }, BOB);
    expect(task.status, JSON.stringify(task.body)).toBe(201);
    const threadId = task.body.task.threadId as string;
    // Who a thread was opened for is server-private: not on a task or the bot list.
    expect(JSON.stringify(task.body)).not.toContain("startedBy");
    expect(JSON.stringify((await api("GET", "/api/bots?messages=0", undefined, BOB)).body)).not.toContain("startedBy");
    // Only a bot's owner places it in a room.
    const room = await api("POST", "/api/groups", { memberIds: [bot.id], name: "Bob's room" }, BOB);
    expect(room.status, JSON.stringify(room.body)).toBe(403);
    const requestId = await cardFrom(bot, threadId, ADA);
    // Ada sent it, Bob started the thread: neither answers; the owner declines.
    const refused = await api("POST", `/api/bots/${bot.id}/respond`, { requestId, behavior: "deny", threadId }, BOB);
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatch(refusal);
    const answered = await api("POST", `/api/bots/${bot.id}/respond`, { requestId, behavior: "deny", threadId }, BOSS);
    expect(answered.status, JSON.stringify(answered.body)).toBe(200);
    expect((await decision(requestId, "user-denied"))?.actor).toMatchObject({ kind: "session", email: BOSS });
  }, 90_000);

  it("keeps a thread a bot opened for a member's request its owner's", async () => {
    const opener = await makeBot("Opener");
    const helper = await makeBot("Helper");
    const source = await cardFrom(opener, opener.threadId, ADA);
    // The opener, mid-way through Ada's request, hands work to a teammate in
    // a fresh thread (the threads route: coordinate_bots with thread "new",
    // an assignment on the job runtime, opened for the same person).
    const minted = await fetch(`${BASE}/api/testing/internal-capability`, {
      method: "POST", headers: { "content-type": "application/json", "x-openmausbot-test-capability": CAPABILITY_KEY },
      body: JSON.stringify({ botId: opener.id, threadId: opener.threadId }),
    });
    expect(minted.status).toBe(201);
    const { token } = await minted.json() as { token: string };
    const opened = await fetch(`${BASE}/api/internal/threads`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ toBotId: helper.id, title: "Helper job", message: "run it" }),
    });
    const openedBody = await opened.json() as { receipts: Array<{ threadId: string; outcome: string }> };
    expect(opened.status, JSON.stringify(openedBody)).toBe(200);
    expect(openedBody.receipts[0]).toMatchObject({ outcome: "queued", threadId: expect.any(String) });
    const helperThreadId = openedBody.receipts[0]!.threadId;
    // Ada may not approve her own request; the owner does, and the handoff's
    // turn runs in the thread opened for her.
    expect((await api("POST", `/api/threads/${opener.threadId}/respond`, { requestId: source, behavior: "allow" }, ADA)).status).toBe(403);
    expect((await api("POST", `/api/threads/${opener.threadId}/respond`, { requestId: source, behavior: "allow" }, BOSS)).status).toBe(200);
    const delegated = await openCard(helperThreadId);
    expect(delegated, `the handoff never asked:\n${log.slice(-2_000)}`).not.toBeNull();
    const requestId = delegated.card.requestId as string;
    for (const as of [ADA, BOB]) {
      const refused = await api("POST", `/api/threads/${helperThreadId}/respond`, { requestId, behavior: "allow" }, as);
      expect(refused.status, as).toBe(403);
      expect(refused.body.error).toMatch(refusal);
    }
    expect((await api("POST", `/api/threads/${helperThreadId}/respond`, { requestId, behavior: "allow" }, BOSS)).status).toBe(200);
    expect((await decision(requestId, "user-approved"))?.actor).toMatchObject({ kind: "session", email: BOSS });
  }, 90_000);

  it("lets the owner, not a member, answer a card that names nobody", async () => {
    const bot = await makeBot("Unnamed");
    // Sent by the operator on this machine: no session, no thread starter.
    const requestId = await cardFrom(bot, bot.threadId);
    const refused = await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId, behavior: "allow" }, BOB);
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatch(refusal);
    const answered = await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId, behavior: "allow" }, BOSS);
    expect(answered.status, JSON.stringify(answered.body)).toBe(200);
    expect((await decision(requestId, "user-approved"))?.actor).toMatchObject({ kind: "session", email: BOSS });
  }, 90_000);

  it("lets the operator on this machine answer its own bot's cards, and not someone else's", async () => {
    const own = await makeBot("Operator's", null);
    const requestId = await cardFrom(own, own.threadId, ADA, null);
    const refused = await api("POST", `/api/threads/${own.threadId}/respond`, { requestId, behavior: "deny" }, BOSS);
    expect(refused.status).toBe(403); // an admin who does not own the bot
    expect(refused.body.error).toMatch(refusal);
    expect((await api("POST", `/api/threads/${own.threadId}/respond`, { requestId, behavior: "deny" })).status).toBe(200);
    expect((await decision(requestId, "user-denied"))?.actor).toEqual({ kind: "loopback" });
    expect((await settledCard(own.threadId, requestId, null))?.card.answeredBy).toEqual({ kind: "loopback" });

    const boss = await makeBot("Boss's");
    const second = await cardFrom(boss, boss.threadId, BOB);
    const notMine = await api("POST", `/api/threads/${boss.threadId}/respond`, { requestId: second, behavior: "deny" });
    expect(notMine.status).toBe(403);
    expect(notMine.body.error).toMatch(refusal);
  }, 90_000);

  it("lets only the owner undo a receipt, not the member who started the thread", async () => {
    const bot = await makeBot("Undone");
    const task = await api("POST", `/api/bots/${bot.id}/tasks`, { title: "Bob's thread" }, BOB);
    expect(task.status).toBe(201);
    const threadId = task.body.task.threadId as string;
    const minted = await fetch(`${BASE}/api/testing/internal-capability`, {
      method: "POST", headers: { "content-type": "application/json", "x-openmausbot-test-capability": CAPABILITY_KEY },
      body: JSON.stringify({ botId: bot.id, threadId }),
    });
    const { token } = await minted.json() as { token: string };
    const proposed = await fetch(`${BASE}/api/internal/profile-requests`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ fromBotId: bot.id, fromThreadId: threadId, changes: { title: "Scout" }, reason: "asked" }),
    });
    const applied = await proposed.json() as { requestId: string; state: string };
    expect(applied.state, JSON.stringify(applied)).toBe("applied");

    for (const as of [ADA, BOB]) {
      const refused = await api("POST", `/api/threads/${threadId}/undo`, { requestId: applied.requestId }, as);
      expect(refused.status, as).toBe(403);
      expect(refused.body.error).toMatch(refusal);
    }
    const undone = await api("POST", `/api/threads/${threadId}/undo`, { requestId: applied.requestId }, BOSS);
    expect(undone, JSON.stringify(undone.body)).toMatchObject({ status: 200, body: { ok: true, undone: true } });
    expect((await api("GET", "/api/bots?messages=0", undefined, BOSS)).body.bots.find((candidate: { id: string }) => candidate.id === bot.id).title).toBe("");
  }, 90_000);

  it("lets a session-less local service answer no approval under service trust", async () => {
    const bot = await makeBot("Serviced");
    await waitForExit(child, { signal: "SIGTERM" });
    log = "";
    await start({ SAGAX_LOOPBACK_TRUST: "service", SAGAX_WORKER_RELAY_TOKEN: RELAY });
    expect(log).toContain("local requests: service trust (SAGAX_LOOPBACK_TRUST)");
    expect(log).toContain("The worker data plane answers only when the relay token is presented.");
    expect(log).not.toContain(RELAY);
    const requestId = await cardFrom(bot, bot.threadId, ADA);

    for (const behavior of ["allow", "deny"]) {
      const refused = await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId, behavior });
      expect(refused.status, behavior).toBe(403);
      expect(refused.body.error, behavior).toMatch(/service routes/);
    }
    // The bot-scoped route and the standing grant are not service routes, and the relay does not open them.
    expect((await api("POST", `/api/bots/${bot.id}/respond`, { requestId, behavior: "allow" }, undefined, true)).status).toBe(403);
    expect((await api("POST", `/api/bots/${bot.id}/always-allow`, { allowKey: "shell:echo" }, undefined, true)).status).toBe(403);
    expect((await api("POST", `/api/threads/${bot.threadId}/undo`, { requestId }, undefined, true)).status).toBe(403);
    expect((await openCard(bot.threadId))?.card.requestId).toBe(requestId);
    const answered = await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId, behavior: "deny" }, BOSS);
    expect(answered.status, JSON.stringify(answered.body)).toBe(200);
    expect((await decision(requestId, "user-denied"))?.actor).toMatchObject({ kind: "session", email: BOSS });

    // A worker-shaped request: without the relay the data plane stays closed.
    // With it, the worker opens the thread and sends through the guarded
    // route, so no person can be named. The owner approves it in Sagax; a
    // member may not.
    const bare = await api("POST", `/api/bots/${bot.id}/tasks`, { title: "closed" });
    expect(bare.status, JSON.stringify(bare.body)).toBe(403);
    const task = await api("POST", `/api/bots/${bot.id}/tasks`, { title: "Worker · C1 · 1.0" }, undefined, true);
    expect(task.status, JSON.stringify(task.body)).toBe(201);
    const threadId = task.body.task.threadId as string;
    const page = await api("GET", `/api/threads/${threadId}/messages?limit=0`, undefined, undefined, true);
    const guarded = await api("POST", `/api/bots/${bot.id}/messages/guarded`, {
      threadId, text: "run it", sendId: "slackjob_card_answerers_1", expectedActiveLeafId: page.body.activeLeafId ?? null,
    }, undefined, true);
    expect(guarded.status, JSON.stringify(guarded.body)).toBe(202);
    const slackCard = await openCard(threadId);
    expect(slackCard).not.toBeNull();
    expect((await api("POST", `/api/threads/${threadId}/respond`, { requestId: slackCard.card.requestId, behavior: "allow" }, ADA)).status).toBe(403);
    const approved = await api("POST", `/api/threads/${threadId}/respond`, { requestId: slackCard.card.requestId, behavior: "allow" }, BOSS);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  }, 90_000);
});
