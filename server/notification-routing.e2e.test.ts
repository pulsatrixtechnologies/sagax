import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";
import { waitForServerReady } from "./testing/server-ready.ts";
import { openSse } from "./testing/sse.ts";
import type { Assignment } from "./runtime/types.ts";

// Where a signal lands, end to end. Two bugs live here, and both are about a
// notification pointing at a conversation that did not change:
//
//   • a room reply also lit the speaking bot's own 1:1 badge — the sidebar
//     dot, the section count, the dock badge and the phone's Updates row all
//     opened a transcript where nothing had happened;
//   • bot-to-bot coordination raised badges and OS banners for the hop
//     behind one answer, because the peer's turn settles on its own thread.
//
// What must still break through is the other half: a card that reached a
// human, and a bot asking for hands — which now deep-links to the room it is
// stuck in. The unit halves of these rules live in notify.test.ts and
// comms-visibility.test.ts; this file pins the wiring around them.
//
// Every silence asserted below is only worth something beside the noise, so
// the ordinary turn — the one a person asked for, which must still badge and
// still buzz — is pinned first. A gate that suppressed everything would pass
// the quiet cases perfectly.

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SERVER_DIR, "..");
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const FAKE_ACP = join(SERVER_DIR, "testing", "fake-acp-cli.ts");
const TEST_CAPABILITY_KEY = "notification-routing-fixture-capability";

let child: ChildProcess;
let home = "";
let base = "";
let stderr = "";
let dumpFile = "";

const api = async (
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: any }> => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
};

const capability = async (
  botId: string,
  threadId: string,
  kind: "agents" | "computer" = "agents",
): Promise<Record<string, string>> => {
  const minted = await api(
    "POST",
    "/api/testing/internal-capability",
    { botId, threadId, kind },
    { "x-openmausbot-test-capability": TEST_CAPABILITY_KEY },
  );
  expect(minted.status).toBe(201);
  return { authorization: `Bearer ${minted.body.token}` };
};

// 84841aeed: these standalone peer probes have no requester turn to resume.
// Their real external-runtime capability runs consultations on a poll root.
const runtimes: Record<string, { token: string; threadId: string }> = {};
const peerCapability = (botId: string, threadId: string): Record<string, string> => {
  const token = `notification-runtime-${randomUUID()}`;
  runtimes[botId] = { token, threadId };
  writeFileSync(join(home, ".sagax", "external-runtimes.json"), JSON.stringify(runtimes), { mode: 0o600 });
  return { authorization: `Bearer ${token}` };
};

const peerWork = (fromBotId: string, toBotId: string): Assignment[] => {
  const db = new DatabaseSync(join(home, ".sagax", "runtime.db"), { readOnly: true });
  try {
    const rows = (db.prepare("SELECT json FROM assignments").all() as Array<{ json: string }>).map(row => JSON.parse(row.json) as Assignment);
    return rows.filter(row => row.parentId && row.assignee.botId === toBotId
      && rows.find(parent => parent.id === row.parentId)?.assignee.botId === fromBotId);
  } finally { db.close(); }
};

const threadMessages = async (threadId: string) =>
  (await api("GET", `/api/threads/${threadId}/messages?limit=40`)).body.messages as any[];

const state = async (messages = 40) => (await api("GET", `/api/bots?messages=${messages}`)).body;
const botState = async (botId: string) =>
  (await state(40)).bots.find((candidate: { id: string }) => candidate.id === botId);
const groupState = async (groupId: string) =>
  (await state(40)).groups.find((candidate: { id: string }) => candidate.id === groupId);

const createBot = async (name: string, instanceId: string, model = "claude-sonnet-5") => {
  const created = (await api("POST", "/api/bots", {})).body.bot;
  // notifications on, explicitly: a silent bot would pass the "no banner"
  // assertions for the wrong reason
  const patched = await api("PATCH", `/api/bots/${created.id}`, {
    name,
    notifications: true,
    computer: "off", browser: false,
    modelSelection: { instanceId, model },
  });
  expect(patched.status).toBe(200);
  return patched.body.bot;
};

const cleanup = async (groupIds: Array<string | undefined>, botIds: string[]) => {
  for (const groupId of groupIds) {
    if (groupId) await api("POST", `/api/groups/${groupId}/interrupt`, {}).catch(() => undefined);
  }
  for (const botId of botIds) await api("POST", `/api/bots/${botId}/interrupt`, {}).catch(() => undefined);
  for (const groupId of groupIds) {
    if (groupId) await api("DELETE", `/api/groups/${groupId}`).catch(() => undefined);
  }
  for (const botId of botIds) await api("DELETE", `/api/bots/${botId}`).catch(() => undefined);
};

