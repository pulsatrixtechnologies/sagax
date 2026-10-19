import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { readHandoffs } from "./testing/handoff-rows.ts";
import { freePortBlock } from "./testing/ports.ts";
import { openSse } from "./testing/sse.ts";

// Where a signal lands, end to end. Two bugs live here, and both are about a
// notification pointing at a conversation that did not change:
//
//   • a room reply also lit the speaking bot's own 1:1 badge — the sidebar
//     dot, the section count, the dock badge and the phone's Updates row all
//     opened a transcript where nothing had happened;
//   • bot-to-bot coordination raised badges and OS banners for the hop
//     behind one answer. A consultation (coordinate_bots with consult) is
//     an assignment on the job runtime
//     (docs/runtime-contract.md §9): it runs in a work thread the asker's
//     conversation has with the peer, never in the thread the person types
//     into, and its answer resumes the asker.
//
// What must still break through is the other half: a card that reached a
// human, and a bot asking for hands — which now deep-links to the room it is
// stuck in. The unit halves of these rules live in notify.test.ts and
// runtime-coordinator.test.ts; this file pins the wiring around them.
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
        environment: { FAKE_CLAUDE_MODE: "happy", FAKE_CLAUDE_DUMP: dumpFile },
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
      // asks before running a command: the approval an AI client's hidden
      // conversation must still bring to the person
      asking: {
        driver: "grokAgent",
        displayName: "Asking fixture",
        environment: { FAKE_ACP_MODE: "permission" },
        config: { cli: FAKE_ACP },
      },
      curious: {
        driver: "grokAgent",
        displayName: "Curious fixture",
        environment: { FAKE_ACP_MODE: "question" },
        config: { cli: FAKE_ACP, fullAuto: true },
      },
      // asks the first teammate list_bots shows a question through the real
      // injected agents proxy (coordinate_bots with consult: true) and ends
      // its turn; the answer resumes it, and that turn says it saw the result
      asker: {
        driver: "grokAgent",
        displayName: "Asker fixture",
        environment: { FAKE_ACP_MODE: "ask-peer" },
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
      SAGAX_PORT: String(port),
      SAGAX_WEBHOOK_PORT: String(port + 1),
      // a hidden conversation's approval expires; seconds here, not minutes
      SAGAX_HIDDEN_APPROVAL_TTL_MS: "4000",
      SAGAX_TEST_INTERNAL_CAPABILITY_KEY: TEST_CAPABILITY_KEY,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr!.on("data", (chunk) => (stderr += chunk));

  const deadline = Date.now() + 20_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}: ${stderr}`);
    try {
      if ((await fetch(`${base}/api/health`)).status === 200) break;
    } catch {
      // still starting
    }
    if (Date.now() >= deadline) throw new Error(`server never became healthy: ${stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

}, 45_000);

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

  it("sends a sign-in request raised mid-room to the room, not to the bot's DM", async () => {
    const bot = await createBot("Handsy", "stuck");
    let roomId: string | undefined;
    try {
      // a sign-in needs a place to sign in on: this bot works in its built-in browser
      expect((await api("PATCH", "/api/config", { features: { browser: true } })).status).toBe(200);
      const placed = await api("PATCH", `/api/bots/${bot.id}`, { computer: "browser" });
      expect(placed.status, JSON.stringify(placed.body)).toBe(200);
      const room = (await api("POST", "/api/groups", {
        name: "War Room",
        memberIds: [bot.id],
        setup: { bulletin: "", defaultResponder: { kind: "everyone" } },
      })).body.group;
      roomId = room.id;
      expect((await api("POST", `/api/groups/${room.id}/messages`, { text: "take the wheel" })).status).toBe(202);
      // the room must actually own the bot before it asks the person to sign in
      await expect.poll(async () => (await groupState(room.id))?.busyBotId, { timeout: 20_000 }).toBe(bot.id);

      const stream = await openSse(`${base}/api/events`);
      try {
        const asked = await api(
          "POST",
          "/api/internal/request-sign-in",
          { site: "example.com", reason: "the login page wants a code" },
          await capability(bot.id, room.threadId),
        );
        expect(asked.status).toBe(201);

        const frame = await stream.until(
          (candidate) => candidate.kind === "notify" && candidate.notification?.kind === "sign-in",
          15_000,
        );
        expect(frame.notification).toMatchObject({
          botId: bot.id,
          threadId: room.threadId,
          groupId: room.id,
          title: "Handsy in War Room needs you to sign in to example.com",
          body: "the login page wants a code",
        });
        // the DM is exactly where the person must NOT be sent: the page that
        // needs signing in belongs to the room's turn
        expect(frame.notification.threadId).not.toBe(bot.threadId);
      } finally {
        stream.close();
      }
    } finally {
      await api("PATCH", "/api/config", { features: { browser: false } }).catch(() => undefined);
      await cleanup([roomId], [bot.id]);
    }
  }, 45_000);
});

