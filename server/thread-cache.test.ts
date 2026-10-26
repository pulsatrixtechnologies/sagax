import { describe, expect, it } from "vitest";
import type { Message } from "./store.ts";
import { THREAD_IDLE_MS, ThreadCache } from "./thread-cache.ts";

const message = (id: string, parentId?: string | null): Message => ({ id, role: "user", text: id, at: 0, ...(parentId !== undefined ? { parentId } : {}) } as Message);

describe("ThreadCache (port de OpenMausBot #3132)", () => {
  it("chains legacy rows and defaults the active leaf to the newest message", () => {
    const cache = new ThreadCache(() => new Set());
    const state = cache.load("t1", { messages: [message("a"), message("b"), message("c", "a")], activeLeafId: null });
    expect(state.messages.map((m) => m.parentId)).toEqual([null, "a", "a"]);
    expect(state.activeLeafId).toBe("c");
    expect(cache.load("t2", { messages: [message("x", null)], activeLeafId: "x" }).activeLeafId).toBe("x");
  });

  it("lets an idle conversation go, keeps a busy or recently read one", () => {
    let now = 1_000_000;
    const busy = new Set<string>(["busy"]);
    const cache = new ThreadCache(() => busy, () => now);
    for (const id of ["idle", "busy", "read"]) cache.load(id, { messages: [message(`${id}-1`, null)], activeLeafId: null });
    now += THREAD_IDLE_MS - 60_000;
    expect(cache.get("read")).toBeDefined();
    now += 120_000;
    // the sweep runs on this read: "idle" is past the idle time, "read" was read a minute ago
    expect(cache.get("busy")).toBeDefined();
    expect(cache.size).toBe(2);
    expect(cache.get("idle")).toBeUndefined();
    expect(cache.get("read")).toBeDefined();
  });

  it("sweeps at most once a minute", () => {
    let now = 0;
    let asked = 0;
    const cache = new ThreadCache(() => { asked++; return new Set(); }, () => now);
    cache.load("t", { messages: [], activeLeafId: null });
    now = THREAD_IDLE_MS + 1;
    cache.get("x");
    cache.get("x");
    expect(asked).toBe(1);
    expect(cache.size).toBe(0);
  });
});
