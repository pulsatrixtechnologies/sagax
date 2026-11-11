import { appendFileSync, closeSync, ftruncateSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// every byte read synchronously, which is what holds the event loop on the answering path
const fsRead = vi.hoisted(() => ({ bytes: 0 }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const readSync = ((...args: Parameters<typeof actual.readSync>) => {
    const read = (actual.readSync as (...rest: unknown[]) => number)(...args);
    fsRead.bytes += read;
    return read;
  }) as typeof actual.readSync;
  return { ...actual, readSync, default: { ...actual, readSync } };
});

import { logAppended } from "../encryption/content-at-rest.ts";
import { forgetLineCountsInMemory, LINE_COUNTS_FILE, lineCountSettled, logLineTotal, saveLineCounts, SYNC_COUNT_BYTES } from "./log-line-count.ts";
import { MAX_TAIL_BYTES, readThreadEvents } from "./thread-events.ts";

const dirs: string[] = [];
function tmp() {
  const dir = mkdtempSync(join(tmpdir(), "omb-line-count-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  forgetLineCountsInMemory();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const event = (n: number) =>
  JSON.stringify({ provider: "test", threadId: "t1", eventId: `e${n}`, type: "turn.started", createdAt: new Date(Date.UTC(2026, 10, 11, 0, 0, n)).toISOString() }) + "\n";
const events = (from: number, count: number) => Array.from({ length: count }, (_, i) => event(from + i)).join("");

/** What a writer does: append, then report the append. */
function writerAppends(file: string, data: string) {
  appendFileSync(file, data);
  logAppended(file, data.split("\n").filter(Boolean), data);
}

describe("log line totals (#3666)", () => {
  it("answers the newest 300 lines of a 200 MB log from its tail, and counts the rest in slices", async () => {
    const eventsDir = tmp();
    const nativeDir = tmp();
    const file = join(eventsDir, "t1.ndjson");
    // a sparse 200 MB of NUL bytes (no newline: one long first line), then 400 events
    const fd = openSync(file, "w");
    ftruncateSync(fd, 200 * 1024 * 1024);
    closeSync(fd);
    appendFileSync(file, events(0, 400));

    fsRead.bytes = 0;
    const page = readThreadEvents({ eventsDir, nativeDir, threadId: "t1", limit: 300 });
    expect(fsRead.bytes).toBeLessThanOrEqual(MAX_TAIL_BYTES + SYNC_COUNT_BYTES);
    expect(page.entries).toHaveLength(300);
    // not known yet: never shown as the total
    expect(page.totalPartial).toEqual({ runtime: true, native: false });
    expect(page.total.runtime).toBeGreaterThanOrEqual(300);

    // the count completes in slices, the loop given back between them
    let turns = 0;
    let ticking = true;
    const tick = () => { turns++; if (ticking) setImmediate(tick); };
    setImmediate(tick);
    await lineCountSettled(file);
    ticking = false;
    expect(turns).toBeGreaterThanOrEqual(100);

    fsRead.bytes = 0;
    const counted = readThreadEvents({ eventsDir, nativeDir, threadId: "t1", limit: 300 });
    expect(counted.total).toEqual({ runtime: 400, native: 0 });
    expect(counted.totalPartial).toBeUndefined();
    expect(fsRead.bytes).toBeLessThanOrEqual(MAX_TAIL_BYTES);
  }, 60_000);

  it("stays exact after appends, a torn last line and a truncation", () => {
    const file = join(tmp(), "t1.ndjson");
    writeFileSync(file, events(0, 5));
    expect(logLineTotal(file)).toEqual({ total: 5, complete: true });
    appendFileSync(file, events(5, 3));
    expect(logLineTotal(file)).toEqual({ total: 8, complete: true });
    // a write in progress: its line counts once, and again only when a new one starts
    appendFileSync(file, '{"torn":');
    expect(logLineTotal(file)).toEqual({ total: 9, complete: true });
    appendFileSync(file, "true}\n");
    expect(logLineTotal(file)).toEqual({ total: 9, complete: true });
    // rewritten shorter in place (same file, smaller size)
    writeFileSync(file, events(0, 2));
    expect(logLineTotal(file)).toEqual({ total: 2, complete: true });
    // replaced by another file of the same name
    rmSync(file);
    expect(logLineTotal(file)).toEqual({ total: 0, complete: true });
    writeFileSync(file, events(0, 4));
    expect(logLineTotal(file)).toEqual({ total: 4, complete: true });
  });

  it("follows the writer's appends without reading the log, and keeps the count across a restart", () => {
    const dir = tmp();
    const file = join(dir, "t1.ndjson");
    // 3 MB of events, longer than one request may count
    const batch = events(0, 1000);
    let lines = 0;
    while (lines * (batch.length / 1000) < 3 * SYNC_COUNT_BYTES) { writerAppends(file, batch); lines += 1000; }
    writerAppends(file, '{"torn":');
    lines += 1;

    fsRead.bytes = 0;
    expect(logLineTotal(file)).toEqual({ total: lines, complete: true });
    expect(fsRead.bytes).toBe(0);

    // a restart: the stored count is used, not counted again from zero
    saveLineCounts();
    forgetLineCountsInMemory();
    fsRead.bytes = 0;
    expect(logLineTotal(file)).toEqual({ total: lines, complete: true });
    expect(fsRead.bytes).toBe(0);

    // appended by nobody that reported it (an older build): only the new bytes are read
    const more = "true}\n" + events(5000, 10);
    appendFileSync(file, more);
    fsRead.bytes = 0;
    expect(logLineTotal(file)).toEqual({ total: lines + 10, complete: true });
    expect(fsRead.bytes).toBe(Buffer.byteLength(more));
  });

  it("keeps a count that finished while the writer appended, and catches up from where it stopped", async () => {
    const eventsDir = tmp();
    const file = join(eventsDir, "t1.ndjson");
    // a sparse 50 MB log (NUL bytes, one long first line) the writer did not follow
    const fd = openSync(file, "w");
    ftruncateSync(fd, 50 * 1024 * 1024);
    closeSync(fd);
    appendFileSync(file, events(0, 10));

    // the count starts in slices at today's size, and the writer appends during it
    expect(logLineTotal(file).complete).toBe(false);
    const during = events(10, 3);
    writerAppends(file, during);
    await lineCountSettled(file);

    // one more append after the count finished: the count is kept, not dropped
    const after = events(13, 2);
    writerAppends(file, after);

    fsRead.bytes = 0;
    expect(logLineTotal(file)).toEqual({ total: 15, complete: true });
    // only the gap was read, nothing counted again from byte 0
    expect(fsRead.bytes).toBe(Buffer.byteLength(during) + Buffer.byteLength(after));
    fsRead.bytes = 0;
    expect(logLineTotal(file)).toEqual({ total: 15, complete: true });
    expect(fsRead.bytes).toBe(0);
  }, 60_000);

  it("drops the stored count when the writer appends to a file that is no longer the counted one", () => {
    const dir = tmp();
    const file = join(dir, "t1.ndjson");
    writerAppends(file, events(0, 5));
    saveLineCounts();
    expect(Object.keys(JSON.parse(readFileSync(join(dir, LINE_COUNTS_FILE), "utf8")))).toEqual(["t1.ndjson"]);
    // another file renamed into place (as the size cap does), then appended to
    const next = join(dir, "next.tmp");
    writeFileSync(next, events(100, 3));
    renameSync(next, file);
    writerAppends(file, events(200, 2));
    saveLineCounts();
    expect(JSON.parse(readFileSync(join(dir, LINE_COUNTS_FILE), "utf8"))).toEqual({});
    expect(logLineTotal(file)).toEqual({ total: 5, complete: true });
  });
});
