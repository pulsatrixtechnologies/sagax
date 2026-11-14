// #4187: a desktop that reads the open thread on every bot frame while a bot
// streams into it sent one POST /api/bots/:id/read per frame. Each read moved
// the read cursor to the newest line, so each one patched the thread, emitted
// a store change (one whole-bot frame) AND broadcast the bot a second time,
// and every frame made the next read. A read is cheap now: a bot frame goes
// out only when the thread's unread state flips, and a cursor that only moves
// is bookkeeping (written later, coalesced) that tells nobody.
import { rmSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { flushOwnedFiles } from "../atomic.ts";
import { DATA_DIR } from "../config.ts";
import { Store } from "../store.ts";
import { handleSmallBotMutations } from "./bots-mutate-small.ts";
import type { BotsMutateEnv } from "./bots-mutate-helpers.ts";

const selection = () => ({ instanceId: "claude", model: "claude-sonnet-5" });

function readEnv(store: Store, botId: string, threadId: string, broadcast: (frame: unknown) => void) {
  const json = vi.fn();
  return {
    json,
    env: {
      path: `/api/bots/${botId}/read`, method: "POST", req: { headers: {} }, res: {},
      auth: { kind: "loopback", scopes: ["client"], trust: "owner" },
      readBody: async () => ({ threadId }),
      json,
      store,
      requestedTaskBot: (id: string, thread: string) => store.projectBotForTask(id, thread)!,
      readCursor: (thread: string) => {
        const newest = store.activePath(thread).at(-1)?.id;
        return newest ? { lastReadMessageId: newest } : {};
      },
      pushHub: { noteRead: vi.fn() },
      actorPrincipalId: () => undefined,
      wireBot: (bot: unknown) => bot,
      broadcast,
    } as unknown as BotsMutateEnv,
  };
}

describe("a read during a streamed burst (#4187)", () => {
  beforeEach(() => {
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it("sends one bot frame for the unread flip, none for the reads that only move the cursor", async () => {
    const store = new Store(selection);
    const bot = store.createBot({ name: "Burst" }, { seedMessages: false });
    const thread = bot.threadId;
    store.appendMessage(thread, { role: "bot", kind: "text", text: "first" });
    store.patchTask(bot.id, thread, { unread: true });
    await flushOwnedFiles();
    const frames: unknown[] = [];
    let botChanges = 0;
    store.onChange((change) => { if (change.type === "bot") botChanges += 1; });
    const broadcast = (frame: unknown) => { frames.push(frame); };
    const BURST = 50;
    for (let index = 0; index < BURST; index += 1) {
      // the bot streams one more line into the open thread, the client reads
      store.appendMessage(thread, { role: "bot", kind: "text", text: `line ${index}` });
      const { env, json } = readEnv(store, bot.id, thread, broadcast);
      expect(await handleSmallBotMutations(env)).toBe(true);
      expect(json.mock.calls[0]?.[1]).toBe(200);
    }
    await flushOwnedFiles();
    // one change for the flip from unread to read, nothing per later read
    expect(botChanges).toBe(1);
    // the store change is the frame: the route never broadcasts a second copy
    expect(frames).toHaveLength(0);
    const task = store.taskByThread(bot.id, thread)!;
    expect(task.unread).toBe(false);
    // the cursor still follows the newest line, and it is on disk
    expect(task.lastReadMessageId).toBe(store.activePath(thread).at(-1)?.id);
    expect(new Store(selection).taskByThread(bot.id, thread)?.lastReadMessageId).toBe(task.lastReadMessageId);
  });

  it("answers a read of an already read thread with the bot and changes nothing", async () => {
    const store = new Store(selection);
    const bot = store.createBot({ name: "Quiet" }, { seedMessages: false });
    store.appendMessage(bot.threadId, { role: "bot", kind: "text", text: "seen" });
    const first = readEnv(store, bot.id, bot.threadId, vi.fn());
    await handleSmallBotMutations(first.env);
    let botChanges = 0;
    store.onChange((change) => { if (change.type === "bot") botChanges += 1; });
    for (let index = 0; index < 20; index += 1) {
      const { env, json } = readEnv(store, bot.id, bot.threadId, vi.fn());
      await handleSmallBotMutations(env);
      expect(json.mock.calls[0]?.[2]).toMatchObject({ bot: { id: bot.id } });
    }
    expect(botChanges).toBe(0);
  });
});