beforeAll(async () => {
  chmodSync(FAKE_CLAUDE, 0o755);
  chmodSync(FAKE_ACP, 0o755);
  home = mkdtempSync(join(tmpdir(), "omb-notification-routing-"));
  // 1217ca7cf: failover honors the account probe even before dispatch.
  // This fake CLI represents a signed-in account, without real credentials.
  mkdirSync(join(home, ".grok"), { recursive: true });
  writeFileSync(join(home, ".grok", "auth.json"), '{"fixture":"offline"}\n', { mode: 0o600 });
  const data = join(home, ".sagax");
  mkdirSync(data, { recursive: true });
  dumpFile = join(home, "quick-dump.json");
  writeFileSync(join(data, "config.json"), JSON.stringify({
    instances: {
      // the everyday fixture: answers at once. Its dump is also the only
      // place a test can read the per-boot comms token from, and the
      // internal endpoints these tests drive are sealed behind it.
      quick: {
        driver: "claudeAgent",
        displayName: "Quick fixture",
        environment: { FAKE_CLAUDE_MODE: "happy", FAKE_CLAUDE_TOOL_CALLS: "[]", FAKE_CLAUDE_DUMP: dumpFile },
        config: { cli: FAKE_CLAUDE },
      },
      // never finishes: how a bot is held mid-room long enough to ask for
      // hands while the room still owns it
      stuck: {
        driver: "claudeAgent",
        displayName: "Stuck fixture",
        environment: { FAKE_CLAUDE_MODE: "hang" },
        config: { cli: FAKE_CLAUDE },
      },
      // stops mid-turn to ask the person a question no rule may answer —
      // the card that has to reach a human even from a peer's turn
      // asks before running a command: the approval an AI client's
      // conversation must still bring to the person
      asking: {
        driver: "grokAgent",
        displayName: "Asking fixture",
        // Use a write at Ask to exercise a pending approval and its notification.
        environment: { FAKE_ACP_MODE: "permission", FAKE_ACP_PERMISSION_TOOL_CALL: JSON.stringify({ kind: "execute", rawInput: { command: "touch notification-fixture.txt" }, title: "touch notification-fixture.txt" }) },
        config: { cli: FAKE_ACP },
      },
      curious: {
        driver: "grokAgent",
        displayName: "Curious fixture",
        environment: { FAKE_ACP_MODE: "question" },
        config: { cli: FAKE_ACP, fullAuto: true },
      },
    },
  }));
  const port = await freePortBlock([0, 1]);
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: ROOT,
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      HOME: home,
      USERPROFILE: home,
      SAGAX_PORT: String(port), SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "",
      SAGAX_WEBHOOK_PORT: String(port + 1),
      // the question-card test leaves its peer turn open on purpose; keep the
      // synchronous ask from parking for the production four minutes
      SAGAX_ASK_BOT_TIMEOUT_MS: "6000",
      // a hidden conversation's approval expires; seconds here, not minutes
      SAGAX_HIDDEN_APPROVAL_TTL_MS: "4000",
      SAGAX_TEST_INTERNAL_CAPABILITY_KEY: TEST_CAPABILITY_KEY,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr!.on("data", (chunk) => (stderr += chunk));

  await waitForServerReady(child, base, () => stderr);

}, 90_000);

afterAll(async () => {
  if (child) await waitForExit(child, { signal: "SIGTERM" });
  if (home) await removeTempDir(home);
});

describe("an ordinary turn still announces itself", () => {
  it("badges the bot and banners the person when a person asked", async () => {
    const bot = await createBot("Herald", "quick");
    const stream = await openSse(`${base}/api/events`);
    try {
      expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "how did it go?" })).status).toBe(202);

      // the plain case the whole feature is carved out of: nobody delegated
      // this, so the answer is news, and news gets a badge and a banner
      const frame = await stream.until(
        (candidate) =>
          candidate.kind === "notify" &&
          candidate.notification?.kind === "done" &&
          candidate.notification?.botId === bot.id,
        20_000,
      );
      expect(frame.notification).toMatchObject({ threadId: bot.threadId, title: "Herald finished" });
      expect(frame.notification.body).toContain("hello from fake claude");
      // no room in the picture, so nothing to group it under
      expect(frame.notification.groupId).toBeUndefined();
      await expect.poll(async () => (await botState(bot.id))?.unread, { timeout: 20_000 }).toBe(true);
    } finally {
      stream.close();
      await cleanup([], [bot.id]);
    }
  }, 40_000);
});

