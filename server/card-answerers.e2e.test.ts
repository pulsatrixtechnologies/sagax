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
//   9. (PR #934) a team-memory card is the team's: a member who can use a
//      bot of that section confirms it on either route, though not the bot's
//      owner; someone outside the team is refused; a bot moved to another
//      section since its proposal no longer lets its old team confirm; the
//      dialog's direct writes stay admin; a local service confirms none
//  10. that card also notifies, and lists in the inbox of, the members who may
//      confirm it (never a stranger, never another kind of approval)
//  11. per-bot team memory sharing: "shared" (the default) lists the card
//      for every member of the section, marked not answerable where they
//      cannot answer; "private" keeps it to the members who see the bot and
//      its thread or channel (owner and those members still get it)
//  12. the bot's own memory never travels as a team-memory card, whatever
//      the setting
//  13. the team-memory page settling an entry (accept, edit, delete) closes
//      its card everywhere, live; a late click on a settled card reads the
//      real outcome (409), never a fresh "allowed"
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

const teamMemoryRefusal = /Only a member of this team, or an organization admin, can review its shared memory/;

/** A bot of BOSS in `section`, shared only with `members`. */
async function makeTeamBot(name: string, section: string, members: string[]) {
  const created = await api("POST", "/api/bots", { name }, BOSS);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const patched = await api("PATCH", `/api/bots/${created.body.bot.id}`, { modelSelection: { instanceId: "grok", model: "fake-model" }, approvalMode: "ask", computer: "off", section }, BOSS);
  expect(patched.status, JSON.stringify(patched.body)).toBe(200);
  for (const email of members) {
    const granted = await api("POST", `/api/bots/${created.body.bot.id}/direct-grants`, { userId: email }, BOSS);
    expect(granted.status, JSON.stringify(granted.body)).toBe(200);
  }
  return created.body.bot as { id: string; threadId: string };
}

/** The bot's shell proposes a team-memory entry from this thread. */
async function proposeTeamMemory(bot: { id: string }, threadId: string, name: string) {
  const minted = await fetch(`${BASE}/api/testing/internal-capability`, {
    method: "POST", headers: { "content-type": "application/json", "x-openmausbot-test-capability": CAPABILITY_KEY },
    body: JSON.stringify({ botId: bot.id, threadId, kind: "agents" }),
  });
  expect(minted.status).toBe(201);
  const { token } = await minted.json() as { token: string };
  const proposed = await fetch(`${BASE}/api/internal/team-memory`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ fromBotId: bot.id, fromThreadId: threadId, kind: "term", name, detail: `${name} means the dispatch board` }),
  });
  const body = await proposed.json() as { status: string; requestId: string };
  expect(proposed.status, JSON.stringify(body)).toBe(201);
  expect(body.status).toBe("proposed");
  return body.requestId;
}

/** A person's live event stream, parsed frame by frame. */
function openStream(as: string) {
  const controller = new AbortController();
  const frames: any[] = [];
  const state: { hello: any } = { hello: null };
  void (async () => {
    try {
      const res = await fetch(`${BASE}/api/events`, { headers: { authorization: `Bearer ${tokens[as]}` }, signal: controller.signal });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const chunk = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          for (const line of chunk.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            const frame = JSON.parse(line.slice(6));
            if (frame.kind === "hello") state.hello = frame;
            else if (frame.kind !== "ping") frames.push(frame);
          }
        }
      }
    } catch {
      /* aborted */
    }
  })();
  return { frames, ready: () => waitFor(async () => state.hello, 10_000), close: () => controller.abort() };
}

