// #5343: warming messages.db and scanning it must not stop the server's
// event loop. The page cache warm and the boot/tick scans run off the
// main thread; their results match the sync helpers.
import { mkdirSync, rmSync } from "node:fs";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "../config.ts";
import {
  closeMessageDb,
  closeMessageSearch,
  insertMessage,
  latestMessageAts,
  latestMessageAtsAsync,
  latestPersonLineAts,
  latestPersonLineAtsAsync,
  messageThreadIds,
  messageThreadIdsAsync,
  warmMessagesDbPageCache,
} from "./message-db.ts";
import type { Message } from "../store.ts";

const msg = (id: string, text: string, extra: Partial<Message> = {}): Message => ({
  id,
  role: "user",
  kind: "text",
  text,
  at: Date.now(),
  sendId: `send-${id}`,
  ...extra,
});

/** Largest event-loop delay in ms while `work` runs. */
async function maxLoopDelayMs(work: () => Promise<void>): Promise<number> {
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  histogram.reset();
  await work();
  // one more turn so the last delay is recorded
  await delay(30);
  const max = histogram.max / 1e6;
  histogram.disable();
  return max;
}

describe("messages.db warm and off-thread scans (#5343)", () => {
  beforeEach(() => {
    closeMessageDb();
    rmSync(DATA_DIR, { recursive: true, force: true });
    mkdirSync(DATA_DIR, { recursive: true });
  });

  afterEach(async () => {
    await closeMessageSearch();
    closeMessageDb();
  });

  it("warms messages.db without holding the event loop for a second", async () => {
    const blob = "x".repeat(8_000);
    for (let t = 0; t < 40; t++) {
      for (let i = 0; i < 50; i++) {
        insertMessage(`thread-${t}`, msg(`m-${t}-${i}`, `${blob} ${t}-${i}`, { at: 1_700_000_000_000 + t * 100 + i }));
      }
    }
    const maxMs = await maxLoopDelayMs(() => warmMessagesDbPageCache());
    expect(maxMs).toBeLessThan(1_000);
  }, 60_000);

  it("latestMessageAtsAsync matches latestMessageAts", async () => {
    insertMessage("t1", msg("a", "one", { at: 10 }));
    insertMessage("t1", msg("b", "two", { at: 30 }));
    insertMessage("t2", msg("c", "three", { at: 20 }));
    const ids = ["t1", "t2", "missing"];
    expect([...(await latestMessageAtsAsync(ids))].sort()).toEqual([...latestMessageAts(ids)].sort());
  });

  it("latestPersonLineAtsAsync matches latestPersonLineAts", async () => {
    insertMessage("t1", msg("a", "person", { at: 10, sendId: "s1" }));
    insertMessage("t1", { id: "bot", role: "bot", kind: "text", text: "reply", at: 40 });
    insertMessage("t2", msg("c", "other", { at: 20, sendId: "s2" }));
    const ids = ["t1", "t2"];
    expect([...(await latestPersonLineAtsAsync(ids))].sort()).toEqual([...latestPersonLineAts(ids)].sort());
  });

  it("messageThreadIdsAsync matches messageThreadIds", async () => {
    insertMessage("alpha", msg("a", "a"));
    insertMessage("beta", msg("b", "b"));
    expect((await messageThreadIdsAsync()).sort()).toEqual(messageThreadIds().sort());
  });
});