describe("a conversation on a live voice call", () => {
  it("is heard, not buzzed, and buzzes again once the person writes", async () => {
    const bot = await createBot("Caller", "quick");
    const stream = await openSse(`${base}/api/events`);
    try {
      const voiceCall = { callId: "call-notify-0001", interrupted: false };
      expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "on the phone: how did it go?", voiceCall })).status).toBe(202);
      // the answer lands in the thread (and is read aloud on the call)...
      await expect.poll(async () => ((await botState(bot.id))?.messages ?? []).some(
        (message: { role: string; text?: string }) => message.role === "bot" && (message.text ?? "").includes("hello from fake claude"),
      ), { timeout: 20_000 }).toBe(true);
      // ...with no banner: a unique patch is the ordering barrier, as below
      expect((await api("PATCH", `/api/bots/${bot.id}`, { name: "Caller observed" })).status).toBe(200);
      await stream.until((candidate) => candidate.kind === "bot" && candidate.bot?.id === bot.id && candidate.bot?.name === "Caller observed");
      expect(stream.frames.filter((candidate) => candidate.kind === "notify" && candidate.notification?.botId === bot.id)).toEqual([]);

      // hung up and written: news again
      expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "and in writing?" })).status).toBe(202);
      const frame = await stream.until(
        (candidate) => candidate.kind === "notify" && candidate.notification?.kind === "done" && candidate.notification?.botId === bot.id,
        20_000,
      );
      expect(frame.notification.threadId).toBe(bot.threadId);
    } finally {
      stream.close();
      await cleanup([], [bot.id]);
    }
  }, 60_000);
});

describe("a room turn belongs to the room", () => {
  it("leaves the speaking bot's own thread unread-free while the room lights up", async () => {
    const bot = await createBot("Roomie", "quick");
    let roomId: string | undefined;
    try {
      const room = (await api("POST", "/api/groups", {
        name: "Standup",
        memberIds: [bot.id],
        setup: { bulletin: "", defaultResponder: { kind: "everyone" } },
      })).body.group;
      roomId = room.id;
      expect((await api("POST", `/api/groups/${room.id}/messages`, { text: "status?" })).status).toBe(202);

      await expect.poll(async () => {
        const current = await groupState(room.id);
        const replied = (current?.messages ?? []).some(
          (message: { kind: string; role?: string }) => message.kind === "text" && message.role === "bot",
        );
        return { working: current?.working, replied };
      }, { timeout: 20_000 }).toEqual({ working: false, replied: true });

      // the room is where the reply is, so the room is what is unread. The
      // bot's 1:1 transcript never changed and must not claim otherwise.
      expect((await groupState(room.id))?.unread).toBe(true);
      expect((await botState(bot.id))?.unread).toBeFalsy();
    } finally {
      await cleanup([roomId], [bot.id]);
    }
  }, 40_000);

  it("sends a takeover raised mid-room to the room, not to the bot's DM", async () => {
    const bot = await createBot("Handsy", "stuck");
    let roomId: string | undefined;
    let requestId: string | undefined;
    try {
      const room = (await api("POST", "/api/groups", {
        name: "War Room",
        memberIds: [bot.id],
        setup: { bulletin: "", defaultResponder: { kind: "everyone" } },
      })).body.group;
      roomId = room.id;
      expect((await api("POST", `/api/groups/${room.id}/messages`, { text: "take the wheel" })).status).toBe(202);
      // the room must actually own the bot before it asks for hands
      await expect.poll(async () => (await groupState(room.id))?.busyBotId, { timeout: 20_000 }).toBe(bot.id);

      const stream = await openSse(`${base}/api/events`);
      try {
        const asked = await api(
          "POST",
          `/api/internal/computer-control?botId=${bot.id}`,
          { reason: "the login page wants a code" },
          await capability(bot.id, room.threadId, "computer"),
        );
        expect(asked.status).toBe(200);
        requestId = asked.body.requestId;

        const frame = await stream.until(
          (candidate) => candidate.kind === "notify" && candidate.notification?.kind === "takeover",
          15_000,
        );
        expect(frame.notification).toMatchObject({
          botId: bot.id,
          threadId: room.threadId,
          groupId: room.id,
          title: "Handsy in War Room needs your hands",
          body: "the login page wants a code",
        });
        // the DM is exactly where the person must NOT be sent: the screen
        // that needs hands is attached to the room's turn
        expect(frame.notification.threadId).not.toBe(bot.threadId);
      } finally {
        stream.close();
      }
    } finally {
      if (requestId) {
        await api(
          "DELETE",
          `/api/internal/computer-control?botId=${bot.id}`,
          { requestId },
          await capability(bot.id, roomId ? (await groupState(roomId)).threadId : bot.threadId, "computer"),
        ).catch(() => undefined);
      }
      await cleanup([roomId], [bot.id]);
    }
  }, 45_000);
});

