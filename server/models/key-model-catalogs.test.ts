// #4416: one live model list per key, kept; the written list as fallback.
import { describe, expect, it } from "vitest";

import type { ModelCatalog } from "../contracts.ts";
import { createKeyModelCatalogs, keyFingerprint } from "./key-model-catalogs.ts";

const list = (...ids: string[]): ModelCatalog => ({ default: ids[0], options: ids.map((id) => ({ id, label: id })) });
const WRITTEN = list("written");

describe("per-key model lists", () => {
  it("reads each key once while fresh, again once stale, and keeps the last good list on a failure", async () => {
    let clock = 0;
    const catalogs = createKeyModelCatalogs({ fallback: () => WRITTEN, ttlMs: 100, now: () => clock });
    let reads = 0;
    let answer: () => Promise<ModelCatalog | null> = async () => list("a1", "a2");
    const read = () => { reads++; return answer(); };
    expect(await catalogs.forKey("key-a", read)).toEqual(list("a1", "a2"));
    expect(await catalogs.forKey("key-a", read)).toEqual(list("a1", "a2"));
    expect(reads).toBe(1);
    clock = 200;
    answer = async () => { throw new Error("down"); };
    // stale: the last good list at once, read again behind
    expect(await catalogs.forKey("key-a", read)).toEqual(list("a1", "a2"));
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(reads).toBe(2);
    clock = 400;
    answer = async () => list();
    expect(await catalogs.forKey("key-a", read)).toEqual(list("a1", "a2"));
  });

  it("gives two keys their own lists, and the written list to a key never read", async () => {
    const catalogs = createKeyModelCatalogs({ fallback: () => WRITTEN });
    expect(await catalogs.forKey("key-a", async () => list("a"))).toEqual(list("a"));
    expect(await catalogs.forKey("key-b", async () => list("b"))).toEqual(list("b"));
    expect(await catalogs.forKey("key-c", async () => null)).toBe(WRITTEN);
  });

  it("keeps a bounded number of keys, dropping the one used least recently", async () => {
    const catalogs = createKeyModelCatalogs({ fallback: () => WRITTEN, maxKeys: 2 });
    let reads = 0;
    const read = (id: string) => async () => { reads++; return list(id); };
    await catalogs.forKey("key-a", read("a"));
    await catalogs.forKey("key-b", read("b"));
    await catalogs.forKey("key-a", read("a"));
    expect(reads).toBe(2);
    // a third key pushes out key-b, the one used least recently
    await catalogs.forKey("key-c", read("c"));
    expect(reads).toBe(3);
    await catalogs.forKey("key-a", read("a"));
    expect(reads).toBe(3);
    await catalogs.forKey("key-b", read("b"));
    expect(reads).toBe(4);
  });

  it("names a key by a one-way fingerprint", () => {
    expect(keyFingerprint("key-a")).toMatch(/^[0-9a-f]{32}$/);
    expect(keyFingerprint("key-a")).not.toContain("key-a");
  });
});
