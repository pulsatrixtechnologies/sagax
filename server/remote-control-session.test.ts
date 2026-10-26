import { describe, expect, it } from "vitest";

import { HELPER_FRAME_JPEG, HELPER_FRAME_META, type ControlEvent } from "../shared/remote-control.ts";
import { createRemoteControlSessions, type ControlAuditEvent, type ControlProcess, type OpenControl } from "./remote-control-session.ts";

function frame(type: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + payload.length);
  out[0] = type;
  out[1] = (payload.length >>> 24) & 0xff;
  out[2] = (payload.length >>> 16) & 0xff;
  out[3] = (payload.length >>> 8) & 0xff;
  out[4] = payload.length & 0xff;
  out.set(payload, 5);
  return out;
}

class FakeProc implements ControlProcess {
  lines: string[] = [];
  killed = false;
  inputEnded = false;
  argv: string[];
  private stdout: ((chunk: Uint8Array) => void) | null = null;
  private exit: (() => void) | null = null;
  constructor(argv: string[]) { this.argv = argv; }
  writeLine(line: string) { this.lines.push(line); }
  onStdout(cb: (chunk: Uint8Array) => void) { this.stdout = cb; }
  onExit(cb: () => void) { this.exit = cb; }
  endInput() { this.inputEnded = true; }
  kill() { this.killed = true; }
  emit(chunk: Uint8Array) { this.stdout?.(chunk); }
  die() { this.exit?.(); }
  /** Lines after the first (the base64 program preamble). */
  get events() { return this.lines.slice(1); }
}

function harness(os: "windows" | "macos" | "linux" = "windows") {
  const audit: ControlAuditEvent[] = [];
  const procs: FakeProc[] = [];
  const sessions = createRemoteControlSessions({
    audit: { write: (event) => audit.push(event) },
    now: () => 1_000_000,
    spawn: (argv) => { const p = new FakeProc(argv); procs.push(p); return p; },
  });
  const sink: { meta: unknown[]; frames: Uint8Array[]; closed: string[] } = { meta: [], frames: [], closed: [] };
  const base: OpenControl = {
    session: { id: "0123456789ab", os, endAt: new Date(1_000_000 + 3_600_000).toISOString() },
    tunnel: { keyPath: "/k", address: "tcADDRESS" },
    bin: "tailcat",
    principalId: "melonie",
    botId: "bot-1",
    onMeta: (meta) => sink.meta.push(meta),
    onFrame: (bytes) => sink.frames.push(bytes),
    onClosed: (reason) => sink.closed.push(reason),
  };
  return { sessions, audit, procs, sink, base };
}

