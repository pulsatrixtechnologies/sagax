import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Spied, not replaced: every call still reaches the real filesystem, and the
// tests can count the fsyncs and reads a save costs. The shared test setup
// has already loaded atomic.ts (through config.ts) against the real module,
// so load a fresh copy that sees the spies.
vi.mock("node:fs", { spy: true });
vi.resetModules();
const spied = await import("node:fs");
const { OwnedFile, flushOwnedFiles, flushOwnedFilesSync, renameWithRetry, writeFileAtomic, writeFileAtomicIfChanged } = await import("./atomic.ts");

describe("writeFileAtomic", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omb-atomic-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes the file", () => {
    const p = join(dir, "x.json");
    writeFileAtomic(p, '{"a":1}');
    expect(readFileSync(p, "utf8")).toBe('{"a":1}');
  });

  it("replaces existing contents in full", () => {
    const p = join(dir, "x.json");
    writeFileAtomic(p, "old-and-longer");
    writeFileAtomic(p, "new");
    expect(readFileSync(p, "utf8")).toBe("new");
  });

  it("leaves no temp files behind", () => {
    const p = join(dir, "x.json");
    writeFileAtomic(p, "a");
    writeFileAtomic(p, "b");
    expect(readdirSync(dir)).toEqual(["x.json"]);
  });

  it("preserves unicode across the write", () => {
    const p = join(dir, "u.json");
    const s = JSON.stringify({ msg: "café — 日本語 — 🚀" });
    writeFileAtomic(p, s);
    expect(readFileSync(p, "utf8")).toBe(s);
    expect(existsSync(p)).toBe(true);
  });

  it.skipIf(process.platform === "win32")("applies the requested mode when replacing a file", () => {
    const p = join(dir, "secret.json");
    writeFileAtomic(p, "old");
    chmodSync(p, 0o644);

    writeFileAtomic(p, "new", { mode: 0o600 });

    expect(statSync(p).mode & 0o777).toBe(0o600);
  });

  it("cleans up the temporary file when replacement fails", () => {
    const p = join(dir, "target");
    mkdirSync(p);
    expect(() => writeFileAtomic(p, "cannot replace a directory")).toThrow();
    expect(readdirSync(dir)).toEqual(["target"]);
  });
});

// fsync is F_FULLFSYNC on macOS, ~4 ms of blocked event loop per call, and
// several per-turn saves put back exactly what the file already holds.
describe("writeFileAtomic durability", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omb-atomic-"));
    vi.mocked(spied.fsyncSync).mockClear();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("fsyncs by default", () => {
    writeFileAtomic(join(dir, "x.json"), "a");
    expect(spied.fsyncSync).toHaveBeenCalledTimes(1);
  });

  it("still replaces atomically without the fsync when durable is false", () => {
    const p = join(dir, "x.json");
    writeFileAtomic(p, "old");
    vi.mocked(spied.fsyncSync).mockClear();
    writeFileAtomic(p, "new", { durable: false });
    expect(spied.fsyncSync).not.toHaveBeenCalled();
    expect(readFileSync(p, "utf8")).toBe("new");
    expect(readdirSync(dir)).toEqual(["x.json"]);
  });
});

