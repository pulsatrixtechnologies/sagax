// The server log tail (server/process/server-log-ring.ts): bounded, redacted,
// newest first, filtered by level, paged by seq.
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { captureConsole, LOG_LINE_MAX_CHARS, ServerLogRing } from "./server-log-ring.ts";

describe("server log ring", () => {
  it("keeps the last lines, splits areas, drops colours, redacts secrets", () => {
    const ring = new ServerLogRing({ max: 3, now: () => 42 });
    ring.push("info", "[engines] claude: 2.1.0");
    ring.push("warn", `\u001b[33m[omb-turn] slow\u001b[0m`);
    ring.push("error", "[auth] key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 refused");
    ring.push("info", "line one\nline two");
    const all = ring.read({ limit: 10 });
    expect(all.lines.map((line) => line.message)).toEqual(["line two", "line one", expect.stringContaining("refused")]);
    expect(all.lines[2]).toMatchObject({ level: "error", area: "auth", at: 42 });
    expect(all.lines[2]!.message).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
    expect(all.next).toBeNull();
  });

  it("filters by level and pages by seq", () => {
    const ring = new ServerLogRing();
    for (let index = 0; index < 5; index++) ring.push(index % 2 ? "warn" : "info", `line ${index}`);
    expect(ring.read({ level: "warn", limit: 10 }).lines.map((line) => line.message)).toEqual(["line 3", "line 1"]);
    const first = ring.read({ limit: 2 });
    expect(first.lines.map((line) => line.message)).toEqual(["line 4", "line 3"]);
    expect(ring.read({ limit: 2, before: first.next }).lines.map((line) => line.message)).toEqual(["line 2", "line 1"]);
    ring.push("info", "x".repeat(5000));
    expect(ring.read({ limit: 1 }).lines[0]!.message).toHaveLength(LOG_LINE_MAX_CHARS);
  });

  it("mirrors a console and undoes", () => {
    const ring = new ServerLogRing();
    const seen: string[] = [];
    const target = { log: (...a: unknown[]) => seen.push(a.join(" ")), info: () => {}, warn: () => {}, error: () => {} };
    const undo = captureConsole(ring, target as unknown as Console);
    target.log("[x] hello %d", 5);
    undo();
    target.log("after");
    expect(seen).toEqual(["[x] hello %d 5", "after"]);
    expect(ring.read({ limit: 5 }).lines.map((line) => `${line.area}:${line.message}`)).toEqual(["x:hello 5"]);
  });
});

describe("the server log window on disk (2026-10-11)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const temp = () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-log-"));
    dirs.push(dir);
    return dir;
  };

  it("keeps the last lines across a restart, with seq continuing and this run's early lines after them", () => {
    const dir = join(temp(), "server-log");
    const first = new ServerLogRing({ now: () => 1 });
    first.push("info", "before the data directory");
    first.persistTo(dir);
    first.push("warn", "[engines] after");
    first.flush();
    if (process.platform !== "win32") expect(statSync(dir).mode & 0o777).toBe(0o700);
    if (process.platform !== "win32") expect(statSync(join(dir, "current.jsonl")).mode & 0o777).toBe(0o600);

    const second = new ServerLogRing({ now: () => 2 });
    second.push("error", "early in the next run");
    second.persistTo(dir);
    second.push("info", "later in the next run");
    second.flush();
    const lines = second.read({ limit: 10 }).lines;
    expect(lines.map((line) => [line.seq, line.level, line.message])).toEqual([
      [4, "info", "later in the next run"],
      [3, "error", "early in the next run"],
      [2, "warn", "after"],
      [1, "info", "before the data directory"],
    ]);
    expect(lines[2]!.area).toBe("engines");
    // a third start reads both runs back
    const third = new ServerLogRing();
    third.persistTo(dir);
    expect(third.read({ limit: 10 }).lines.map((line) => line.seq)).toEqual([4, 3, 2, 1]);
  });

  it("is bounded: the current file becomes the previous one, and the window is the ring's size", () => {
    const dir = join(temp(), "server-log");
    const ring = new ServerLogRing({ max: 50, fileMaxBytes: 4_000 });
    ring.persistTo(dir);
    for (let index = 0; index < 400; index++) {
      ring.push("info", `line ${index} ${"x".repeat(40)}`);
      if (index % 10 === 9) ring.flush();
    }
    ring.flush();
    const current = statSync(join(dir, "current.jsonl")).size;
    const previous = statSync(join(dir, "previous.jsonl")).size;
    expect(current).toBeLessThanOrEqual(4_000);
    expect(previous).toBeLessThanOrEqual(4_000);
    const restarted = new ServerLogRing({ max: 50 });
    restarted.persistTo(dir);
    const kept = restarted.read({ limit: 100 }).lines;
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThanOrEqual(50);
    expect(kept[0]!.message).toContain("line 399");
  });

  it("skips lines it cannot read and stays in memory without a usable folder", () => {
    const base = temp();
    const dir = join(base, "server-log");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "current.jsonl"), [
      JSON.stringify({ seq: 7, at: 1, level: "warn", area: null, message: "kept" }),
      "not json",
      JSON.stringify({ seq: "8", at: 1, level: "info", message: "bad seq" }),
      JSON.stringify({ seq: 9, at: 1, level: "debug", message: "bad level" }),
    ].join("\n"));
    const ring = new ServerLogRing();
    ring.persistTo(dir);
    ring.push("info", "next");
    expect(ring.read({ limit: 10 }).lines.map((line) => [line.seq, line.message])).toEqual([[8, "next"], [7, "kept"]]);

    const blocked = join(base, "a-file");
    writeFileSync(blocked, "");
    const memory = new ServerLogRing();
    memory.persistTo(join(blocked, "server-log"));
    memory.push("info", "still here");
    memory.flush();
    expect(memory.read({ limit: 10 }).lines.map((line) => line.message)).toEqual(["still here"]);
  });
});
