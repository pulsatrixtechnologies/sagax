import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserRuntime } from "./browser-runtime.ts";
import { BrowserLive, parseBrowserLiveAction } from "./browser-live.ts";
import { parseDescribedElement, TEACH_IDLE_MS, TEACH_ORPHAN_MS, teachDescribeScript, TeachRecorder, TeachRecordings } from "./browser-teach.ts";

const execute = vi.hoisted(() => vi.fn());
vi.mock("./browser-engine.ts", () => ({ closeBrowserSession: vi.fn(async () => true) }));
vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  const { promisify } = await import("node:util");
  return { ...actual, execFile: Object.assign(vi.fn(), { [promisify.custom]: execute }) };
});

class ResponseFixture extends EventEmitter {
  destroyed = false; writableEnded = false; headersSent = false; writableLength = 0;
  chunks: string[] = [];
  writeHead() { this.headersSent = true; }
  flushHeaders() {}
  write(value: string) { this.chunks.push(value); return true; }
  end() { this.writableEnded = true; }
  destroy() { this.destroyed = true; this.emit("close"); }
  get id(): string {
    const ready = this.chunks.find((chunk) => chunk.startsWith("event: ready\n"));
    return ready ? JSON.parse(ready.split("\ndata: ")[1]!).viewerId : "";
  }
}

class SocketFixture extends EventTarget {
  static OPEN = 1;
  static instances: SocketFixture[] = [];
  readyState = 1; bufferedAmount = 0;
  constructor() { super(); SocketFixture.instances.push(this); queueMicrotask(() => this.dispatchEvent(new Event("open"))); }
  send() {}
  close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
  receive(value: unknown) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) })); }
}

const ready = { enabled: true, connected: true, port: 43210 };
const output = (data: unknown) => ({ stdout: JSON.stringify({ success: true, data }), stderr: "" });
// What the page answers for the element under a point or the focused one.
const PAGE: Record<string, unknown> = {
  "100,50": { url: "https://shop.example/login?next=%2Fcart", tag: "input", role: "textbox", name: "Email", type: "email", fieldName: "email" },
  "100,90": { url: "https://shop.example/login?next=%2Fcart", tag: "input", role: "textbox", name: "Password", type: "password", fieldName: "pw" },
  "100,130": { url: "https://shop.example/login?next=%2Fcart", tag: "button", role: "button", name: "Sign in" },
};
let focused = "100,50";
let held: Map<string, string>;
let live: BrowserLive;

function engine(_command: string, args: string[]) {
  if (args[0] === "eval") {
    const point = /const at = \[(\d+), (\d+)\]/.exec(args[1]!);
    const key = point ? `${point[1]},${point[2]}` : focused;
    return Promise.resolve(output({ result: JSON.stringify(PAGE[key] ?? { url: "https://shop.example/" }) }));
  }
  return Promise.resolve(output(ready));
}

beforeEach(() => {
  held = new Map();
  const runtime = {
    heldBy: (session: string) => held.get(session),
    canControl: (session: string, owner: string) => held.get(session) === owner,
    take: vi.fn(async (session: string, owner: string) => { held.set(session, owner); }),
    release: vi.fn((session: string, owner: string) => { if (held.get(session) === owner) held.delete(session); }),
    abandonHumanInput: vi.fn(),
    interrupted: vi.fn(() => false),
    withHumanAction: vi.fn(async (_session: string, _owner: string, fn: () => unknown) => fn()),
  watch: vi.fn(() => () => {}),
  settled: vi.fn(async () => {}),
  } as unknown as BrowserRuntime;
  live = new BrowserLive({ runtime });
  SocketFixture.instances = [];
  vi.stubGlobal("WebSocket", SocketFixture);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: true })));
  execute.mockReset().mockImplementation(engine);
  focused = "100,50";
});
afterEach(() => { live.closeAll(); vi.unstubAllGlobals(); });

async function open(owner = "person-a") {
  const res = new ResponseFixture();
  await live.open({ botId: "bot-a", session: "profile-a", owner, isCurrent: () => true, res: res as unknown as ServerResponse,
    spec: { command: "/trusted/agent-browser", env: { AGENT_BROWSER_SESSION: "profile-a" } } });
  const action = (body: unknown) => live.action({ viewerId: res.id, botId: "bot-a", owner, body }) as Promise<Record<string, unknown>>;
  await action({ type: "take" });
  return { res, action };
}
const click = (x: number, y: number) => ({ type: "input_mouse", eventType: "mousePressed", x, y, button: "left", clickCount: 1 });
const key = (value: string) => ({ type: "input_keyboard", eventType: "keyDown", key: value, ...(value.length === 1 ? { text: value } : {}) });