describe("bot-to-bot coordination is recorded, not announced", () => {
  it("runs an ask_bot round trip with no badge and no banner anywhere", async () => {
    const asker = await createBot("Pen", "quick");
    const peer = await createBot("Ink", "quick");
    const stream = await openSse(`${base}/api/events`);
    try {
      // The peer's existing badge belongs to an earlier human conversation.
      expect((await api("PATCH", `/api/bots/${peer.id}`, { unread: true })).status).toBe(200);
      expect((await botState(peer.id))?.unread).toBe(true);
      const asked = await api(
        "POST",
        "/api/internal/ask-bot",
        { fromBotId: asker.id, toBotId: peer.id, message: "Ink, can you take the deploy?" },
        peerCapability(asker.id, asker.threadId),
      );
      expect(asked.status).toBe(200);
      expect(asked.body.botName).toBe("Ink");
      expect(asked.body.text).toContain("hello from fake claude");

      // 84841aeed replaces the mirrored DM with one runtime consultation,
      // its private work transcript and clickable requester receipts.
      const work = peerWork(asker.id, peer.id);
      expect(work).toHaveLength(1);
      expect(work[0]).toMatchObject({ mode: "consult", status: "completed", executions: 1 });
      const workThreadId = work[0]!.assignee.destination.threadId!;
      expect(workThreadId).not.toBe(peer.threadId);
      const exchange = await threadMessages(workThreadId);
      expect(exchange.filter(message => message.roomRequest?.phase === "request")).toEqual([
        expect.objectContaining({ from: expect.objectContaining({ botId: asker.id, name: "Pen" }), text: expect.stringContaining("Ink, can you take the deploy?") }),
      ]);
      expect(exchange.some(message => message.role === "bot" && message.kind === "text" && message.text?.includes("hello from fake claude"))).toBe(true);
      const source = await threadMessages(asker.threadId);
      expect(source.find(message => message.tool?.name === "Sent to Ink")).toMatchObject({ threadRef: { botId: peer.id, threadId: workThreadId } });
      const reports = source.filter(message => message.roomRequest?.id === work[0]!.id && message.roomRequest.phase === "result");
      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({ from: { botId: peer.id, name: "Ink" }, tool: { ok: true, output: expect.stringContaining("hello from fake claude") }, threadRef: { botId: peer.id, threadId: workThreadId } });

      const current = await state(40);
      expect(current.groups.some((group: { dm?: boolean; memberIds: string[] }) => group.dm === true && group.memberIds.includes(asker.id) && group.memberIds.includes(peer.id))).toBe(false);
      expect(current.bots.find((candidate: { id: string }) => candidate.id === asker.id)?.unread).toBeFalsy();
      expect(current.bots.find((candidate: { id: string }) => candidate.id === peer.id)?.unread).toBe(true);
      const workTask = current.bots.find((candidate: { id: string }) => candidate.id === peer.id)?.tasks.find((task: { threadId: string }) => task.threadId === workThreadId);
      expect(workTask).toBeTruthy();
      expect(workTask.unread).toBeFalsy();

      // This SSE barrier includes every notification raised by the exchange.
      expect((await api("PATCH", `/api/bots/${asker.id}`, { name: "Pen observed" })).status).toBe(200);
      await stream.until(candidate => candidate.kind === "bot" && candidate.bot?.id === asker.id && candidate.bot?.name === "Pen observed");
      expect(stream.frames.filter(candidate => candidate.kind === "notify")).toEqual([]);

      // A quiet report must also preserve a badge the requester already had.
      expect((await api("PATCH", `/api/bots/${asker.id}`, { unread: true })).status).toBe(200);
      expect((await botState(asker.id))?.unread).toBe(true);
      const askedAgain = await api(
        "POST",
        "/api/internal/ask-bot",
        { fromBotId: asker.id, toBotId: peer.id, message: "Ink, is the deploy ready?" },
        peerCapability(asker.id, asker.threadId),
      );
      expect(askedAgain.status).toBe(200);
      expect(askedAgain.body.botName).toBe("Ink");
      expect(askedAgain.body.text).toContain("hello from fake claude");
      const bothWork = peerWork(asker.id, peer.id);
      expect(bothWork).toHaveLength(2);
      const secondWork = bothWork.find(assignment => assignment.id !== work[0]!.id)!;
      expect(secondWork).toMatchObject({ mode: "consult", status: "completed", executions: 1, brief: "Ink, is the deploy ready?" });
      const secondWorkThreadId = secondWork.assignee.destination.threadId!;
      expect(secondWorkThreadId).not.toBe(peer.threadId);
      const secondReports = (await threadMessages(asker.threadId))
        .filter(message => message.roomRequest?.id === secondWork.id && message.roomRequest.phase === "result");
      expect(secondReports).toHaveLength(1);
      expect(secondReports[0]).toMatchObject({ from: { botId: peer.id, name: "Ink" }, tool: { ok: true, output: expect.stringContaining("hello from fake claude") }, threadRef: { botId: peer.id, threadId: secondWorkThreadId } });
      const afterSecond = await state(40);
      expect(afterSecond.bots.find((candidate: { id: string }) => candidate.id === asker.id)?.unread).toBe(true);
      expect(afterSecond.bots.find((candidate: { id: string }) => candidate.id === peer.id)?.unread).toBe(true);
      const secondWorkTask = afterSecond.bots.find((candidate: { id: string }) => candidate.id === peer.id)?.tasks.find((task: { threadId: string }) => task.threadId === secondWorkThreadId);
      expect(secondWorkTask).toBeTruthy();
      expect(secondWorkTask.unread).toBeFalsy();
      expect((await api("PATCH", `/api/bots/${asker.id}`, { name: "Pen observed twice" })).status).toBe(200);
      await stream.until(candidate => candidate.kind === "bot" && candidate.bot?.id === asker.id && candidate.bot?.name === "Pen observed twice");
      expect(stream.frames.filter(candidate => candidate.kind === "notify")).toEqual([]);
    } finally {
      stream.close();
      await cleanup([], [asker.id, peer.id]);
    }
  }, 45_000);

  // A peer now works in its own runtime work thread. The person's next
  // ordinary message must still announce itself in their standing thread.
  it("still announces the person's own next message after a hop that finished", async () => {
    const asker = await createBot("Nib", "quick");
    const peer = await createBot("Vellum", "quick");
    const stream = await openSse(`${base}/api/events`);
    try {
      const asked = await api(
        "POST",
        "/api/internal/ask-bot",
        { fromBotId: asker.id, toBotId: peer.id, message: "Vellum, is the branch green?" },
        peerCapability(asker.id, asker.threadId),
      );
      expect(asked.status).toBe(200);
      expect((await botState(peer.id))?.unread).toBeFalsy();

      // same bot, same thread, but a person is asking this time
      expect((await api("POST", `/api/bots/${peer.id}/messages`, { text: "and for me?" })).status).toBe(202);
      const frame = await stream.until(
        (candidate) =>
          candidate.kind === "notify" &&
          candidate.notification?.kind === "done" &&
          candidate.notification?.botId === peer.id,
        20_000,
      );
      expect(frame.notification.threadId).toBe(peer.threadId);
      await expect.poll(async () => (await botState(peer.id))?.unread, { timeout: 20_000 }).toBe(true);
    } finally {
      stream.close();
      await cleanup([], [asker.id, peer.id]);
    }
  }, 45_000);

  it("still announces the person's own next message after a hop that never started", async () => {
    const asker = await createBot("Quire", "quick");
    const peer = await createBot("Folio", "quick");
    const stream = await openSse(`${base}/api/events`);
    try {
      // Park the peer on an engine that is not there. Since #819 a teammate
      // that cannot run is refused before any work is sent (engineEligibility),
      // so the hop never even reaches startTurn: nothing marks the peer's own
      // thread, and nothing the fold would have to release is left behind.
      expect((await api("PATCH", `/api/bots/${peer.id}`, {
        modelSelection: { instanceId: "ghost", model: "ghost-1" },
      })).status).toBe(200);
      const asked = await api(
        "POST",
        "/api/internal/ask-bot",
        { fromBotId: asker.id, toBotId: peer.id, message: "Folio, still there?" },
        peerCapability(asker.id, asker.threadId),
      );
      expect(asked.status).toBe(409);
      expect(asked.body.error).toContain("Folio");

      expect((await api("PATCH", `/api/bots/${peer.id}`, {
        modelSelection: { instanceId: "quick", model: "claude-sonnet-5" },
      })).status).toBe(200);
      expect((await api("POST", `/api/bots/${peer.id}/messages`, { text: "back? tell me when" })).status).toBe(202);
      const frame = await stream.until(
        (candidate) =>
          candidate.kind === "notify" &&
          candidate.notification?.kind === "done" &&
          candidate.notification?.botId === peer.id,
        20_000,
      );
      expect(frame.notification.threadId).toBe(peer.threadId);
      await expect.poll(async () => (await botState(peer.id))?.unread, { timeout: 20_000 }).toBe(true);
    } finally {
      stream.close();
      await cleanup([], [asker.id, peer.id]);
    }
  }, 45_000);

  it("buzzes when a bot stops to ask whether it may contact a teammate", async () => {
    const asker = await createBot("Nib", "quick");
    const peer = await createBot("Dot", "quick");
    // the one gate a person switches on for a bot's peer comms — the card it
    // raises is the one bot-to-bot event that genuinely blocks on them
    expect((await api("PATCH", `/api/bots/${asker.id}`, { approvePeerComms: true })).status).toBe(200);
    const stream = await openSse(`${base}/api/events`);
    const asking = api(
      "POST",
      "/api/internal/ask-bot",
      { fromBotId: asker.id, toBotId: peer.id, message: "Dot, can you take the deploy?" },
      peerCapability(asker.id, asker.threadId),
    );
    try {
      const frame = await stream.until(
        (candidate) => candidate.kind === "notify" && candidate.notification?.botId === asker.id,
        20_000,
      );
      expect(frame.notification).toMatchObject({
        kind: "approval",
        botId: asker.id,
        threadId: asker.threadId,
        title: "Nib needs approval",
      });
      expect(frame.notification.body).toContain("wants to contact @Dot");
      // the card is really open where the banner points
      const card = (await botState(asker.id))?.messages.findLast(
        (message: { kind: string; card?: { requestId?: string; tool?: string } }) => message.kind === "options" && Boolean(message.card?.requestId),
      );
      expect(card?.card?.tool).toBe("ask_bot");
      const denied = await api("POST", `/api/bots/${asker.id}/respond`, { requestId: card.card.requestId, behavior: "deny" });
      expect(denied.status).toBe(200);
      const queued = await asking;
      expect(queued.status).toBe(200);
      expect(queued.body).toMatchObject({ busy: true, taskId: expect.any(String) });
      await expect.poll(async () => (await api("GET", `/api/internal/delegations/${queued.body.taskId}`, undefined, { authorization: `Bearer ${runtimes[asker.id]!.token}` })).body,
        { timeout: 20_000 }).toMatchObject({ status: "failed", toBotName: "Dot", result: "Denied by user; no work sent." });
      expect(peerWork(asker.id, peer.id)).toEqual([expect.objectContaining({ status: "failed", executions: 0 })]);
    } finally {
      stream.close();
      await asking.catch(() => undefined);
      await cleanup([], [asker.id, peer.id]);
    }
  }, 45_000);

  it("still buzzes when a peer's turn stops to ask the person a question", async () => {
    const asker = await createBot("Quill", "quick");
    const peer = await createBot("Sage", "curious", "fake-model");
    let peerThreadId: string | undefined;
    const stream = await openSse(`${base}/api/events`);
    // the peer's turn parks on its card, so the ask cannot be awaited yet
    const asking = api(
      "POST",
      "/api/internal/ask-bot",
      { fromBotId: asker.id, toBotId: peer.id, message: "Sage, which colour?" },
      peerCapability(asker.id, asker.threadId),
    );
    try {
      const frame = await stream.until(
        (candidate) => candidate.kind === "notify" && candidate.notification?.botId === peer.id,
        20_000,
      );
      const work = peerWork(asker.id, peer.id);
      expect(work).toHaveLength(1);
      expect(work[0]).toMatchObject({ mode: "consult", status: "running", executions: 1 });
      peerThreadId = work[0]!.assignee.destination.threadId;
      // silencing the peer's completion must never silence the peer asking a
      // person for something only a person can give
      expect(frame.notification).toMatchObject({
        kind: "question",
        botId: peer.id,
        threadId: peerThreadId,
        title: "Sage has a question",
      });
      // the card is really open in the peer's thread — the banner is not
      // announcing something the person cannot act on (a new bot's onboarding
      // card sits above it, so take the turn's own)
      expect(peerThreadId).not.toBe(peer.threadId);
      const card = (await threadMessages(peerThreadId!)).findLast(
        (message: { kind: string; card?: { title?: string } }) => message.kind === "options" && Boolean(message.card),
      );
      expect(card?.card).toMatchObject({ title: "Your bot has a question", subtitle: "Which color?" });

    } finally {
      stream.close();
      await api("POST", `/api/bots/${peer.id}/interrupt`, peerThreadId ? { threadId: peerThreadId } : {}).catch(() => undefined);
      await asking.catch(() => undefined);
      await cleanup([], [asker.id, peer.id]);
    }
  }, 45_000);
});

