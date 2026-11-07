// #2382: a bot waiting on a person's answer in one conversation is not
// "finishing another conversation" in a room.
import { rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import type { ModelSelection } from "./contracts.ts";
import { roomMemberAvailability } from "./room-member-availability.ts";
import { RoomMemberLock } from "./room-member-lock.ts";
import { Store } from "./store.ts";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "default" });
const op = (threadId = "room-thread") => ({ threadId, cancellation: { signal: new AbortController().signal } });

describe("room member availability (#2382)", () => {
  beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));

  it("is ready when its other conversation only waits on a person's answer", () => {
    const store = new Store(selection);
    const bot = store.createBot({}, { seedMessages: false });
    // a live turn parked on an approval or a question: the whole-bot fold
    // reads busy, yet nothing is at work
    store.setTaskActivity(bot.id, bot.threadId, "waiting-on-you");
    expect(store.bot(bot.id)?.busy).toBe(true);
    expect(roomMemberAvailability(store, new RoomMemberLock(), bot.id, op())).toBe("ready");
  });

  it("waits while one of its conversations is at work", () => {
    const store = new Store(selection);
    const bot = store.createBot({}, { seedMessages: false });
    store.setTaskActivity(bot.id, bot.threadId, "working");
    expect(roomMemberAvailability(store, new RoomMemberLock(), bot.id, op())).toBe("busy");
    store.setTaskActivity(bot.id, bot.threadId, "idle");
    expect(roomMemberAvailability(store, new RoomMemberLock(), bot.id, op())).toBe("ready");
  });

  it("waits while a room turn holds it, even one waiting on a person", () => {
    const store = new Store(selection);
    const bot = store.createBot({}, { seedMessages: false });
    store.setActivity(bot.id, "working");
    expect(roomMemberAvailability(store, new RoomMemberLock(), bot.id, op())).toBe("busy");
    store.setActivity(bot.id, "waiting-on-you");
    expect(roomMemberAvailability(store, new RoomMemberLock(), bot.id, op())).toBe("busy");
    store.setActivity(bot.id, "idle");
    expect(roomMemberAvailability(store, new RoomMemberLock(), bot.id, op())).toBe("ready");
  });

  it("waits while another room thread holds it, not the one that does", () => {
    const store = new Store(selection);
    const bot = store.createBot({}, { seedMessages: false });
    const lock = new RoomMemberLock();
    lock.claim(bot.id, "other-thread");
    expect(roomMemberAvailability(store, lock, bot.id, op())).toBe("busy");
    expect(roomMemberAvailability(store, lock, bot.id, op("other-thread"))).toBe("ready");
  });

  it("a fresh bot in a new group conversation is ready", () => {
    const store = new Store(selection);
    const bot = store.createBot({}, { seedMessages: false });
    expect(roomMemberAvailability(store, new RoomMemberLock(), bot.id, op())).toBe("ready");
  });
});
