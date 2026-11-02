import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { openTriggerSeenStore, SEEN_RETENTION_MS } from "./trigger-seen-store.ts";

const dirs: string[] = [];
const stores: Array<ReturnType<typeof openTriggerSeenStore>> = [];

afterEach(() => {
  while (stores.length) stores.pop()!.close();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function open(path = ":memory:", now = () => Date.parse("2026-11-01T12:00:00Z")) {
  const store = openTriggerSeenStore(path, { now });
  stores.push(store);
  return store;
}

describe("trigger-seen-store", () => {
  it("remembers a key across a reopen of the same file", () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-seen-"));
    dirs.push(dir);
    const file = join(dir, "trigger-seen.db");
    const first = open(file);
    expect(first.has("t1", "cal:standup@1")).toBe(false);
    first.add("t1", "cal:standup@1");
    expect(first.has("t1", "cal:standup@1")).toBe(true);
    first.close();
    stores.pop();

    const again = open(file);
    expect(again.has("t1", "cal:standup@1")).toBe(true);
    expect(again.has("t1", "cal:other@1")).toBe(false);
    expect(again.has("t2", "cal:standup@1")).toBe(false);
  });

  it("forgets every key of one trigger and leaves the others", () => {
    const store = open();
    store.add("t1", "a");
    store.add("t1", "b");
    store.add("t2", "a");
    expect(store.forget("t1")).toBe(2);
    expect(store.has("t1", "a")).toBe(false);
    expect(store.has("t2", "a")).toBe(true);
  });

  it("purges keys older than 30 days and keeps younger ones", () => {
    let now = Date.parse("2026-11-01T12:00:00Z");
    const store = open(":memory:", () => now);
    store.add("t1", "old", now - SEEN_RETENTION_MS - 1_000);
    store.add("t1", "fresh", now - 1_000);
    expect(store.purge()).toBe(1);
    expect(store.has("t1", "old")).toBe(false);
    expect(store.has("t1", "fresh")).toBe(true);
    now += SEEN_RETENTION_MS + 2_000;
    expect(store.purge()).toBe(1);
    expect(store.has("t1", "fresh")).toBe(false);
  });

  it("add is idempotent for the same trigger and key", () => {
    const store = open();
    store.add("t1", "k");
    store.add("t1", "k");
    expect(store.has("t1", "k")).toBe(true);
    expect(store.forget("t1")).toBe(1);
  });
});
