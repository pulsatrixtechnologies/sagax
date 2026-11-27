// A page with no capabilities block gets exactly today's frame document
// (#3413): the hashes below were taken on origin/main before the bridge
// existed. A page that declares capabilities gets them on window.sagax, and
// still only talks to its parent.
import { createHash } from "node:crypto";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

import { CAP_EVENT_MESSAGE, CAP_HELLO_MESSAGE, CAP_MESSAGE, CAP_READY_MESSAGE, CAP_RESULT_MESSAGE, CAP_TAKEN_MESSAGE, CAP_WAIT_MS, pageCapabilitiesAny, pageCapabilitiesOf, pageCapabilitiesPersonal, pageCapGranted, parsePageCapabilities, type PageCapCall, type PageCapabilities } from "../../shared/page-capabilities.ts";
import { capabilityBridgeSource, pageDocument, PREVIEW_CAP_RELAY_SOURCE, STATE_BRIDGE_SOURCE, stateBridgeSource, wrapperDocument } from "./published-pages-render.ts";

const HTML = `<!doctype html><html><head><title>t</title></head><body><h1>Board</h1><script>document.body.dataset.x="1"</script></body></html>`;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

describe("page capabilities in the frame", () => {
  it("leaves a page with no block byte identical, reading frame and preview", () => {
    const caps = pageCapabilitiesOf(HTML);
    expect(caps).toBeNull();
    const reading = pageDocument({ kind: "html", title: "T", content: HTML, lang: "en" }, { nonce: "n0nce", reportSize: true, font: "", capabilities: caps });
    const preview = pageDocument({ kind: "html", title: "T", content: HTML, lang: "en" }, { nonce: "n0nce", font: "", capabilities: caps });
    expect(sha(reading)).toBe("3626be6a38b7ced2609ae097f64541cbe505df9274588710e3227f6ea268aa61");
    expect(sha(preview)).toBe("d4d986cf109715594313d65e476e273ebb95b2a37da818ee4415d99a3770bee5");
    expect(stateBridgeSource(null)).toBe(STATE_BRIDGE_SOURCE);
  });

  it("puts the declared capabilities beside the state, posting to the parent only", () => {
    const html = HTML.replace("<body>", `<body><script type="application/sagax-capabilities+json">{ "data": ["team-board", "other"], "viewer": true }</script>`);
    const caps = pageCapabilitiesOf(html)!;
    expect(caps).toEqual({ data: ["team-board"], viewer: true, open: false, files: [] });
    const bridge = stateBridgeSource(caps);
    expect(bridge).not.toBe(STATE_BRIDGE_SOURCE);
    expect(bridge).toContain(`var C={"data":["team-board"],"viewer":true,"open":false,"files":[]}`);
    expect(bridge).toContain("Object.assign({page:Object.freeze(page)},caps)");
    expect(bridge).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket|window\.top/);
    const reading = pageDocument({ kind: "html", title: "T", content: html, lang: "en" }, { nonce: "n0nce", reportSize: true, font: "", capabilities: caps });
    expect(reading).toContain(bridge);
    const preview = pageDocument({ kind: "html", title: "T", content: html, lang: "en" }, { nonce: "n0nce", font: "", capabilities: caps });
    expect(preview).toContain(capabilityBridgeSource(caps));
  });

  it("ignores a wildcard or an unknown name", () => {
    expect(pageCapabilitiesOf(`<script type="application/sagax-capabilities+json">{"data":["*","team-*"]}</script>`)).toEqual({ data: [], viewer: false, open: false, files: [] });
  });
});

// The bridge's code run in a bare context: its window, its parent, timers.
function runBridge(source: string) {
  const listeners: Array<(event: { source: unknown; data: unknown }) => void> = [];
  const posted: unknown[] = [];
  const parent = { postMessage: (message: unknown) => { posted.push(message); } };
  const win: Record<string, unknown> = { parent, addEventListener: (_type: string, fn: (event: { source: unknown; data: unknown }) => void) => listeners.push(fn) };
  win.window = win;
  vm.runInNewContext(source, { window: win, parent, Promise, Error, Object, JSON, setTimeout, clearTimeout, String, Number });
  return { win, parent, posted, deliver: (from: unknown, data: unknown) => listeners.forEach((fn) => fn({ source: from, data })) };
}