describe("writeFileAtomicIfChanged", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omb-atomic-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const clearSpies = () => {
    vi.mocked(spied.fsyncSync).mockClear();
    vi.mocked(spied.readFileSync).mockClear();
  };

  it("leaves the file alone when it already holds exactly these bytes", () => {
    const p = join(dir, "x.json");
    const data = JSON.stringify({ msg: "café — 日本語" });
    writeFileAtomic(p, data, { mode: 0o600 });
    const before = statSync(p);
    clearSpies();

    expect(writeFileAtomicIfChanged(p, data, { mode: 0o600 })).toBe(false);

    const after = statSync(p);
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(spied.fsyncSync).not.toHaveBeenCalled();
    expect(readdirSync(dir)).toEqual(["x.json"]);
  });

  it("writes and fsyncs when the bytes differ", () => {
    const p = join(dir, "x.json");
    writeFileAtomic(p, '{"unread":true}');
    clearSpies();
    // Same length, different bytes: only the read can tell.
    expect(writeFileAtomicIfChanged(p, '{"unread":fals}')).toBe(true);
    expect(readFileSync(p, "utf8")).toBe('{"unread":fals}');
    expect(spied.fsyncSync).toHaveBeenCalledTimes(1);
  });

  it("does not read the old contents when the size already differs", () => {
    const p = join(dir, "x.json");
    writeFileAtomic(p, "short");
    clearSpies();
    expect(writeFileAtomicIfChanged(p, "a longer replacement")).toBe(true);
    expect(spied.readFileSync).not.toHaveBeenCalled();
    expect(readFileSync(p, "utf8")).toBe("a longer replacement");
  });

  it("writes a file that does not exist yet", () => {
    const p = join(dir, "new.json");
    expect(writeFileAtomicIfChanged(p, "fresh", { mode: 0o600 })).toBe(true);
    expect(readFileSync(p, "utf8")).toBe("fresh");
  });

  it("passes durable through to the write", () => {
    const p = join(dir, "x.json");
    clearSpies();
    writeFileAtomicIfChanged(p, "token", { durable: false });
    expect(spied.fsyncSync).not.toHaveBeenCalled();
    expect(readFileSync(p, "utf8")).toBe("token");
  });

  it.skipIf(process.platform === "win32")("rewrites identical bytes whose permissions are broader than requested", () => {
    const p = join(dir, "secret.json");
    writeFileAtomic(p, "same");
    chmodSync(p, 0o644);
    expect(writeFileAtomicIfChanged(p, "same", { mode: 0o600 })).toBe(true);
    expect(statSync(p).mode & 0o777).toBe(0o600);
  });

  it.skipIf(process.platform === "win32")("replaces a symlink holding identical bytes instead of following it", () => {
    const target = join(dir, "elsewhere.json");
    const p = join(dir, "x.json");
    writeFileSync(target, "same");
    symlinkSync(target, p);
    expect(writeFileAtomicIfChanged(p, "same")).toBe(true);
    expect(lstatSync(p).isSymbolicLink()).toBe(false);
    expect(readFileSync(p, "utf8")).toBe("same");
    expect(readFileSync(target, "utf8")).toBe("same");
  });

  it.skipIf(process.platform === "win32")("does not hang on a FIFO planted at the path", () => {
    const p = join(dir, "x.json");
    execFileSync("mkfifo", [p]);
    expect(writeFileAtomicIfChanged(p, "data")).toBe(true);
    expect(lstatSync(p).isFile()).toBe(true);
    expect(readFileSync(p, "utf8")).toBe("data");
  });

  it("still fails like writeFileAtomic when the path cannot be replaced", () => {
    const p = join(dir, "target");
    mkdirSync(p);
    expect(() => writeFileAtomicIfChanged(p, "cannot replace a directory")).toThrow();
    expect(readdirSync(dir)).toEqual(["target"]);
  });
});

// Windows refuses a rename onto an existing path while anything else holds a
// handle to either file, and a virus scanner or the search indexer opening a
// just-closed file for a few milliseconds is enough. Callers treat a throw here
// as a failed save, so a transient error used to lose the write.
describe("renameWithRetry", () => {
  function failing(times: number, code: string) {
    let calls = 0;
    return {
      get calls() {
        return calls;
      },
      rename: () => {
        calls += 1;
        if (calls <= times) throw Object.assign(new Error(`${code}: simulated`), { code });
      },
    };
  }

  it("survives a transient EPERM instead of losing the write", () => {
    const stub = failing(3, "EPERM");
    expect(() => renameWithRetry("a.tmp", "a", stub.rename)).not.toThrow();
    expect(stub.calls).toBe(4);
  });

  it("retries EACCES and EBUSY the same way", () => {
    for (const code of ["EACCES", "EBUSY"]) {
      const stub = failing(1, code);
      expect(() => renameWithRetry("a.tmp", "a", stub.rename)).not.toThrow();
      expect(stub.calls).toBe(2);
    }
  });

  it("gives up rather than retrying forever", () => {
    const stub = failing(Number.MAX_SAFE_INTEGER, "EPERM");
    expect(() => renameWithRetry("a.tmp", "a", stub.rename)).toThrow(/EPERM/);
    expect(stub.calls).toBe(6); // first attempt plus five backoffs
  });

  it("does not retry an error that will never clear", () => {
    // Busy-waiting on a missing directory or a cross-device rename would hide
    // a real bug behind a delay and still fail.
    for (const code of ["ENOENT", "EXDEV", "EISDIR"]) {
      const stub = failing(Number.MAX_SAFE_INTEGER, code);
      expect(() => renameWithRetry("a.tmp", "a", stub.rename)).toThrow(new RegExp(code));
      expect(stub.calls).toBe(1);
    }
  });
});

