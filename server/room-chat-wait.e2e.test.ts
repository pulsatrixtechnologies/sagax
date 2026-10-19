import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";

// An ordinary room round never skips a member who is busy in another
// conversation: the round parks on them with one neutral note and they take
// their turn when they free — whether they were a direct responder or a
// teammate summoned by a chained @mention. The member's own 1:1 turn is
// never touched by the wait. The bounded end of the wait (the cap) lives in
// the short-cap server of group-goal-wait-cap.e2e.test.ts. (The bot⇄bot
// channels ask_bot used to open are no longer created — a consultation is an
// assignment on the job runtime — so the wait in one is no longer driven
// here; an existing channel is a room like any other to this rule.)

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SERVER_DIR, "..");
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");

const WAIT_CHIP = (name: string) => `${name} is finishing another conversation — will reply here when free`;

let child: ChildProcess;
let home = "";
let base = "";
let stderr = "";
let patientFinishGate = "";

type StateMessage = {
  id: string;
  kind: string;
  role?: string;
  text?: string;
  from?: { botId?: string; name?: string };
  tool?: { name?: string; ok?: boolean; spoken?: string };
};

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
  return { status: response.status, body: await response.json() };
};

const fixture = (displayName: string, environment: Record<string, string>) => ({
  driver: "claudeAgent",
  displayName,
  environment,
  config: { cli: FAKE_CLAUDE },
});

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "omb-room-chat-wait-"));
  const data = join(home, ".sagax");
  const staticDir = join(home, "static");
  mkdirSync(data, { recursive: true });
  mkdirSync(join(staticDir, "assets"), { recursive: true });
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>Room chat wait test</title>");
  writeFileSync(join(staticDir, "assets", "smoke.css"), "body{}");
  patientFinishGate = join(home, "patient-finish");
  writeFileSync(patientFinishGate, "initial turns may finish");
  writeFileSync(join(data, "config.json"), JSON.stringify({
    instances: {
      // A gate keeps a direct turn busy until the test observes the room's
      // wait, rather than racing the fake CLI's 800ms closing reply. The
      // closing reply echoes the prompt, so a room reply carries the room's
      // own @mentions back out
      patient: fixture("Patient fixture", { FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_SLOW_FINISH_GATE: patientFinishGate }),
      quick: fixture("Quick fixture", { FAKE_CLAUDE_MODE: "happy" }),
      summoner: fixture("Summoning fixture", {
        FAKE_CLAUDE_MODE: "happy",
        FAKE_CLAUDE_REPLIES: JSON.stringify(["Let me pull in @Bee for this."]),
        FAKE_CLAUDE_REPLY_STATE: join(home, "summoner-replies.txt"),
      }),
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
      SAGAX_STATIC_DIR: staticDir,
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
      // Still starting.
    }
    if (Date.now() >= deadline) throw new Error(`server never became healthy: ${stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}, 30_000);

afterAll(async () => {
  if (child) await waitForExit(child, { signal: "SIGTERM" });
  if (home) await removeTempDir(home);
});

const createBot = async (name: string, instanceId: string) =>
  (await api("POST", "/api/bots", {
    name,
    modelSelection: { instanceId, model: "claude-sonnet-5" },
    requireAvailableModel: true,
  })).body.bot;

const snapshot = async (groupId: string) => {
  const state = (await api("GET", "/api/bots?messages=40")).body;
  const room = state.groups.find((group: { id: string }) => group.id === groupId);
  const messages: StateMessage[] = room?.messages ?? [];
  return { state, room, messages };
};

const botBusy = async (botId: string) => {
  const state = (await api("GET", "/api/bots?messages=0")).body;
  return state.bots.find((bot: { id: string }) => bot.id === botId)?.busy;
};

const holdBusy = async (botId: string, text: string) => {
  // This exact file is owned by this disposable fixture. All patient turns
  // from the preceding case have settled or been interrupted by cleanup.
  rmSync(patientFinishGate, { force: true });
  expect((await api("POST", `/api/bots/${botId}/messages`, { text })).status).toBe(202);
  await expect.poll(() => botBusy(botId)).toBe(true);
};

const roundSummary = (messages: StateMessage[], waitedBotId: string) => {
  const waitChip = messages.find((message) =>
    message.kind === "activity" && message.from?.botId === waitedBotId && /another conversation/i.test(message.tool?.name ?? "")
  );
  return {
    waitChip: waitChip?.tool?.name,
    waitChipOk: waitChip?.tool?.ok,
    waitChips: messages.filter((message) =>
      message.kind === "activity" && message.from?.botId === waitedBotId && /another conversation/i.test(message.tool?.name ?? "")
    ).length,
    skipped: messages.some((message) => /skipped this round/i.test(message.tool?.name ?? "")),
    // who spoke, in order; the slow fixture splits one turn into two text
    // items, so consecutive repeats collapse to the speaker
    speakers: messages
      .filter((message) => message.kind === "text" && message.role === "bot")
      .map((message) => message.from?.name)
      .filter((name, index, names) => index === 0 || name !== names[index - 1]),
  };
};

const directReply = async (botId: string, needle: string) => {
  const state = (await api("GET", "/api/bots?messages=20")).body;
  const messages: StateMessage[] = state.bots.find((bot: { id: string }) => bot.id === botId)?.messages ?? [];
  return messages.some((message) => message.kind === "text" && message.role === "bot" && (message.text ?? "").includes(needle));
};

const cleanup = async (roomId: string | undefined, botIds: string[]) => {
  if (roomId) await api("POST", `/api/groups/${roomId}/interrupt`, {}).catch(() => undefined);
  for (const botId of botIds) await api("POST", `/api/bots/${botId}/interrupt`, {}).catch(() => undefined);
  if (roomId) await api("DELETE", `/api/groups/${roomId}`).catch(() => undefined);
  for (const botId of botIds) await api("DELETE", `/api/bots/${botId}`).catch(() => undefined);
  writeFileSync(patientFinishGate, "cleanup complete");
};

const releaseAfterRoomWait = async (roomId: string, botId: string, name: string) => {
  await expect.poll(async () => {
    const { state, room, messages } = await snapshot(roomId);
    const { speakers: _speakers, ...wait } = roundSummary(messages, botId);
    return { working: room?.working, busy: state.bots.find((bot: { id: string }) => bot.id === botId)?.busy, ...wait };
  }, { timeout: 15_000 }).toEqual({
    working: true, busy: true, waitChip: WAIT_CHIP(name), waitChipOk: undefined, waitChips: 1, skipped: false,
  });
  writeFileSync(patientFinishGate, "observed room waiting; finish the direct turn");
};

/** These cases are deliberately slow: each one holds a real turn open on one
 * bot and waits for a second bot to take its turn only once the first settles,
 * through a real server and the fake CLI. The inner polls already allow 15s,
 * which leaves nothing inside vitest's 20s default for process start-up — so on
 * the slowest runner they time out for lack of headroom rather than because
 * anything regressed. The wait itself is what is under test; the clock is not.
 */
describe("chat rooms wait for a member busy elsewhere", { timeout: 45_000 }, () => {
  it("parks on a responder busy in a 1:1, then lets them reply once that turn settles, in order", async () => {
    const busy = await createBot("Busy", "patient");
    const quick = await createBot("Quick", "quick");
    const room = (await api("POST", "/api/groups", {
      name: "Wait chat",
      memberIds: [busy.id, quick.id],
      setup: { bulletin: "", defaultResponder: { kind: "everyone" } },
    })).body.group;

    try {
      await holdBusy(busy.id, "Finish this first");
      expect((await api("POST", `/api/groups/${room.id}/messages`, { text: "Hello team" })).status).toBe(202);
      await releaseAfterRoomWait(room.id, busy.id, "Busy");

      await expect.poll(async () => {
        const { room: current, messages } = await snapshot(room.id);
        return { working: current?.working, ...roundSummary(messages, busy.id) };
      }, { timeout: 15_000 }).toEqual({
        working: false,
        waitChip: WAIT_CHIP("Busy"),
        // settled, not failed: the promise was kept
        waitChipOk: true,
        waitChips: 1,
        skipped: false,
        // the round kept its order — the waited-on member still went first
        speakers: ["Busy", "Quick"],
      });

      // the 1:1 turn the room waited on was left alone to finish on its own
      expect(await directReply(busy.id, "Finish this first")).toBe(true);
      expect(await botBusy(busy.id)).toBe(false);
    } finally {
      await cleanup(room?.id, [busy.id, quick.id]);
    }
  });

  it("waits for a teammate summoned by a chained @mention who is busy elsewhere", async () => {
    const ace = await createBot("Ace", "summoner");
    const bee = await createBot("Bee", "patient");
    const room = (await api("POST", "/api/groups", {
      name: "Chained chat",
      memberIds: [ace.id, bee.id],
      setup: { bulletin: "", defaultResponder: { kind: "member", botId: ace.id } },
    })).body.group;

    try {
      await holdBusy(bee.id, "Bee, finish this first");
      // only Ace is addressed; Bee arrives through Ace's reply
      expect((await api("POST", `/api/groups/${room.id}/messages`, { text: "@Ace please bring Bee in" })).status).toBe(202);
      await releaseAfterRoomWait(room.id, bee.id, "Bee");

      await expect.poll(async () => {
        const { room: current, messages } = await snapshot(room.id);
        return { working: current?.working, ...roundSummary(messages, bee.id) };
      }, { timeout: 15_000 }).toEqual({
        working: false,
        waitChip: WAIT_CHIP("Bee"),
        waitChipOk: true,
        waitChips: 1,
        skipped: false,
        speakers: ["Ace", "Bee"],
      });

      expect(await directReply(bee.id, "Bee, finish this first")).toBe(true);
    } finally {
      await cleanup(room?.id, [ace.id, bee.id]);
    }
  });
});