describe("capability handshake (#3413 lot 1b)", () => {
  const caps = { data: ["team-board" as const], viewer: true, open: false, files: [] };

  it("says hello, queues calls until the wrapper is ready, then sends them", async () => {
    const bridge = runBridge(capabilityBridgeSource(caps));
    expect(bridge.posted).toEqual([{ type: CAP_HELLO_MESSAGE, v: 1 }]);
    const sagax = bridge.win.sagax as { data: { read(name: string): Promise<unknown> } };
    const pending = sagax.data.read("team-board");
    expect(bridge.posted).toHaveLength(1);
    bridge.deliver(bridge.parent, { type: CAP_READY_MESSAGE, v: 1 });
    expect(bridge.posted[1]).toMatchObject({ type: CAP_MESSAGE, v: 1, id: 1, cap: "data.read", args: { name: "team-board" } });
    bridge.deliver(bridge.parent, { type: CAP_RESULT_MESSAGE, v: 1, id: 1, ok: true, value: { lanes: [] } });
    await expect(pending).resolves.toEqual({ lanes: [] });
  });

  it("fails a queued call with code unavailable when the wrapper never answers", async () => {
    vi.useFakeTimers();
    try {
      const bridge = runBridge(capabilityBridgeSource(caps));
      const sagax = bridge.win.sagax as { viewer: { get(): Promise<unknown> } };
      const pending = sagax.viewer.get();
      const caught = pending.catch((error: { code?: string; message?: string }) => ({ code: error.code, message: error.message }));
      vi.advanceTimersByTime(CAP_WAIT_MS + 1);
      // no wrapper at all (a page opened outside the reader): nothing to update
      await expect(caught).resolves.toEqual({ code: "unavailable", message: "The page's wrapper did not answer." });
    } finally {
      vi.useRealTimers();
    }
  });

  it("#3657: a ready without taken (a released app) keeps a sent call's unbounded wait", async () => {
    vi.useFakeTimers();
    try {
      const bridge = runBridge(capabilityBridgeSource(caps));
      const sagax = bridge.win.sagax as { data: { read(name: string): Promise<unknown> } };
      // one queued before ready, one sent after it
      const queued = sagax.data.read("team-board");
      bridge.deliver(bridge.parent, { type: CAP_READY_MESSAGE, v: 1 });
      const sent = sagax.data.read("team-board");
      vi.advanceTimersByTime(CAP_WAIT_MS * 2);
      bridge.deliver(bridge.parent, { type: CAP_RESULT_MESSAGE, v: 1, id: 1, ok: true, value: 1 });
      bridge.deliver(bridge.parent, { type: CAP_RESULT_MESSAGE, v: 1, id: 2, ok: true, value: 2 });
      await expect(queued).resolves.toBe(1);
      await expect(sent).resolves.toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("#3657: a ready without taken (an app that predates files.download) still bounds files.download", async () => {
    vi.useFakeTimers();
    try {
      const bridge = runBridge(capabilityBridgeSource({ ...caps, files: ["download" as const] }));
      bridge.deliver(bridge.parent, { type: CAP_READY_MESSAGE, v: 1 });
      const sagax = bridge.win.sagax as { files: { download(file: unknown): Promise<unknown> } };
      let settled: unknown;
      let message = "";
      // such an app drops a call it does not know: no answer ever comes
      sagax.files.download({ name: "a.txt", mime: "text/plain", data: "aGk=" }).then((value) => { settled = { value }; }, (error: { code?: string; message?: string }) => { settled = error.code; message = String(error.message); });
      expect(bridge.posted.at(-1)).toMatchObject({ type: CAP_MESSAGE, id: 1, cap: "files.download" });
      vi.advanceTimersByTime(CAP_WAIT_MS - 1);
      await Promise.resolve();
      expect(settled).toBeUndefined();
      vi.advanceTimersByTime(2);
      await Promise.resolve();
      expect(settled).toBe("unavailable");
      expect(message).toMatch(/Update the app/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("#3657: a call after ready that nobody takes settles unavailable after one bounded wait", async () => {
    vi.useFakeTimers();
    try {
      const bridge = runBridge(capabilityBridgeSource({ ...caps, files: ["download" as const] }));
      bridge.deliver(bridge.parent, { type: CAP_READY_MESSAGE, v: 1, taken: true });
      const sagax = bridge.win.sagax as { files: { download(file: unknown): Promise<unknown> } };
      let settled: unknown;
      let message = "";
      // an older wrapper drops a call it does not know: no taken, no answer
      sagax.files.download({ name: "a.txt", mime: "text/plain", data: "aGk=" }).then((value) => { settled = { value }; }, (error: { code?: string; message?: string }) => { settled = error.code; message = String(error.message); });
      expect(bridge.posted.at(-1)).toMatchObject({ type: CAP_MESSAGE, id: 1, cap: "files.download" });
      vi.advanceTimersByTime(CAP_WAIT_MS - 1);
      await Promise.resolve();
      expect(settled).toBeUndefined();
      vi.advanceTimersByTime(2);
      await Promise.resolve();
      expect(settled).toBe("unavailable");
      expect(message).toMatch(/Update the app/);
      // its late answer changes nothing
      bridge.deliver(bridge.parent, { type: CAP_RESULT_MESSAGE, v: 1, id: 1, ok: true, value: true });
      await Promise.resolve();
      expect(settled).toBe("unavailable");
    } finally {
      vi.useRealTimers();
    }
  });

  it("#3657: a call the wrapper took waits for its answer past the wait (an Ask first card)", async () => {
    vi.useFakeTimers();
    try {
      const bridge = runBridge(capabilityBridgeSource(caps));
      const sagax = bridge.win.sagax as { data: { read(name: string): Promise<unknown> } };
      // queued before ready: the wait starts again when it is sent
      const pending = sagax.data.read("team-board");
      vi.advanceTimersByTime(CAP_WAIT_MS - 1);
      bridge.deliver(bridge.parent, { type: CAP_READY_MESSAGE, v: 1, taken: true });
      expect(bridge.posted.at(-1)).toMatchObject({ type: CAP_MESSAGE, id: 1 });
      vi.advanceTimersByTime(CAP_WAIT_MS - 1);
      bridge.deliver(bridge.parent, { type: CAP_TAKEN_MESSAGE, v: 1, id: 1 });
      vi.advanceTimersByTime(CAP_WAIT_MS * 10);
      bridge.deliver(bridge.parent, { type: CAP_RESULT_MESSAGE, v: 1, id: 1, ok: true, value: { lanes: [] } });
      await expect(pending).resolves.toEqual({ lanes: [] });
      // a taken from anyone but the parent does not stop the wait
      const other = sagax.data.read("team-board").catch((error: { code?: string }) => error.code);
      bridge.deliver({}, { type: CAP_TAKEN_MESSAGE, v: 1, id: 2 });
      vi.advanceTimersByTime(CAP_WAIT_MS + 1);
      await expect(other).resolves.toBe("unavailable");
    } finally {
      vi.useRealTimers();
    }
  });

  it("hands the page who refused a denied read (#3449)", async () => {
    const bridge = runBridge(capabilityBridgeSource(caps));
    bridge.deliver(bridge.parent, { type: CAP_READY_MESSAGE, v: 1 });
    const sagax = bridge.win.sagax as { data: { read(name: string, params?: unknown): Promise<unknown> } };
    const caught = sagax.data.read("team-board", { team: "t1" }).catch((error: { code?: string; reason?: string; message?: string }) => ({ code: error.code, reason: error.reason, message: error.message }));
    expect(bridge.posted.at(-1)).toMatchObject({ type: CAP_MESSAGE, id: 1, cap: "data.read", args: { name: "team-board", params: { team: "t1" } } });
    bridge.deliver(bridge.parent, { type: CAP_RESULT_MESSAGE, v: 1, id: 1, ok: false, error: "denied", reason: "declined", message: "You declined this read." });
    await expect(caught).resolves.toEqual({ code: "denied", reason: "declined", message: "You declined this read." });
  });

  it("reads a subscription again with its own parameters on a data event (#3449)", () => {
    const bridge = runBridge(capabilityBridgeSource(caps));
    bridge.deliver(bridge.parent, { type: CAP_READY_MESSAGE, v: 1 });
    const sagax = bridge.win.sagax as { data: { subscribe(name: string, fn: (value: unknown) => void, params?: unknown): () => void } };
    sagax.data.subscribe("team-board", () => {}, { team: "t1" });
    sagax.data.subscribe("team-board", () => {});
    bridge.deliver(bridge.parent, { type: "sagax-cap-event", v: 1, cap: "data", name: "team-board" });
    const reads = bridge.posted.filter((message) => (message as { type?: string }).type === CAP_MESSAGE);
    expect(reads.map((message) => (message as { args: unknown }).args)).toEqual([{ name: "team-board", params: { team: "t1" } }, { name: "team-board", params: {} }]);
  });

  it("ignores a ready or a result from anyone but its parent", () => {
    const bridge = runBridge(capabilityBridgeSource(caps));
    (bridge.win.sagax as { data: { read(name: string): Promise<unknown> } }).data.read("team-board").catch(() => {});
    bridge.deliver({}, { type: CAP_READY_MESSAGE, v: 1 });
    expect(bridge.posted).toHaveLength(1);
  });
});

describe("the app preview's relay (#3413 lot 1b)", () => {
  function runRelay() {
    const listeners: Array<(event: { source: unknown; data: unknown }) => void> = [];
    const up: unknown[] = [];
    const down: unknown[] = [];
    const frameWindow = { postMessage: (message: unknown) => { down.push(message); } };
    const parent = { postMessage: (message: unknown) => { up.push(message); } };
    const context = { parent, window: {}, document: { querySelector: () => ({ contentWindow: frameWindow }) }, addEventListener: (_type: string, fn: (event: { source: unknown; data: unknown }) => void) => listeners.push(fn) };
    vm.runInNewContext(PREVIEW_CAP_RELAY_SOURCE, context);
    return { up, down, frameWindow, parent, deliver: (from: unknown, data: unknown) => listeners.forEach((fn) => fn({ source: from, data })) };
  }

  it("carries calls up from its own frame and answers down from the app, nothing else", () => {
    const relay = runRelay();
    relay.deliver(relay.frameWindow, { type: CAP_HELLO_MESSAGE, v: 1 });
    relay.deliver(relay.frameWindow, { type: CAP_MESSAGE, v: 1, id: 1, cap: "data.read" });
    relay.deliver(relay.frameWindow, { type: CAP_RESULT_MESSAGE, v: 1, id: 1, ok: true });
    relay.deliver({}, { type: CAP_MESSAGE, v: 1, id: 2, cap: "data.read" });
    expect(relay.up).toEqual([{ type: CAP_HELLO_MESSAGE, v: 1 }, { type: CAP_MESSAGE, v: 1, id: 1, cap: "data.read" }]);
    relay.deliver(relay.parent, { type: CAP_READY_MESSAGE, v: 1 });
    relay.deliver(relay.parent, { type: CAP_TAKEN_MESSAGE, v: 1, id: 1 });
    relay.deliver(relay.parent, { type: CAP_RESULT_MESSAGE, v: 1, id: 1, ok: true, value: 1 });
    relay.deliver(relay.parent, { type: CAP_MESSAGE, v: 1, id: 3 });
    relay.deliver({}, { type: CAP_RESULT_MESSAGE, v: 1, id: 1, ok: true });
    relay.deliver(relay.frameWindow, { type: CAP_TAKEN_MESSAGE, v: 1, id: 1 });
    expect(relay.down).toEqual([{ type: CAP_READY_MESSAGE, v: 1 }, { type: CAP_TAKEN_MESSAGE, v: 1, id: 1 }, { type: CAP_RESULT_MESSAGE, v: 1, id: 1, ok: true, value: 1 }]);
  });

  it("is in the preview wrapper of a version that declares capabilities only", () => {
    const base = { title: "T", kind: "html" as const, botName: "B", personName: "P", frameUrl: "/pages/preview-frame/x", lang: "en" as const, preview: true };
    expect(wrapperDocument({ ...base, capsRelay: true })).toContain(PREVIEW_CAP_RELAY_SOURCE);
    expect(wrapperDocument(base)).not.toContain(PREVIEW_CAP_RELAY_SOURCE);
    expect(wrapperDocument({ ...base, preview: false, capsRelay: true })).not.toContain(PREVIEW_CAP_RELAY_SOURCE);
  });
});

describe("files.download in the frame", () => {
  const downloadCall = "files.download" as PageCapCall;

  it("parses files, drops unknown names, and grants only download", () => {
    const html = `<script type="application/sagax-capabilities+json">{ "files": ["download"] }</script>`;
    expect(pageCapabilitiesOf(html)).toEqual({ data: [], viewer: false, open: false, files: ["download"] });
    // lot 5 (#3413) made "add" a known name on purpose: "upload" stays unknown
    expect(parsePageCapabilities({ files: ["download", "upload", "nope"] })).toEqual({ data: [], viewer: false, open: false, files: ["download"] });
    expect(parsePageCapabilities({ data: ["team-board"], viewer: true })).toEqual({ data: ["team-board"], viewer: true, open: false, files: [] });
    expect(parsePageCapabilities({})).toEqual({ data: [], viewer: false, open: false, files: [] });

    const filesOnly = parsePageCapabilities({ files: ["download"] })!;
    const openOnly = parsePageCapabilities({ open: true, files: ["nope"] })!;
    const dataOnly = parsePageCapabilities({ data: ["team-board"] })!;
    expect(pageCapabilitiesAny(filesOnly)).toBe(true);
    expect(pageCapabilitiesAny(parsePageCapabilities({ files: ["nope"] }))).toBe(false);
    expect(pageCapGranted(filesOnly, downloadCall)).toBe(true);
    expect(pageCapGranted(openOnly, downloadCall)).toBe(false);
    expect(pageCapGranted(parsePageCapabilities({ files: [] }), downloadCall)).toBe(false);
    expect(pageCapabilitiesPersonal(filesOnly)).toBe(false);
    expect(pageCapabilitiesPersonal(dataOnly)).toBe(true);
  });

  it("injects files.download with userActivation and freezes files last", () => {
    const caps = { data: [], viewer: false, open: false, files: ["download"] } as PageCapabilities;
    const frozen = '{"data":[],"viewer":false,"open":false,"files":["download"]}';
    for (const source of [stateBridgeSource(caps), capabilityBridgeSource(caps)]) {
      expect(source).toContain("files.download");
      expect(source).toContain("userActivation");
      expect(source).toContain(frozen);
    }
  });
});

describe("store in the frame (#3413 lot 3)", () => {
  it("reads a store declaration: names, levels and scopes, nothing else", () => {
    expect(parsePageCapabilities({ store: ["votes", "Bad Name", "votes"] })).toEqual({ data: [], viewer: false, open: false, files: [], store: { votes: { write: "signed_in", scope: "shared" } } });
    expect(parsePageCapabilities({ store: { prefs: { scope: "reader" }, decisions: "editors", odd: { scope: "everyone" }, bad: "root" } })!.store).toEqual({
      prefs: { write: "signed_in", scope: "reader" },
      decisions: { write: "editors", scope: "shared" },
    });
    expect(parsePageCapabilities({ store: {} })).toEqual({ data: [], viewer: false, open: false, files: [] });
    const many = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`c${i}`, true]));
    expect(Object.keys(parsePageCapabilities({ store: many })!.store!)).toHaveLength(20);
    expect(pageCapabilitiesAny({ data: [], viewer: false, open: false, files: [], store: { votes: { write: "signed_in", scope: "shared" } } })).toBe(true);
    expect(pageCapGranted({ data: [], viewer: false, open: false, files: [], store: { votes: { write: "signed_in", scope: "shared" } } }, "store.put", "votes")).toBe(true);
    expect(pageCapGranted({ data: [], viewer: false, open: false, files: [], store: { votes: { write: "signed_in", scope: "shared" } } }, "store.put", "other")).toBe(false);
  });

  it("gives the page store.collection(name), and reads a collection again on the wrapper's store event", async () => {
    const caps = { data: [], viewer: false, open: false, files: [], store: { votes: { write: "signed_in" as const, scope: "shared" as const } } };
    const bridge = runBridge(capabilityBridgeSource(caps));
    bridge.deliver(bridge.parent, { type: CAP_READY_MESSAGE, v: 1, taken: true });
    const sagax = bridge.win.sagax as { capabilities: { store: string[] }; store: { collection(name: string): { put(id: unknown, value: unknown): Promise<unknown>; subscribe(fn: (docs: unknown) => void, q?: unknown): () => void } } };
    expect(sagax.capabilities.store).toEqual(["votes"]);
    const votes = sagax.store.collection("votes");
    void votes.put(null, { pick: 1 });
    expect(bridge.posted.at(-1)).toMatchObject({ type: CAP_MESSAGE, cap: "store.put", args: { collection: "votes", id: null, value: { pick: 1 } } });
    const seen: unknown[] = [];
    votes.subscribe((docs) => seen.push(docs), { limit: 5 });
    bridge.deliver(bridge.parent, { type: "sagax-cap-event", v: 1, cap: "store", name: "votes" });
    const asked = bridge.posted.at(-1) as { id: number; cap: string; args: unknown };
    expect(asked).toMatchObject({ cap: "store.list", args: { collection: "votes", query: { limit: 5 } } });
    bridge.deliver(bridge.parent, { type: CAP_RESULT_MESSAGE, v: 1, id: asked.id, ok: true, value: [{ id: "d1" }] });
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual([[{ id: "d1" }]]);
  });
});

describe("model.ask in the frame (#3413 lot 4)", () => {
  it("is declared by model: true only, and gives the page sagax.model.ask", () => {
    expect(parsePageCapabilities({ model: true })).toEqual({ data: [], viewer: false, open: false, files: [], model: true });
    expect(parsePageCapabilities({ model: "yes" })).toEqual({ data: [], viewer: false, open: false, files: [] });
    const caps = { data: [], viewer: false, open: false, files: [], model: true as const };
    expect(pageCapGranted(caps, "model.ask")).toBe(true);
    expect(pageCapGranted({ ...caps, model: undefined }, "model.ask")).toBe(false);
    const bridge = runBridge(capabilityBridgeSource(caps));
    bridge.deliver(bridge.parent, { type: CAP_READY_MESSAGE, v: 1, taken: true });
    const sagax = bridge.win.sagax as { model: { ask(question: unknown): Promise<unknown> } };
    void sagax.model.ask({ prompt: "Hi", schema: { type: "string" } });
    expect(bridge.posted.at(-1)).toMatchObject({ type: CAP_MESSAGE, cap: "model.ask", args: { prompt: "Hi", schema: { type: "string" } } });
  });
});

describe("files added by readers in the frame (#3413 lot 5)", () => {
  it("reads files: add, and gives the page add, list, get and remove", () => {
    expect(parsePageCapabilities({ files: ["add", "download", "other"] })).toEqual({ data: [], viewer: false, open: false, files: ["add", "download"] });
    const caps = { data: [], viewer: false, open: false, files: ["add" as const] };
    expect(pageCapGranted(caps, "files.list")).toBe(true);
    expect(pageCapGranted(caps, "files.download")).toBe(false);
    expect(pageCapGranted({ ...caps, files: ["download" as const] }, "files.add")).toBe(false);
    const bridge = runBridge(capabilityBridgeSource(caps));
    bridge.deliver(bridge.parent, { type: CAP_READY_MESSAGE, v: 1, taken: true });
    const sagax = bridge.win.sagax as { files: { add(): Promise<unknown>; list(): Promise<unknown>; get(id: string): Promise<unknown>; remove(id: string): Promise<unknown> } };
    void sagax.files.add();
    expect(bridge.posted.at(-1)).toMatchObject({ type: CAP_MESSAGE, cap: "files.add", gesture: false });
    void sagax.files.get("abc");
    expect(bridge.posted.at(-1)).toMatchObject({ cap: "files.get", args: { id: "abc" } });
    void sagax.files.remove("abc");
    expect(bridge.posted.at(-1)).toMatchObject({ cap: "files.remove", args: { id: "abc" } });
  });
});

describe("page.bot in the frame (#5461)", () => {
  const caps = { data: ["bot" as const], viewer: false, open: false, files: [] };

  it("accepts bot as a source and aliases page.bot to data.read and data.subscribe", async () => {
    expect(parsePageCapabilities({ data: ["bot", "nope", "team-board"] })).toEqual({ data: ["bot", "team-board"], viewer: false, open: false, files: [] });
    expect(stateBridgeSource(caps)).toContain("Object.assign({page:Object.freeze(Object.assign(page,{bot:pageBot}))},caps)");
    expect(stateBridgeSource({ data: ["team-board"], viewer: false, open: false, files: [] })).not.toContain("pageBot");
    expect(stateBridgeSource({ ...caps, propose: true })).toContain("Object.assign(page,{propose:cpropose,bot:pageBot})");
    const bridge = runBridge(capabilityBridgeSource(caps));
    bridge.deliver(bridge.parent, { type: CAP_READY_MESSAGE, v: 1, taken: true });
    const sagax = bridge.win.sagax as { page: { bot: { (): Promise<unknown>; subscribe(fn: (value: unknown) => void): () => void } } };
    const pending = sagax.page.bot();
    expect(bridge.posted.at(-1)).toMatchObject({ type: CAP_MESSAGE, cap: "data.read", args: { name: "bot", params: {} } });
    bridge.deliver(bridge.parent, { type: CAP_RESULT_MESSAGE, v: 1, id: 1, ok: true, value: { name: "Nimbus" } });
    await expect(pending).resolves.toEqual({ name: "Nimbus" });
    const seen: unknown[] = [];
    sagax.page.bot.subscribe((value) => { seen.push(value); });
    bridge.deliver(bridge.parent, { type: CAP_EVENT_MESSAGE, v: 1, cap: "data", name: "bot" });
    const again = bridge.posted.at(-1) as { id: number };
    expect(again).toMatchObject({ cap: "data.read", args: { name: "bot", params: {} } });
    bridge.deliver(bridge.parent, { type: CAP_RESULT_MESSAGE, v: 1, id: again.id, ok: true, value: { name: "Nimbus", activity: "idle" } });
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual([{ name: "Nimbus", activity: "idle" }]);
  });
});

describe("page.propose in the frame (#3413 lot 6)", () => {
  const caps = { data: [], viewer: false, open: false, files: [], propose: true as const };

  it("puts propose on page, beside the state's own calls in a reading frame", () => {
    expect(parsePageCapabilities({ propose: true })).toEqual({ data: [], viewer: false, open: false, files: [], propose: true });
    expect(pageCapGranted(caps, "page.propose")).toBe(true);
    expect(stateBridgeSource(caps)).toContain("Object.assign({page:Object.freeze(Object.assign(page,{propose:cpropose}))},caps)");
    // a version that does not declare it keeps the state's page as it was
    expect(stateBridgeSource({ ...caps, propose: undefined, viewer: true })).toContain("Object.assign({page:Object.freeze(page)},caps)");
  });

  it("gives the app's preview sagax.page.propose, which posts the content", () => {
    const bridge = runBridge(capabilityBridgeSource(caps));
    bridge.deliver(bridge.parent, { type: CAP_READY_MESSAGE, v: 1, taken: true });
    const sagax = bridge.win.sagax as { page: { propose(input: unknown): Promise<unknown> } };
    void sagax.page.propose("<p>v2</p>");
    expect(bridge.posted.at(-1)).toMatchObject({ type: CAP_MESSAGE, cap: "page.propose", args: { content: "<p>v2</p>" } });
    void sagax.page.propose({ content: "<p>v3</p>", title: "T" });
    expect(bridge.posted.at(-1)).toMatchObject({ cap: "page.propose", args: { content: "<p>v3</p>", title: "T" } });
  });
});

describe("connector.call in the frame (#3413 lot 7)", () => {
  it("reads connectors and tools by exact name, no wildcard, and counts them as personal data", () => {
    const caps = parsePageCapabilities({ connectors: { GitHub: ["create_issue", "create_issue", "*"], "*": ["x"], " Padded": ["x"], Empty: [] } })!;
    expect(caps.connectors).toEqual({ GitHub: ["create_issue"] });
    expect(pageCapGranted(caps, "connector.call", "GitHub", "create_issue")).toBe(true);
    expect(pageCapGranted(caps, "connector.call", "GitHub", "delete_repo")).toBe(false);
    expect(pageCapGranted(caps, "connector.call", "github", "create_issue")).toBe(false);
    expect(pageCapabilitiesPersonal(caps)).toBe(true);
    expect(pageCapabilitiesPersonal(parsePageCapabilities({ store: ["votes"], model: true }))).toBe(false);
  });

  it("gives the page sagax.connector.call with whether it came from a click", () => {
    const caps = { data: [], viewer: false, open: false, files: [], connectors: { GitHub: ["create_issue"] } };
    const bridge = runBridge(capabilityBridgeSource(caps));
    bridge.deliver(bridge.parent, { type: CAP_READY_MESSAGE, v: 1, taken: true });
    const sagax = bridge.win.sagax as { capabilities: { connectors: unknown }; connector: { call(c: string, t: string, a: unknown): Promise<unknown> } };
    expect(sagax.capabilities.connectors).toEqual({ GitHub: ["create_issue"] });
    void sagax.connector.call("GitHub", "create_issue", { title: "x" });
    expect(bridge.posted.at(-1)).toMatchObject({ type: CAP_MESSAGE, cap: "connector.call", args: { connector: "GitHub", tool: "create_issue", arguments: { title: "x" } }, gesture: false });
  });
});
