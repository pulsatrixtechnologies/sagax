import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createThreadFilePins, MAX_PINS_PER_THREAD } from "./thread-file-pins.ts";

const dirs: string[] = [];
const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), "pins-"));
  dirs.push(dir);
  return join(dir, "thread-file-pins.json");
};
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const id = (n: number) => n.toString(16).padStart(24, "0");

describe("thread file pins", () => {
  it("pins and unpins per conversation and survives a restart", () => {
    const file = fresh();
    const pins = createThreadFilePins({ file });
    expect(pins.set("t1", id(1), true)).toBe(true);
    expect(pins.set("t1", id(2), true)).toBe(true);
    expect(pins.set("t2", id(1), true)).toBe(true);
    expect(pins.set("t1", id(2), false)).toBe(true);
    expect([...pins.ids("t1")]).toEqual([id(1)]);
    expect([...pins.ids("t2")]).toEqual([id(1)]);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const again = createThreadFilePins({ file });
    expect([...again.ids("t1")]).toEqual([id(1)]);
    expect([...again.ids("none")]).toEqual([]);
  });

  it("pinning twice keeps one entry, and a malformed id is refused", () => {
    const pins = createThreadFilePins({ file: fresh() });
    pins.set("t", id(1), true);
    pins.set("t", id(1), true);
    expect(pins.ids("t").size).toBe(1);
    expect(pins.set("t", "../x", true)).toBe(false);
  });

  it("stops at the per-conversation limit but still lets one unpin", () => {
    const pins = createThreadFilePins({ file: fresh() });
    for (let n = 0; n < MAX_PINS_PER_THREAD; n++) expect(pins.set("t", id(n), true)).toBe(true);
    expect(pins.set("t", id(MAX_PINS_PER_THREAD), true)).toBe(false);
    expect(pins.set("t", id(0), false)).toBe(true);
    expect(pins.set("t", id(MAX_PINS_PER_THREAD), true)).toBe(true);
  });
});