const approvalNotice = async (stream: Awaited<ReturnType<typeof openSse>>, botId: string) => {
  try {
    return await stream.until(candidate => candidate.kind === "notify" && candidate.notification?.botId === botId && candidate.notification?.kind === "approval" && Boolean(candidate.notification?.requestId), 30_000);
  } catch (error) {
    const state = await api("GET", "/api/bots");
    const decisions = (await api("GET", "/api/decisions")).body.decisions;
    throw new Error(`${error instanceof Error ? error.message : error}\nBot: ${JSON.stringify(state.body.bots.find((bot: any) => bot.id === botId))}\nDecisions: ${JSON.stringify(decisions)}\nServer: ${stderr.slice(-3000)}`);
  }
};

describe("an approval in an AI client's conversation", () => {
  const openCard = (bot: any) => bot?.messages?.findLast?.(
    (message: { kind: string; card?: { requestId?: string } }) => message.kind === "options" && Boolean(message.card?.requestId),
  )?.card;
  /** The engine asks before running a command and the person wants to see
   * it: a new bot starts on Approve for me, so these bots go to Ask. */
  const askingBot = async (name: string) => {
    const bot = await createBot(name, "asking", "grok-4.6");
    expect((await api("PATCH", `/api/bots/${bot.id}`, { approvalMode: "ask" })).status).toBe(200);
    expect((await api("PATCH", `/api/bots/${bot.id}/tasks/${bot.threadId}`, { approvalMode: "ask" })).status).toBe(200);
    return bot;
  };
  const threadMessages = async (threadId: string) =>
    (await api("GET", `/api/threads/${threadId}/messages?limit=40`)).body;

  // An AI client's lines land in the bot's one chat since #1207 (#1170): no
  // hidden conversation is made any more, so its approval is the person's own
  // card in front of them. It reaches them in plain words and then waits for
  // their answer; nothing declines it on a timer (that belonged to the hidden
  // conversation, SAGAX_HIDDEN_APPROVAL_TTL_MS, which no thread can be in now).
  it("reaches the person in plain words, and waits for their answer", async () => {
    const bot = await askingBot("Warden");
    const threadId = bot.threadId;
    const stream = await openSse(`${base}/api/events`);
    try {
      expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "run it", threadId })).status).toBe(202);
      const frame = await approvalNotice(stream, bot.id);
      // the same words as the card: who, and what it would allow
      expect(frame.notification.threadId).toBe(threadId);
      expect(frame.notification.title).toMatch(/^Allow Warden to .+\?$/);
      expect(frame.notification.body).toBeTruthy();
      expect(`${frame.notification.title} ${frame.notification.body}`).not.toMatch(/__|mcp__|\{"/);
      expect(frame.notification.requestId).toBeTruthy();
      const requestId = frame.notification.requestId;
      // nobody answers, well past the old four-second expiry of this fixture:
      // the card stays open, the engine is not told no, nothing is logged as expired
      await new Promise((resolve) => setTimeout(resolve, 6_000));
      const messages = await threadMessages(threadId);
      const list = Array.isArray(messages) ? messages : messages?.messages ?? [];
      const card = list.find((message: { card?: { requestId?: string } }) => message.card?.requestId === requestId)?.card;
      expect(card).toBeTruthy();
      expect(card.expired).toBeFalsy();
      expect(card.plain?.title).toBeTruthy();
      // 0be6878de: the default is seven days, not the retired four-second timer.
      expect(card.expiresAt).toBeGreaterThan(Date.now() + 6 * 86_400_000);
      expect(card.expiresAt).toBeLessThanOrEqual(Date.now() + 7 * 86_400_000);
      const decisions = (await api("GET", "/api/decisions")).body.decisions as Array<{ requestId?: string; source: string }>;
      expect(decisions.some((row) => row.requestId === requestId && row.source === "expired")).toBe(false);
      // the person's own answer still settles it
      expect((await api("POST", `/api/bots/${bot.id}/respond`, { requestId, behavior: "deny" })).status).toBe(200);
    } finally {
      stream.close();
      await cleanup([], [bot.id]);
    }
  }, 45_000);

  it("is withdrawn on every client once it is answered anywhere", async () => {
    const bot = await askingBot("Keeper");
    const stream = await openSse(`${base}/api/events`);
    try {
      // the person's own chat: approvals there buzz too, with the plain title
      expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "run it" })).status).toBe(202);
      const frame = await approvalNotice(stream, bot.id);
      expect(frame.notification.title).toMatch(/^Allow Keeper to .+\?$/);
      const requestId = frame.notification.requestId;
      expect(requestId).toBeTruthy();
      const answered = await api("POST", `/api/bots/${bot.id}/respond`, { requestId, behavior: "deny" });
      expect(answered.status).toBe(200);
      const withdrawn = await stream.until(
        (candidate) => candidate.kind === "notify-withdraw" && candidate.requestId === requestId,
        20_000,
      );
      expect(withdrawn.threadId).toBe(bot.threadId);
      // answered, not expired: a person's decline is not a timeout
      const card = openCard(await botState(bot.id));
      expect(card?.expired).toBeFalsy();
      expect(card?.expiresAt).toBeGreaterThan(Date.now() + 6 * 86_400_000);
      expect(card?.expiresAt).toBeLessThanOrEqual(Date.now() + 7 * 86_400_000);
    } finally {
      stream.close();
      await cleanup([], [bot.id]);
    }
  }, 45_000);
});