const teamEntry = async (section: string, name: string) =>
  ((await api("GET", `/api/team-memory?section=${encodeURIComponent(section)}`, undefined, BOSS)).body.entries ?? [])
    .find((entry: { name: string }) => entry.name === name) as { status: string } | undefined;

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

  it("lets a member of the team, not its owner, confirm a team-memory card; a stranger is refused", async () => {
    // Juniper is BOSS's, in Dispatch, shared with Ada (Zachary's place). Bob uses no Dispatch bot.
    const juniper = await makeTeamBot("Juniper", "Dispatch", [ADA]);
    await makeTeamBot("Sales desk", "Sales", [BOB]);
    const task = await api("POST", `/api/bots/${juniper.id}/tasks`, { title: "Ada's dispatch" }, ADA);
    expect(task.status, JSON.stringify(task.body)).toBe(201);
    const threadId = task.body.task.threadId as string;

    const viaThread = await proposeTeamMemory(juniper, threadId, "Board A");
    // Ada gets the card itself in her conversation, not "waiting on owner"
    const seen = (await api("GET", `/api/threads/${threadId}/messages`, undefined, ADA)).body.messages
      .find((m: any) => m.card?.requestId === viaThread);
    expect(seen?.card?.teamMemoryRequest?.section, JSON.stringify(seen)).toBe("Dispatch");
    const stranger = await api("POST", `/api/threads/${threadId}/respond`, { requestId: viaThread, behavior: "allow" }, BOB);
    expect(stranger.status, JSON.stringify(stranger.body)).toBeOneOf([403, 404]);
    if (stranger.status === 403) expect(stranger.body.error).toMatch(teamMemoryRefusal);
    expect((await teamEntry("Dispatch", "Board A"))?.status).toBe("proposed");
    const accepted = await api("POST", `/api/threads/${threadId}/respond`, { requestId: viaThread, behavior: "allow" }, ADA);
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect((await teamEntry("Dispatch", "Board A"))?.status).toBe("accepted");

    const viaBot = await proposeTeamMemory(juniper, threadId, "Board B");
    const strangerBot = await api("POST", `/api/bots/${juniper.id}/respond`, { requestId: viaBot, behavior: "allow", threadId }, BOB);
    expect(strangerBot.status, JSON.stringify(strangerBot.body)).toBeOneOf([403, 404]);
    const acceptedBot = await api("POST", `/api/bots/${juniper.id}/respond`, { requestId: viaBot, behavior: "allow", threadId }, ADA);
    expect(acceptedBot.status, JSON.stringify(acceptedBot.body)).toBe(200);
    expect((await teamEntry("Dispatch", "Board B"))?.status).toBe("accepted");

    // the dialog's direct writes stay admin: the card is a member's only way in
    expect((await api("POST", "/api/team-memory?section=Dispatch", { kind: "term", name: "Direct", detail: "no card" }, ADA)).status).toBe(403);
    expect((await api("DELETE", `/api/team-memory/${viaThread}?section=Dispatch`, undefined, ADA)).status).toBe(403);
    expect((await teamEntry("Dispatch", "Board A"))?.status).toBe("accepted");
    // any other approval on Juniper stays its owner's
    const command = await cardFrom(juniper, threadId, ADA);
    const notOwner = await api("POST", `/api/threads/${threadId}/respond`, { requestId: command, behavior: "allow" }, ADA);
    expect(notOwner.status).toBe(403);
    expect(notOwner.body.error).toMatch(refusal);
    expect((await api("POST", `/api/threads/${threadId}/respond`, { requestId: command, behavior: "deny" }, BOSS)).status).toBe(200);
  }, 90_000);

  it("refuses the old team once the proposing bot moved to another section", async () => {
    const mover = await makeTeamBot("Mover", "Dispatch East", [ADA]);
    const task = await api("POST", `/api/bots/${mover.id}/tasks`, { title: "Ada's east" }, ADA);
    expect(task.status, JSON.stringify(task.body)).toBe(201);
    const threadId = task.body.task.threadId as string;
    const requestId = await proposeTeamMemory(mover, threadId, "East board");
    expect((await api("PATCH", `/api/bots/${mover.id}`, { section: "Warehouse" }, BOSS)).status).toBe(200);
    // delivery follows the answer: the old team no longer gets a card it cannot confirm
    const afterMove = (await api("GET", `/api/threads/${threadId}/messages`, undefined, ADA)).body.messages as any[];
    expect(afterMove.some((m) => m.card?.requestId === requestId)).toBe(false);
    expect((await api("GET", "/api/approvals", undefined, ADA)).body.pending.some((item: any) => item.requestId === requestId)).toBe(false);
    const refused = await api("POST", `/api/threads/${threadId}/respond`, { requestId, behavior: "allow" }, ADA);
    expect(refused.status, JSON.stringify(refused.body)).toBe(403);
    expect(refused.body.error).toMatch(teamMemoryRefusal);
    expect((await teamEntry("Dispatch East", "East board"))?.status).toBe("proposed");
    // an admin still decides it
    expect((await api("POST", `/api/threads/${threadId}/respond`, { requestId, behavior: "deny" }, BOSS)).status).toBe(200);
  }, 90_000);

  it("notifies a team-memory card and lists it in the inbox of the section members who may confirm it", async () => {
    const bot = await makeTeamBot("Notifier", "Dispatch Night", [ADA]);
    await makeTeamBot("Sales night", "Sales Night", [BOB]);
    const task = await api("POST", `/api/bots/${bot.id}/tasks`, { title: "Ada's night" }, ADA);
    expect(task.status, JSON.stringify(task.body)).toBe(201);
    const threadId = task.body.task.threadId as string;
    const streams = { ada: openStream(ADA), bob: openStream(BOB), boss: openStream(BOSS) };
    try {
      await Promise.all(Object.values(streams).map((stream) => stream.ready()));
      const requestId = await proposeTeamMemory(bot, threadId, "Night board");
      const notified = (stream: ReturnType<typeof openStream>) => waitFor(async () =>
        stream.frames.find((frame) => frame.kind === "notify" && frame.notification?.requestId === requestId) ?? null, 5_000);
      // the member who may confirm it, and the bot's owner, hear of it; a stranger does not
      expect(await notified(streams.ada)).not.toBeNull();
      expect(await notified(streams.boss)).not.toBeNull();
      expect(await notified(streams.bob)).toBeNull();
      const inbox = async (as: string) => ((await api("GET", "/api/approvals", undefined, as)).body.pending ?? [])
        .filter((item: any) => item.requestId === requestId);
      const mine = await waitFor(async () => { const rows = await inbox(ADA); return rows.length ? rows : null; }, 10_000);
      expect(mine, "the member finds the card in the inbox").toHaveLength(1);
      expect(mine![0]).toMatchObject({ threadId, decidable: true });
      expect(await inbox(BOB)).toEqual([]);
      // answering from the inbox is the same decision as in the conversation
      expect((await api("POST", `/api/threads/${threadId}/respond`, { requestId, behavior: "deny" }, ADA)).status).toBe(200);
      expect(await inbox(ADA)).toEqual([]);
      // another kind of approval on the same bot stays the owner's: no inbox row, no notification for Ada
      const command = await cardFrom(bot, threadId, ADA);
      expect(streams.ada.frames.some((frame) => frame.kind === "notify" && frame.notification?.requestId === command)).toBe(false);
      expect(await inbox(ADA)).toEqual([]);
      expect((await api("POST", `/api/threads/${threadId}/respond`, { requestId: command, behavior: "deny" }, BOSS)).status).toBe(200);
    } finally {
      for (const stream of Object.values(streams)) stream.close();
    }
  }, 90_000);

  it("shares a team-memory card with the whole section by default, and keeps it to those who see the bot when private", async () => {
    // Both bots sit in one section; Ada uses only the first, Bob only the second.
    const bot = await makeTeamBot("Sharing A", "Dispatch Sharing", [ADA]);
    await makeTeamBot("Sharing B", "Dispatch Sharing", [BOB]);
    const task = await api("POST", `/api/bots/${bot.id}/tasks`, { title: "Ada's sharing title" }, ADA);
    expect(task.status, JSON.stringify(task.body)).toBe(201);
    const threadId = task.body.task.threadId as string;
    const inbox = async (as: string, requestId: string) => ((await api("GET", "/api/approvals", undefined, as)).body.pending ?? [])
      .filter((item: any) => item.requestId === requestId);
    const listed = (as: string, requestId: string) => waitFor(async () => { const rows = await inbox(as, requestId); return rows.length ? rows : null; }, 10_000);
    const ownView = async () => ((await api("GET", "/api/bots?messages=0", undefined, BOSS)).body.bots as any[]).find((candidate) => candidate.id === bot.id);
    expect((await ownView())?.teamMemorySharing).toBeUndefined();

    // shared (the default): Bob, a member of the section, sees the card, but
    // may not answer on a conversation he cannot open
    const sharedRequest = await proposeTeamMemory(bot, threadId, "Shared board");
    const adas = await listed(ADA, sharedRequest);
    expect(adas![0]).toMatchObject({ threadId, decidable: true });
    const bobs = await listed(BOB, sharedRequest);
    expect(bobs, "a member of the section sees a shared card").toHaveLength(1);
    expect(bobs![0]).toMatchObject({ threadId, decidable: false, bulk: "not-yours" });
    expect(bobs![0].message?.card?.teamMemoryRequest?.section).toBe("Dispatch Sharing");
    expect((await api("POST", `/api/threads/${threadId}/respond`, { requestId: sharedRequest, behavior: "deny" }, ADA)).status).toBe(200);

    // private: only the people who see the bot and the conversation
    expect((await api("PATCH", `/api/bots/${bot.id}`, { teamMemorySharing: "everyone" }, BOSS)).status).toBe(400);
    expect((await api("PATCH", `/api/bots/${bot.id}`, { teamMemorySharing: "private" }, BOSS)).status).toBe(200);
    expect((await ownView())?.teamMemorySharing).toBe("private");
    const streams = { ada: openStream(ADA), bob: openStream(BOB), boss: openStream(BOSS) };
    try {
      await Promise.all(Object.values(streams).map((stream) => stream.ready()));
      const requestId = await proposeTeamMemory(bot, threadId, "Private board");
      const notified = (stream: ReturnType<typeof openStream>) => waitFor(async () =>
        stream.frames.find((frame) => frame.kind === "notify" && frame.notification?.requestId === requestId) ?? null, 5_000);
      // the owner and the member who uses this bot still get it
      expect(await notified(streams.boss)).not.toBeNull();
      expect(await notified(streams.ada)).not.toBeNull();
      const adaRows = await listed(ADA, requestId);
      expect(adaRows![0]).toMatchObject({ threadId, decidable: true });
      expect(adaRows![0].message?.card?.requestId).toBe(requestId);
      // the other member of the section gets nothing: no frame, no row, no title, no card
      expect(await notified(streams.bob)).toBeNull();
      const bobInbox = await api("GET", "/api/approvals", undefined, BOB);
      expect(bobInbox.status).toBe(200);
      expect(JSON.stringify(bobInbox.body)).not.toContain(requestId);
      expect(JSON.stringify(bobInbox.body)).not.toContain("Ada's sharing title");
      expect(JSON.stringify(bobInbox.body)).not.toContain("Private board");
      expect((await api("GET", `/api/threads/${threadId}/messages`, undefined, BOB)).status).toBe(404);
      expect((await api("POST", `/api/threads/${threadId}/respond`, { requestId, behavior: "allow" }, BOB)).status).toBeOneOf([403, 404]);
      expect((await teamEntry("Dispatch Sharing", "Private board"))?.status).toBe("proposed");
      expect((await api("POST", `/api/threads/${threadId}/respond`, { requestId, behavior: "allow" }, ADA)).status).toBe(200);
      expect((await teamEntry("Dispatch Sharing", "Private board"))?.status).toBe("accepted");
    } finally {
      for (const stream of Object.values(streams)) stream.close();
    }
    // back to shared: the default is stored as no setting at all
    expect((await api("PATCH", `/api/bots/${bot.id}`, { teamMemorySharing: "shared" }, BOSS)).status).toBe(200);
    expect((await ownView())?.teamMemorySharing).toBeUndefined();
  }, 90_000);

  it("keeps a private bot's channel card from a member of its section outside that channel", async () => {
    const bot = await makeTeamBot("Room sharing", "Room Sharing", [ADA, BOB]);
    const room = await api("POST", "/api/groups", { memberIds: [bot.id], name: "Ada and the owner", humanIds: [BOSS, ADA] }, BOSS);
    expect(room.status, JSON.stringify(room.body)).toBe(201);
    const group = room.body.group as { id: string; threadId: string };
    const inbox = async (as: string, requestId: string) => ((await api("GET", "/api/approvals", undefined, as)).body.pending ?? [])
      .filter((item: any) => item.requestId === requestId);
    const listed = (as: string, requestId: string) => waitFor(async () => { const rows = await inbox(as, requestId); return rows.length ? rows : null; }, 10_000);

    // shared: Bob, outside the channel, sees it and may not answer it
    const sharedRequest = await proposeTeamMemory(bot, group.threadId, "Shared room board");
    expect((await listed(BOB, sharedRequest))![0]).toMatchObject({ decidable: false });
    expect((await api("POST", `/api/threads/${group.threadId}/respond`, { requestId: sharedRequest, behavior: "deny" }, BOSS)).status).toBe(200);

    expect((await api("PATCH", `/api/bots/${bot.id}`, { teamMemorySharing: "private" }, BOSS)).status).toBe(200);
    const requestId = await proposeTeamMemory(bot, group.threadId, "Private room board");
    // the member in the channel still gets it
    const adas = await listed(ADA, requestId);
    expect(adas![0]).toMatchObject({ threadId: group.threadId, decidable: true, roomName: "Ada and the owner" });
    // a member of the section outside the channel gets nothing
    const bobs = await api("GET", "/api/approvals", undefined, BOB);
    expect(bobs.status).toBe(200);
    expect(JSON.stringify(bobs.body)).not.toContain(requestId);
    expect(JSON.stringify(bobs.body)).not.toContain("Private room board");
    expect((await api("POST", `/api/threads/${group.threadId}/respond`, { requestId, behavior: "allow" }, BOB)).status).toBeOneOf([403, 404]);
    expect((await teamEntry("Room Sharing", "Private room board"))?.status).toBe("proposed");
    expect((await api("POST", `/api/threads/${group.threadId}/respond`, { requestId, behavior: "deny" }, BOSS)).status).toBe(200);
  }, 90_000);

  it("never sends a bot's own memory to another member as a card, shared or private", async () => {
    const bot = await makeTeamBot("Own memory", "Dispatch Own", [ADA]);
    await makeTeamBot("Own memory B", "Dispatch Own", [BOB]);
    const task = await api("POST", `/api/bots/${bot.id}/tasks`, { title: "Ada's own" }, ADA);
    expect(task.status, JSON.stringify(task.body)).toBe(201);
    const threadId = task.body.task.threadId as string;
    for (const sharing of ["shared", "private"] as const) {
      expect((await api("PATCH", `/api/bots/${bot.id}`, { teamMemorySharing: sharing }, BOSS)).status).toBe(200);
      const note = `Ada own note ${sharing} zq9`;
      const minted = await fetch(`${BASE}/api/testing/internal-capability`, {
        method: "POST", headers: { "content-type": "application/json", "x-openmausbot-test-capability": CAPABILITY_KEY },
        body: JSON.stringify({ botId: bot.id, threadId, kind: "agents" }),
      });
      expect(minted.status).toBe(201);
      const { token } = await minted.json() as { token: string };
      const wrote = await fetch(`${BASE}/api/internal/memory`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "append", text: note }),
      });
      expect(wrote.status, await wrote.clone().text()).toBe(200);
      // the owner reads it in the bot's memory
      expect(JSON.stringify((await api("GET", `/api/bots/${bot.id}/memory/file?path=MEMORY.md`, undefined, BOSS)).body)).toContain(note);
      // Bob, a member of the same section: no card, no row, no memory file
      const bobInbox = await api("GET", "/api/approvals", undefined, BOB);
      expect(JSON.stringify(bobInbox.body)).not.toContain(note);
      const bobMemory = await api("GET", `/api/bots/${bot.id}/memory/file?path=MEMORY.md`, undefined, BOB);
      expect(bobMemory.status).toBeOneOf([403, 404]);
      expect(JSON.stringify(bobMemory.body)).not.toContain(note);
      // and it is not team memory either
      expect(JSON.stringify((await api("GET", "/api/team-memory?section=Dispatch%20Own", undefined, BOSS)).body)).not.toContain(note);
    }
  }, 90_000);

  it("closes a team-memory card everywhere when the page settles its entry, and answers a late click with the real outcome", async () => {
    const section = "Page Settle";
    const q = `section=${encodeURIComponent(section)}`;
    const bot = await makeTeamBot("Page settle", section, [ADA]);
    await makeTeamBot("Page settle B", section, [BOB]);
    const task = await api("POST", `/api/bots/${bot.id}/tasks`, { title: "Ada's page thread" }, ADA);
    expect(task.status, JSON.stringify(task.body)).toBe(201);
    const threadId = task.body.task.threadId as string;
    const inbox = async (as: string, requestId: string) => ((await api("GET", "/api/approvals", undefined, as)).body.pending ?? [])
      .filter((item: any) => item.requestId === requestId);
    const listed = (as: string, requestId: string) => waitFor(async () => { const rows = await inbox(as, requestId); return rows.length ? rows : null; }, 10_000);
    const cardOf = async (requestId: string, as = BOSS) => ((await api("GET", `/api/threads/${threadId}/messages`, undefined, as)).body.messages ?? [])
      .find((m: any) => m.card?.requestId === requestId)?.card;
    const streams = { ada: openStream(ADA), bob: openStream(BOB), boss: openStream(BOSS) };
    const patched = (stream: ReturnType<typeof openStream>, requestId: string, answered: string) => waitFor(async () =>
      stream.frames.find((frame) => frame.kind === "message.patch" && frame.message?.card?.requestId === requestId && frame.message.card.answered === answered) ?? null, 5_000);
    try {
      await Promise.all(Object.values(streams).map((stream) => stream.ready()));
      const cases = [
        { name: "Page accepted", settle: (id: string) => api("PATCH", `/api/team-memory/${id}?${q}`, { accept: true }, BOSS), answered: "allow", outcome: "allowed-once", entry: "accepted", late: "deny" },
        { name: "Page edited", settle: (id: string) => api("PATCH", `/api/team-memory/${id}?${q}`, { detail: "edited on the page" }, BOSS), answered: "allow", outcome: "allowed-once", entry: "accepted", late: "deny" },
        { name: "Page deleted", settle: (id: string) => api("DELETE", `/api/team-memory/${id}?${q}`, undefined, BOSS), answered: "deny", outcome: "rejected", entry: undefined, late: "allow" },
      ] as const;
      for (const item of cases) {
        const requestId = await proposeTeamMemory(bot, threadId, item.name);
        // before: the owner, Ada (who uses this bot) and Bob (section member, shared) each list it
        for (const as of [BOSS, ADA, BOB]) expect(await listed(as, requestId), `${item.name} ${as}`).toHaveLength(1);
        const settled = await item.settle(requestId);
        expect(settled.status, `${item.name}: ${JSON.stringify(settled.body)}`).toBe(200);
        // the card is closed in the conversation, with who settled it
        const card = await cardOf(requestId);
        expect(card, item.name).toMatchObject({ answered: item.answered, answeredBy: { kind: "session", name: BOSS } });
        expect(await cardOf(requestId, ADA), item.name).toMatchObject({ answered: item.answered });
        // live: the people who see the conversation get the patch
        expect(await patched(streams.boss, requestId, item.answered), `${item.name} boss frame`).not.toBeNull();
        expect(await patched(streams.ada, requestId, item.answered), `${item.name} ada frame`).not.toBeNull();
        // no inbox lists it any more
        for (const as of [BOSS, ADA, BOB]) expect(await inbox(as, requestId), `${item.name} ${as} inbox`).toHaveLength(0);
        // a late click reads the real outcome, and changes nothing
        for (const path of [`/api/threads/${threadId}/respond`, `/api/bots/${bot.id}/respond`]) {
          const late = await api("POST", path, { requestId, behavior: item.late, threadId }, ADA);
          expect(late.status, `${item.name} ${path}: ${JSON.stringify(late.body)}`).toBe(409);
          expect(late.body).toMatchObject({ code: "team_memory_settled", outcome: item.outcome, alreadySettled: true, settledBy: BOSS });
          expect(late.body.error).toContain(item.outcome === "allowed-once" ? "already accepted" : "already declined or deleted");
        }
        expect((await teamEntry(section, item.name))?.status, item.name).toBe(item.entry);
        expect(await cardOf(requestId), item.name).toMatchObject({ answered: item.answered, answeredBy: { name: BOSS } });
      }

      // settled on its card: a second click, by anyone, reads who did it
      const onCard = await proposeTeamMemory(bot, threadId, "Card accepted");
      expect((await api("POST", `/api/threads/${threadId}/respond`, { requestId: onCard, behavior: "allow" }, ADA)).status).toBe(200);
      const second = await api("POST", `/api/threads/${threadId}/respond`, { requestId: onCard, behavior: "deny" }, BOSS);
      expect(second.status, JSON.stringify(second.body)).toBe(409);
      expect(second.body).toMatchObject({ code: "team_memory_settled", outcome: "allowed-once", settledBy: ADA });
      expect((await teamEntry(section, "Card accepted"))?.status).toBe("accepted");
    } finally {
      for (const stream of Object.values(streams)) stream.close();
    }
  }, 120_000);

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

  it("lets a local service under service trust neither confirm a team-memory card nor write team memory", async () => {
    // still on the service-trust server the previous case started
    const bot = await makeTeamBot("Serviced team", "Dispatch", [ADA]);
    const task = await api("POST", `/api/bots/${bot.id}/tasks`, { title: "Ada's serviced" }, ADA);
    expect(task.status, JSON.stringify(task.body)).toBe(201);
    const threadId = task.body.task.threadId as string;
    const requestId = await proposeTeamMemory(bot, threadId, "Serviced term");
    expect((await api("POST", `/api/threads/${threadId}/respond`, { requestId, behavior: "allow" })).status).toBe(403);
    expect((await api("POST", `/api/bots/${bot.id}/respond`, { requestId, behavior: "allow", threadId }, undefined, true)).status).toBe(403);
    expect((await api("POST", "/api/team-memory?section=Dispatch", { kind: "term", name: "Service", detail: "no card" })).status).toBe(403);
    expect((await teamEntry("Dispatch", "Serviced term"))?.status).toBe("proposed");
    expect((await api("POST", `/api/threads/${threadId}/respond`, { requestId, behavior: "allow" }, ADA)).status).toBe(200);
    expect((await teamEntry("Dispatch", "Serviced term"))?.status).toBe("accepted");
  }, 90_000);
});