describe("OwnedFile", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omb-owned-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("skips a write whose text equals the last one written or loaded", () => {
    const path = join(dir, "bots.json");
    const file = new OwnedFile(path, { mode: 0o600 });
    expect(file.write('{"a":1}')).toBe(true);
    expect(readFileSync(path, "utf8")).toBe('{"a":1}');
    const renames = vi.mocked(spied.renameSync).mock.calls.length;
    expect(file.write('{"a":1}')).toBe(false);
    expect(vi.mocked(spied.renameSync).mock.calls.length).toBe(renames);
    file.loaded('{"b":2}');
    expect(file.write('{"b":2}')).toBe(false);
    expect(file.write('{"c":3}')).toBe(true);
    expect(readFileSync(path, "utf8")).toBe('{"c":3}');
  });

  // #3663: the bookkeeping path writes later, off the event loop, and in order.
  const tempFiles = () => readdirSync(dir).filter((name) => name.endsWith(".tmp"));

  it("writes a deferred save without a synchronous write or fsync, and the newest waiting state wins", async () => {
    const path = join(dir, "bots.json");
    const file = new OwnedFile(path, { mode: 0o600 });
    const writes = vi.mocked(spied.writeFileSync).mock.calls.length;
    const syncs = vi.mocked(spied.fsyncSync).mock.calls.length;
    for (const n of [1, 2, 3]) file.writeSoon(() => JSON.stringify({ n }));
    expect(existsSync(path)).toBe(false);
    await file.flush();
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ n: 3 });
    expect(vi.mocked(spied.writeFileSync).mock.calls.length).toBe(writes);
    expect(vi.mocked(spied.fsyncSync).mock.calls.length).toBe(syncs);
    if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(tempFiles()).toEqual([]);
  });

  it("ends with the second of two changes in a row, the second asked while the first is writing", async () => {
    const path = join(dir, "bots.json");
    const file = new OwnedFile(path);
    file.writeSoon(() => "first");
    const writing = file.flush();
    file.writeSoon(() => "second");
    await writing;
    expect(readFileSync(path, "utf8")).toBe("second");
    expect(tempFiles()).toEqual([]);
  });

  it("never lands a deferred write over a later write on the loop", async () => {
    const path = join(dir, "bots.json");
    const file = new OwnedFile(path);
    file.writeSoon(() => "bookkeeping");
    const writing = file.flush();
    file.write("bot created");
    await writing;
    expect(readFileSync(path, "utf8")).toBe("bot created");
    expect(tempFiles()).toEqual([]);
  });

  it("has a write on the loop on disk when it returns, ahead of the bookkeeping waiting for its gap", async () => {
    const path = join(dir, "bots.json");
    const file = new OwnedFile(path);
    file.writeSoon(() => "bookkeeping");
    await file.flush();
    file.writeSoon(() => "more bookkeeping");
    file.write("bot created");
    expect(readFileSync(path, "utf8")).toBe("bot created");
    await file.flush();
    expect(readFileSync(path, "utf8")).toBe("more bookkeeping");
  });

  it("throws when a write on the loop fails, leaves the old file, and the bookkeeping it interrupted is written next", async () => {
    const path = join(dir, "bots.json");
    const file = new OwnedFile(path);
    file.write("before");
    file.writeSoon(() => "bookkeeping");
    const writing = file.flush();
    vi.mocked(spied.renameSync).mockImplementationOnce(() => { throw Object.assign(new Error("disk full"), { code: "ENOSPC" }); });
    expect(() => file.write("refused change")).toThrow("disk full");
    expect(readFileSync(path, "utf8")).toBe("before");
    await writing;
    await file.flush();
    expect(readFileSync(path, "utf8")).toBe("bookkeeping");
    expect(tempFiles()).toEqual([]);
  });

  it("logs a failed deferred write once per failure streak, keeps the state, and writes it with the next save", async () => {
    const path = join(dir, "bots.json");
    const file = new OwnedFile(path);
    file.write("before");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const full = () => { throw Object.assign(new Error("disk full"), { code: "ENOSPC" }); };
    vi.mocked(spied.renameSync).mockImplementationOnce(full).mockImplementationOnce(full);
    file.writeSoon(() => "one");
    await file.flush();
    file.writeSoon(() => "two");
    await file.flush();
    expect(logged).toHaveBeenCalledTimes(1);
    expect(readFileSync(path, "utf8")).toBe("before");
    file.writeSoon(() => "three");
    await file.flush();
    expect(readFileSync(path, "utf8")).toBe("three");
    logged.mockRestore();
    expect(tempFiles()).toEqual([]);
  });

  it("writes the waiting state at shutdown, at once or awaited", async () => {
    const path = join(dir, "bots.json");
    const file = new OwnedFile(path);
    file.writeSoon(() => "sync at exit");
    flushOwnedFilesSync();
    expect(readFileSync(path, "utf8")).toBe("sync at exit");
    file.writeSoon(() => "awaited at shutdown");
    await flushOwnedFiles();
    expect(readFileSync(path, "utf8")).toBe("awaited at shutdown");
  });

  it("hands its waiting state to a new owner of the file, unless something else wrote the file since", async () => {
    const path = join(dir, "bots.json");
    const first = new OwnedFile(path);
    first.write("one");
    first.writeSoon(() => "two");
    new OwnedFile(path);
    expect(readFileSync(path, "utf8")).toBe("two");
    const second = new OwnedFile(path);
    second.write("three");
    second.writeSoon(() => "stale");
    writeFileSync(path, "restored");
    new OwnedFile(path);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(readFileSync(path, "utf8")).toBe("restored");
  });

  it("logs a failed deferred write and writes it again on the next save", async () => {
    const path = join(dir, "bots.json");
    const file = new OwnedFile(path);
    mkdirSync(path);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    file.writeSoon(() => "kept");
    await file.flush();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
    rmSync(path, { recursive: true });
    await file.flush();
    expect(readFileSync(path, "utf8")).toBe("kept");
  });

  const child = (script: string, until: string, afterMs = 0): Promise<void> => new Promise((resolve, reject) => {
    const source = join(dir, "child.mjs");
    writeFileSync(source, `import { OwnedFile } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, "atomic.ts")).href)};\n${script}`);
    const proc = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", source], { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      if (out.includes(until)) setTimeout(() => proc.kill("SIGKILL"), afterMs);
    });
    proc.on("error", reject);
    proc.on("exit", () => resolve());
  });

  it("keeps an acknowledged immediate change on disk when the process is killed right after", async () => {
    const path = join(dir, "bots.json");
    writeFileSync(path, JSON.stringify({ bots: [] }));
    await child(`
      const file = new OwnedFile(${JSON.stringify(path)}, { mode: 0o600 });
      file.write(JSON.stringify({ bots: ["created"] }));
      process.stdout.write("ack\\n");
      setInterval(() => {}, 1000);
    `, "ack");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ bots: ["created"] });
  });

  it("leaves the old file or the new one, never a torn one, when killed in the middle of a deferred write", async () => {
    const path = join(dir, "bots.json");
    const old = JSON.stringify({ n: 0 });
    for (const afterMs of [0, 1, 3, 8, 20]) {
      writeFileSync(path, old);
      await child(`
        const file = new OwnedFile(${JSON.stringify(path)});
        const pad = "x".repeat(8_000_000);
        let n = 0;
        const next = () => JSON.stringify({ n: ++n, pad });
        file.writeSoon(next);
        setTimeout(() => process.stdout.write("writing\\n"), 0);
        setInterval(() => file.writeSoon(next), 1);
      `, "writing", afterMs);
      const saved = JSON.parse(readFileSync(path, "utf8")) as { n: number; pad?: string };
      expect(saved.n === 0 || saved.pad?.length === 8_000_000).toBe(true);
    }
  }, 30_000);
});