describe("an approval during a routine run (#1743)", () => {
  // A bot routine runs in a hidden execution thread and reports into the
  // person's visible conversation (resultsThreadId). The banner must name
  // the execution thread: iPhone/Watch Allow posts to that threadId, and
  // notify-withdraw must match the same key. Naming the results thread
  // made Allow land as unavailable and left the banner up.
  it("names the execution card thread so Allow and withdraw hit the card", async () => {
    const bot = await createBot("Routine Asker", "asking", "fake-model");
    expect((await api("PATCH", `/api/bots/${bot.id}`, { approvalMode: "ask" })).status).toBe(200);
    expect((await api("PATCH", `/api/bots/${bot.id}/tasks/${bot.threadId}`, { approvalMode: "ask" })).status).toBe(200);
    const created = await api("POST", "/api/routines", {
      name: "Needs a yes",
      prompt: "Run the gated step",
      botId: bot.id,
      runOn: "maus",
      schedule: { type: "once", at: Date.now() + 60_000 },
    });
    expect(created.status).toBe(201);
    const routineId = created.body.routine.id as string;
    let runId: string | undefined;
    const stream = await openSse(`${base}/api/events`);
    try {
      const launched = await api("POST", `/api/routines/${routineId}/run`);
      expect(launched.status).toBe(201);
      runId = launched.body.run.id as string;
      // The launch response may land before the execution task is claimed.
      await expect.poll(async () => {
        const receipt = (await api("GET", "/api/routines")).body.runs.find((candidate: { id: string }) => candidate.id === runId);
        return Boolean(receipt?.threadId && receipt?.resultsThreadId && receipt.threadId !== receipt.resultsThreadId);
      }, { timeout: 20_000 }).toBe(true);
      const run = (await api("GET", "/api/routines")).body.runs.find((candidate: { id: string }) => candidate.id === runId) as {
        id: string; threadId: string; resultsThreadId: string;
      };

      const frame = await approvalNotice(stream, bot.id);
      expect(frame.notification.threadId).toBe(run.threadId);
      expect(frame.notification.threadId).not.toBe(run.resultsThreadId);
      const requestId = frame.notification.requestId as string;
      expect(requestId).toBeTruthy();

      // The phone posts to notification.threadId (execution), not the report.
      const answered = await api("POST", `/api/threads/${run.threadId}/respond`, {
        requestId,
        behavior: "allow",
      });
      expect(answered.status).toBe(200);
      expect(answered.body.outcome).not.toBe("unavailable");

      const withdrawn = await stream.until(
        (candidate) => candidate.kind === "notify-withdraw" && candidate.requestId === requestId,
        20_000,
      );
      expect(withdrawn.threadId).toBe(run.threadId);

      const report = await api("GET", `/api/threads/${run.resultsThreadId}/messages?limit=40`);
      expect(report.status).toBe(200);
      const list = Array.isArray(report.body) ? report.body : report.body?.messages ?? [];
      expect(
        list.some((message: { tool?: { name?: string } }) =>
          typeof message.tool?.name === "string" && message.tool.name.includes("Couldn't deliver"),
        ),
      ).toBe(false);
    } finally {
      stream.close();
      if (runId) await api("POST", `/api/routine-runs/${runId}/cancel`, {}).catch(() => undefined);
      await api("DELETE", `/api/routines/${routineId}`).catch(() => undefined);
      await cleanup([], [bot.id]);
    }
  }, 60_000);
});