describe("bot-to-bot coordination is recorded, not announced", () => {
  /** The runtime's assignment rows (DATA_DIR/runtime.db), as the server reads them. */
  const handoffs = () => readHandoffs(join(home, ".sagax"));
  /** The consultation `requestId` names, once the runtime has written it. */
  const consultation = async (requestId: string) => {
    await expect.poll(() => handoffs().some((node) => node.id === requestId), { timeout: 15_000 }).toBe(true);
    return handoffs().find((node) => node.id === requestId)!;
  };

  it("runs a consultation round trip with no badge or banner for the peer, and resumes the asker once", async () => {
    const peer = await createBot("Ink", "quick");
    const asker = await createBot("Pen", "asker");
    const stream = await openSse(`${base}/api/events`);
    try {
      // The asker's list_bots names Ink alone, so its scripted question reaches Ink.
      expect((await api("PATCH", `/api/bots/${asker.id}`, { peers: [peer.id] })).status).toBe(200);
      // Ink already answered the person earlier and they have not looked yet:
      // this badge is the one a hop could spend by mistake — seeded true, or
      // the "no badge" checks below would pass for a hop that had just
      // cleared it.
      expect((await api("PATCH", `/api/bots/${peer.id}`, { unread: true })).status).toBe(200);
      expect((await botState(peer.id))?.unread).toBe(true);
      const peerConversation = (await botState(peer.id)).messages;

      // The person asks Pen; Pen's turn consults Ink and ends; Ink's answer
      // resumes Pen, whose resume turn says so.
      expect((await api("POST", `/api/bots/${asker.id}/messages`, { text: "Pen, ask Ink whether it can take the deploy." })).status).toBe(202);
      await expect.poll(async () => ((await botState(asker.id))?.messages ?? []).some(
        (message: { text?: string }) => message.text === "woke after delegation: saw the result",
      ), { timeout: 40_000 }).toBe(true);
      await expect.poll(() => handoffs().map((node) => node.status), { timeout: 20_000 }).toEqual(["completed", "completed"]);
      const consult = handoffs().find((node) => node.parentId)!;
      expect(consult).toMatchObject({ botId: peer.id, mode: "consult", reply: "resume", result: expect.stringContaining("hello from fake claude") });

      const current = await state(40);
      const ink = current.bots.find((candidate: { id: string }) => candidate.id === peer.id);
      // Ink answered in a work thread of Pen's conversation, opened as Pen's
      // work — never in the thread the person types into, which is untouched...
      expect(consult.threadId).not.toBe(peer.threadId);
      expect(ink.tasks.find((task: { threadId: string }) => task.threadId === consult.threadId)?.openedBy)
        .toMatchObject({ botId: asker.id, kind: "work" });
      expect(ink.messages).toEqual(peerConversation);
      // ...and no bot-to-bot channel is born of the exchange any more.
      expect(current.groups.find((group: { dm?: boolean }) => group.dm === true)).toBeUndefined();
      // The record is whole where the asker reads it: the answer rides the
      // reply chip into Pen's conversation, with a link to the work thread.
      const pen = current.bots.find((candidate: { id: string }) => candidate.id === asker.id);
      const replied = pen.messages.find(
        (message: { kind: string; tool?: { name?: string } }) => message.kind === "activity" && message.tool?.name === "Ink replied",
      );
      expect(replied?.tool?.output).toContain("hello from fake claude");
      expect(replied?.threadRef).toMatchObject({ botId: peer.id, threadId: consult.threadId });
      // Nothing about the hop is worth interrupting anyone for: the badge
      // Ink already earned is neither spent by it nor re-raised by it —
      // still exactly the one signal the person had.
      expect(ink.unread).toBe(true);

      // A unique bot patch is an SSE ordering barrier: by the time it is
      // observed, every notification this exchange raised is already in
      // `frames` — including one the fold should never have sent.
      expect((await api("PATCH", `/api/bots/${asker.id}`, { name: "Pen observed" })).status).toBe(200);
      await stream.until(
        (candidate) => candidate.kind === "bot" && candidate.bot?.id === asker.id && candidate.bot?.name === "Pen observed",
      );
      const notified = stream.frames.filter((candidate) => candidate.kind === "notify").map((candidate) => candidate.notification);
      // No notification names the peer or its threads...
      expect(notified.filter((notification) => notification?.botId === peer.id), JSON.stringify(notified)).toEqual([]);
      // ...and everything the person hears is about the conversation they
      // asked in: Pen's own turn ending (as any turn the person asked for),
      // then one settle notification when Ink's answer resumes Pen — the
      // resume turn itself ends quietly. Two banners where the inline ask
      // raised one (scratchpad/pr3-bugs.md, notification-routing); the hop
      // itself raises none.
      expect(notified.every((notification) => notification?.botId === asker.id && notification?.threadId === asker.threadId), JSON.stringify(notified)).toBe(true);
      expect(notified.map((notification) => notification?.kind), JSON.stringify(notified)).toEqual(["done", "delegation-settled"]);
      expect(notified[1]).toMatchObject({ title: "Pen resumed with results", body: "Results in from Ink" });
    } finally {
      stream.close();
      await cleanup([], [asker.id, peer.id]);
    }
  }, 60_000);

  // A consultation runs in a work thread the asker's conversation has with
  // the peer, never on the peer's own 1:1 thread — the very thread the person
  // types into. Whatever a hop did, that thread's next person line is news.
  it("still announces the person's own next message after a hop that finished", async () => {
    const asker = await createBot("Nib", "quick");
    const peer = await createBot("Vellum", "quick");
    const stream = await openSse(`${base}/api/events`);
    try {
      const asked = await api(
        "POST",
        "/api/internal/coordinate-bots",
        { botIds: [peer.id], message: "Vellum, is the branch green?", consult: true },
        await capability(asker.id, asker.threadId),
      );
      expect(asked.status, JSON.stringify(asked.body)).toBe(200);
      expect(asked.body.receipts[0]).toMatchObject({ botId: peer.id, outcome: "queued" });
      const consult = await consultation(asked.body.receipts[0].requestId);
      expect(consult.threadId).not.toBe(peer.threadId);
      await expect.poll(() => handoffs().find((node) => node.id === consult.id)?.status, { timeout: 20_000 }).toBe("completed");
      expect((await botState(peer.id))?.unread).toBeFalsy();

      // same bot, its own thread, and a person is asking this time
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
      // Park the peer on an engine that is not there: the consultation is
      // accepted into the runtime, and its turn cannot start.
      expect((await api("PATCH", `/api/bots/${peer.id}`, {
        modelSelection: { instanceId: "ghost", model: "ghost-1" },
      })).status).toBe(200);
      const asked = await api(
        "POST",
        "/api/internal/coordinate-bots",
        { botIds: [peer.id], message: "Folio, still there?", consult: true },
        await capability(asker.id, asker.threadId),
      );
      expect(asked.status, JSON.stringify(asked.body)).toBe(200);
      expect(asked.body.receipts[0]).toMatchObject({ botId: peer.id, outcome: "queued" });
      const consult = await consultation(asked.body.receipts[0].requestId);
      expect(consult.threadId).not.toBe(peer.threadId);
      expect((await botState(peer.id))?.unread).toBeFalsy();

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
      "/api/internal/coordinate-bots",
      { botIds: [peer.id], message: "Dot, can you take the deploy?", consult: true },
      await capability(asker.id, asker.threadId),
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
      const refused = await asking;
      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject({
        error: "Denied by user; no work sent.",
        approvals: [{ botId: peer.id, error: "denied by user", approvalOutcome: "deny", approvalSource: "user" }],
      });
      expect(handoffs().filter((node) => node.botId === peer.id)).toEqual([]);
    } finally {
      stream.close();
      await asking.catch(() => undefined);
      await cleanup([], [asker.id, peer.id]);
    }
  }, 45_000);

  it("still buzzes when a peer's turn stops to ask the person a question", async () => {
    const asker = await createBot("Quill", "quick");
    const peer = await createBot("Sage", "curious", "fake-model");
    const stream = await openSse(`${base}/api/events`);
    try {
      // The ask answers at once; the peer's consultation turn then parks on
      // its card in the work thread the consultation opened.
      const asked = await api(
        "POST",
        "/api/internal/coordinate-bots",
        { botIds: [peer.id], message: "Sage, which colour?", consult: true },
        await capability(asker.id, asker.threadId),
      );
      expect(asked.status, JSON.stringify(asked.body)).toBe(200);
      const workThread = asked.body.receipts[0].threadId as string;
      expect(workThread).not.toBe(peer.threadId);
      const frame = await stream.until(
        (candidate) => candidate.kind === "notify" && candidate.notification?.botId === peer.id,
        20_000,
      );
      // silencing the peer's completion must never silence the peer asking a
      // person for something only a person can give — and the banner points
      // at the thread the question is really open in
      expect(frame.notification).toMatchObject({
        kind: "question",
        botId: peer.id,
        threadId: workThread,
        title: "Sage has a question",
      });
      // the card is really open there (a new bot's onboarding card sits above
      // it, so take the turn's own), and the peer's own 1:1 thread has none
      const card = ((await api("GET", `/api/threads/${workThread}/messages`)).body.messages as any[]).findLast(
        (message: { kind: string; card?: { title?: string } }) => message.kind === "options" && Boolean(message.card),
      );
      expect(card?.card).toMatchObject({ title: "Your bot has a question", subtitle: "Which color?" });
      expect(((await botState(peer.id))?.messages ?? []).some(
        (message: { kind: string; card?: { subtitle?: string } }) => message.kind === "options" && message.card?.subtitle === "Which color?",
      )).toBe(false);
    } finally {
      stream.close();
      await api("POST", `/api/bots/${peer.id}/interrupt`, {}).catch(() => undefined);
      await cleanup([], [asker.id, peer.id]);
    }
  }, 45_000);
});