describe("teach by demonstration: the recorder", () => {
  it("accepts only the fixed record verbs", () => {
    expect(parseBrowserLiveAction({ type: "record-start", script: "x" })).toEqual({ type: "record-start" });
    expect(parseBrowserLiveAction({ type: "record-stop" })).toEqual({ type: "record-stop" });
    expect(() => parseBrowserLiveAction({ type: "record-export" })).toThrow();
  });

  it("records the person's clicks, text and keys as steps, and never a password", async () => {
    const view = await open();
    expect(await view.action({ type: "record-start" })).toEqual({ ok: true, recording: true });
    await view.action({ type: "navigate", url: "https://shop.example/login?next=%2Fcart&token=abc123" });
    await view.action(click(100, 50));
    for (const letter of "owner@example.com") await view.action(key(letter));
    await view.action(key("Tab"));
    focused = "100,90";
    for (const letter of "hunter2-super-secret") await view.action(key(letter));
    await view.action(click(100, 130));
    const stopped = await view.action({ type: "record-stop" });
    const steps = stopped.steps as Array<Record<string, unknown>>;
    expect(steps.map((step) => step.kind)).toEqual(["open", "click", "type", "press", "type", "click"]);
    expect(steps[0]!.url).toBe("https://shop.example/login?next=%2Fcart&token=REDACTED");
    expect(steps[2]).toMatchObject({ kind: "type", text: "owner@example.com", target: { role: "textbox", name: "Email" } });
    expect(steps[3]).toMatchObject({ kind: "press", key: "Tab" });
    expect(steps[4]).toMatchObject({ kind: "type", secret: true, target: { name: "Password" } });
    expect(steps[4]).not.toHaveProperty("text");
    expect(steps[5]).toMatchObject({ kind: "click", target: { role: "button", name: "Sign in" } });
    expect(JSON.stringify(stopped)).not.toContain("hunter2");
    // stopping hands the steps over once: the recording is gone
    expect(await view.action({ type: "record-stop" })).toEqual({ ok: true, steps: [], expired: true });
    expect(live.teach.size).toBe(0);
  });

  it("records nothing the person does not do while recording, and nothing of a discarded one", async () => {
    const view = await open();
    await view.action(click(100, 50));
    await view.action({ type: "record-start" });
    await view.action(click(100, 130));
    await view.action({ type: "record-discard" });
    expect(await view.action({ type: "record-stop" })).toMatchObject({ steps: [], expired: true });
    // only the one click while recording asked the page anything
    expect(execute.mock.calls.filter(([, args]) => args[0] === "eval")).toHaveLength(1);
  });

  it("belongs to one person: another person's view neither sees nor feeds it", async () => {
    const mine = await open("person-a");
    await mine.action({ type: "record-start" });
    held.clear();
    const theirs = await open("person-b");
    await theirs.action(click(100, 130));
    expect(await theirs.action({ type: "record-stop" })).toMatchObject({ steps: [], expired: true });
    expect(live.teach.stop("person-a", "profile-a")).toEqual([]);
  });

  it("is dropped when the person signs out", async () => {
    const view = await open();
    await view.action({ type: "record-start" });
    live.closeForOwner("person-a");
    expect(live.teach.size).toBe(0);
  });

  it("a preview cannot record", async () => {
    const res = new ResponseFixture();
    await live.open({ botId: "bot-a", session: "profile-a", owner: "person-a", isCurrent: () => true, res: res as unknown as ServerResponse, preview: true,
      spec: { command: "/trusted/agent-browser", env: {} } });
    await expect(live.action({ viewerId: res.id, botId: "bot-a", owner: "person-a", body: { type: "record-start" } })).rejects.toThrow(/view-only/);
  });
});

describe("teach recorder masking", () => {
  it("never keeps text from a field it could not inspect, or text that reads as a credential", () => {
    const recorder = new TeachRecorder();
    recorder.beginTyping(null);
    recorder.type("anything at all");
    recorder.beginTyping(parseDescribedElement({ url: "https://a.example/", tag: "input", role: "textbox", name: "Note" }));
    recorder.type("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature");
    recorder.beginTyping(parseDescribedElement({ url: "https://a.example/", tag: "input", role: "textbox", name: "Code", autocomplete: "one-time-code" }));
    recorder.type("123456");
    recorder.beginTyping(parseDescribedElement({ url: "https://a.example/", tag: "input", role: "textbox", name: "Search" }));
    recorder.type("blue shoes");
    recorder.backspace();
    const steps = recorder.finish();
    expect(steps.map((step) => [step.secret === true, step.text])).toEqual([[true, undefined], [true, undefined], [true, undefined], [false, "blue shoe"]]);
    expect(JSON.stringify(steps)).not.toMatch(/anything|eyJ|123456/);
  });

  it("keys pressed with no field focused are no step", () => {
    const recorder = new TeachRecorder();
    recorder.beginTyping(parseDescribedElement({ url: "https://a.example/" }));
    recorder.type("j");
    expect(recorder.finish()).toEqual([]);
  });

  it("the page script reads names and field kinds, never a value", () => {
    const script = teachDescribeScript({ x: 10.4, y: 20.6 });
    expect(script).toContain("const at = [10, 21]");
    expect(script).not.toMatch(/\.value\b/);
    expect(teachDescribeScript()).toContain("document.activeElement");
  });

  it("drops a recording left idle", () => {
    const recordings = new TeachRecordings();
    const recorder = recordings.start("p", "s");
    expect(recordings.get("p", "s")).toBe(recorder);
    expect(recordings.get("p", "s", recorder.touchedAt + TEACH_IDLE_MS + 1)).toBeUndefined();
    expect(recordings.size).toBe(0);
  });
});

describe("teach recording lifetime", () => {
  it("survives a reconnect but not a closed window", async () => {
    const first = await open();
    await first.action({ type: "record-start" });
    first.res.destroy();
    const recorder = live.teach.get("person-a", "profile-a")!;
    expect(recorder.orphanedAt).not.toBeNull();
    const second = await open();
    expect(recorder.orphanedAt).toBeNull();
    second.res.destroy();
    expect(live.teach.get("person-a", "profile-a", recorder.orphanedAt! + TEACH_ORPHAN_MS + 1)).toBeUndefined();
    expect(live.teach.size).toBe(0);
  });
});