describe("createRemoteControlSessions", () => {
  it("refuses control on a non-Windows session and spawns nothing", () => {
    const { sessions, procs, base } = harness("macos");
    const opened = sessions.open(base);
    expect("error" in opened).toBe(true);
    expect(procs).toHaveLength(0);
  });

  it("drops input until control is granted, then forwards validated events", () => {
    const { sessions, procs, audit, base } = harness();
    const handle = sessions.open(base);
    if ("error" in handle) throw new Error(handle.error);
    const proc = procs[0]!;
    expect(proc.argv).toContain("tailcat");

    // the first stdin line is the base64 program (the bootstrap reads it)
    expect(proc.lines[0]).toBe(proc.lines[0]);
    expect(proc.lines).toHaveLength(1);

    const click: ControlEvent[] = [{ t: "d", b: 0 }, { t: "u", b: 0 }];
    handle.input(click);
    expect(proc.events).toEqual([]); // not granted yet
    expect(audit.some((event) => event.kind === "control.input_blocked")).toBe(true);

    handle.setControl(true);
    handle.input([{ t: "m", x: 10, y: 20 }, { t: "m", x: 30, y: 40 }, { t: "d", b: 0 }, { t: "u", b: 0 }]);
    // the two moves collapse to the last, the click is kept
    expect(proc.events).toEqual(["m 30 40", "d 0", "u 0"]);

    handle.setControl(false);
    handle.input([{ t: "d", b: 0 }]);
    expect(proc.events).toEqual(["m 30 40", "d 0", "u 0"]); // nothing new while released
  });

  it("releases every held key and button on release, close and replacement (no stuck input)", () => {
    const { sessions, procs, base } = harness();
    const handle = sessions.open(base);
    if ("error" in handle) throw new Error(handle.error);
    const proc = procs[0]!;
    handle.setControl(true);
    // press two keys and a button, never send the ups
    handle.input([{ t: "k", k: 17, d: 1 }, { t: "k", k: 65, d: 1 }, { t: "d", b: 0 }]);
    proc.lines = []; // ignore what was sent so far
    handle.setControl(false);
    // ups emitted for the button and both keys
    expect(proc.lines.sort()).toEqual(["k 17 0", "k 65 0", "u 0"]);
  });

  it("release-all lifts held input but keeps control on (blur / tab hidden)", () => {
    const { sessions, procs, base } = harness();
    const handle = sessions.open(base);
    if ("error" in handle) throw new Error(handle.error);
    const proc = procs[0]!;
    handle.setControl(true);
    handle.input([{ t: "d", b: 1 }, { t: "k", k: 70, d: 1 }]);
    proc.lines = [];
    handle.releaseAll();
    expect(proc.lines.sort()).toEqual(["k 70 0", "u 1"]);
    expect(handle.granted).toBe(true);
    // a fresh press still goes through
    handle.input([{ t: "d", b: 0 }]);
    expect(proc.lines).toContain("d 0");
  });

  it("ends the helper's stdin before killing it", () => {
    const { sessions, procs, base } = harness();
    const handle = sessions.open(base);
    if ("error" in handle) throw new Error(handle.error);
    handle.close("closed");
    expect(procs[0]!.inputEnded).toBe(true);
    expect(procs[0]!.killed).toBe(true);
  });

  it("delivers meta and jpeg frames from the helper to the viewer", () => {
    const { sessions, procs, sink, base } = harness();
    const handle = sessions.open(base);
    if ("error" in handle) throw new Error(handle.error);
    const proc = procs[0]!;
    proc.emit(frame(HELPER_FRAME_META, new TextEncoder().encode(JSON.stringify({ w: 1920, h: 1080 }))));
    proc.emit(frame(HELPER_FRAME_JPEG, new Uint8Array([0xff, 0xd8, 0xff, 0xd9])));
    expect(sink.meta).toEqual([{ w: 1920, h: 1080 }]);
    expect(sink.frames).toEqual([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])]);
  });

  it("audits grant and release with activity counts but never the keys", () => {
    const { sessions, procs, audit, base } = harness();
    const handle = sessions.open(base);
    if ("error" in handle) throw new Error(handle.error);
    handle.setControl(true);
    handle.input([{ t: "k", k: 65, d: 1 }, { t: "k", k: 65, d: 0 }, { t: "x", s: "allo" }, { t: "d", b: 0 }]);
    handle.setControl(false);
    const release = audit.find((event) => event.kind === "control.release");
    expect(release).toMatchObject({ keys: 1, chars: 4, clicks: 1 });
    expect(JSON.stringify(audit)).not.toContain("allo");
    void procs;
  });

  it("closing kills the helper, audits a release then a stop, and tells the viewer", () => {
    const { sessions, procs, audit, sink, base } = harness();
    const handle = sessions.open(base);
    if ("error" in handle) throw new Error(handle.error);
    handle.setControl(true);
    handle.close("closed");
    expect(procs[0]!.killed).toBe(true);
    expect(sink.closed).toEqual(["closed"]);
    const kinds = audit.map((event) => event.kind);
    expect(kinds).toEqual(["control.start", "control.notice", "control.grant", "control.release", "control.stop"]);
    expect(sessions.has(base.session.id)).toBe(false);
  });

  it("a helper exit tears the session down with helper_exit", () => {
    const { sessions, procs, sink, base } = harness();
    const handle = sessions.open(base);
    if ("error" in handle) throw new Error(handle.error);
    procs[0]!.die();
    expect(sink.closed).toEqual(["helper_exit"]);
  });

  it("a second open for the same session replaces the first", () => {
    const { sessions, procs, sink, base } = harness();
    sessions.open(base);
    sessions.open(base);
    expect(procs[0]!.killed).toBe(true);
    expect(sink.closed[0]).toBe("replaced");
    expect(procs).toHaveLength(2);
  });

  it("closeSession stops control for a session whose stage-1 row closed", () => {
    const { sessions, procs, sink, base } = harness();
    sessions.open(base);
    sessions.closeSession(base.session.id);
    expect(procs[0]!.killed).toBe(true);
    expect(sink.closed).toEqual(["closed"]);
  });

  it("a protocol error from the helper closes the session", () => {
    const { sessions, procs, sink, base } = harness();
    sessions.open(base);
    procs[0]!.emit(new Uint8Array([0x5a, 0, 0, 0, 1, 0])); // bad type byte
    expect(sink.closed).toEqual(["protocol"]);
  });
});