describe("an approval in an AI client's hidden conversation", () => {
  const openCard = (bot: any) => bot?.messages?.findLast?.(
    (message: { kind: string; card?: { requestId?: string } }) => message.kind === "options" && Boolean(message.card?.requestId),
  )?.card;
  const hiddenThread = async (botId: string) => {
    const created = await api("POST", `/api/bots/${botId}/tasks`, { hidden: true, approvalMode: "ask", title: "AI client" });
    expect(created.status).toBe(201);
    expect(created.body.task.hidden).toBe(true);
    return created.body.task.threadId as string;
  };
  const threadMessages = async (threadId: string) =>
    (await api("GET", `/api/threads/${threadId}/messages?limit=40`)).body;

  it("reaches the person in plain words, and is declined when nobody answers", async () => {
    const bot = await createBot("Warden", "asking", "grok-4.6");
    const threadId = await hiddenThread(bot.id);
    const stream = await openSse(`${base}/api/events`);
    try {
      expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "run it", threadId })).status).toBe(202);
      const frame = await stream.until(
        (candidate) => candidate.kind === "notify" && candidate.notification?.botId === bot.id && candidate.notification?.kind === "approval",
        20_000,
      );
      // the same words as the card: who, and what it would allow
      expect(frame.notification.threadId).toBe(threadId);
      expect(frame.notification.title).toMatch(/^Allow Warden to .+\?$/);
      expect(frame.notification.body).toBeTruthy();
      expect(`${frame.notification.title} ${frame.notification.body}`).not.toMatch(/__|mcp__|\{"/);
      expect(frame.notification.requestId).toBeTruthy();
      const requestId = frame.notification.requestId;
      // nobody answers: the server declines it, takes the banner down, logs why
      const withdrawn = await stream.until(
        (candidate) => candidate.kind === "notify-withdraw" && candidate.requestId === requestId,
        20_000,
      );
      expect(withdrawn.threadId).toBe(threadId);
      await expect.poll(async () => {
        const decisions = (await api("GET", "/api/decisions")).body.decisions as Array<{ requestId?: string; decision: string; source: string }>;
        return decisions.find((row) => row.requestId === requestId && row.source === "expired")?.decision;
      }, { timeout: 10_000 }).toBe("auto-denied");
      await expect.poll(async () => {
        const messages = await threadMessages(threadId);
        const list = Array.isArray(messages) ? messages : messages?.messages ?? [];
        const card = list.find((message: { card?: { requestId?: string } }) => message.card?.requestId === requestId)?.card;
        return card ? { expired: card.expired, plain: Boolean(card.plain?.title), expiresAt: typeof card.expiresAt } : null;
      }, { timeout: 10_000 }).toEqual({ expired: true, plain: true, expiresAt: "number" });
    } finally {
      stream.close();
      await cleanup([], [bot.id]);
    }
  }, 45_000);

  it("is withdrawn on every client once it is answered anywhere", async () => {
    const bot = await createBot("Keeper", "asking", "grok-4.6");
    const stream = await openSse(`${base}/api/events`);
    try {
      // the person's own chat: approvals there buzz too, with the plain title
      expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "run it" })).status).toBe(202);
      const frame = await stream.until(
        (candidate) => candidate.kind === "notify" && candidate.notification?.botId === bot.id && candidate.notification?.kind === "approval",
        20_000,
      );
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
      expect(card?.expiresAt).toBeUndefined();
    } finally {
      stream.close();
      await cleanup([], [bot.id]);
    }
  }, 45_000);
});
