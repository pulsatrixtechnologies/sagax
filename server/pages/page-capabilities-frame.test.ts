// A page with no capabilities block gets exactly today's frame document
// (#3413): the hashes below were taken on origin/main before the bridge
// existed. A page that declares capabilities gets them on window.sagax, and
// still only talks to its parent.
import { createHash } from "node:crypto";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

import { CAP_HELLO_MESSAGE, CAP_MESSAGE, CAP_READY_MESSAGE, CAP_READY_TIMEOUT_MS, CAP_RESULT_MESSAGE, pageCapabilitiesOf } from "../../shared/page-capabilities.ts";
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
    expect(caps).toEqual({ data: ["team-board"], viewer: true, open: false });
    const bridge = stateBridgeSource(caps);
    expect(bridge).not.toBe(STATE_BRIDGE_SOURCE);
    expect(bridge).toContain(`var C={"data":["team-board"],"viewer":true,"open":false}`);
    expect(bridge).toContain("Object.assign({page:Object.freeze(page)},caps)");
    expect(bridge).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket|window\.top/);
    const reading = pageDocument({ kind: "html", title: "T", content: html, lang: "en" }, { nonce: "n0nce", reportSize: true, font: "", capabilities: caps });
    expect(reading).toContain(bridge);
    const preview = pageDocument({ kind: "html", title: "T", content: html, lang: "en" }, { nonce: "n0nce", font: "", capabilities: caps });
    expect(preview).toContain(capabilityBridgeSource(caps));
  });

  it("ignores a wildcard or an unknown name", () => {
    expect(pageCapabilitiesOf(`<script type="application/sagax-capabilities+json">{"data":["*","team-*"]}</script>`)).toEqual({ data: [], viewer: false, open: false });
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
  const caps = { data: ["team-board" as const], viewer: true, open: false };

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
      const caught = pending.catch((error: { code?: string }) => error.code);
      vi.advanceTimersByTime(CAP_READY_TIMEOUT_MS + 1);
      await expect(caught).resolves.toBe("unavailable");
    } finally {
      vi.useRealTimers();
    }
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
    relay.deliver(relay.parent, { type: CAP_RESULT_MESSAGE, v: 1, id: 1, ok: true, value: 1 });
    relay.deliver(relay.parent, { type: CAP_MESSAGE, v: 1, id: 3 });
    relay.deliver({}, { type: CAP_RESULT_MESSAGE, v: 1, id: 1, ok: true });
    expect(relay.down).toEqual([{ type: CAP_READY_MESSAGE, v: 1 }, { type: CAP_RESULT_MESSAGE, v: 1, id: 1, ok: true, value: 1 }]);
  });

  it("is in the preview wrapper of a version that declares capabilities only", () => {
    const base = { title: "T", kind: "html" as const, botName: "B", personName: "P", frameUrl: "/pages/preview-frame/x", lang: "en" as const, preview: true };
    expect(wrapperDocument({ ...base, capsRelay: true })).toContain(PREVIEW_CAP_RELAY_SOURCE);
    expect(wrapperDocument(base)).not.toContain(PREVIEW_CAP_RELAY_SOURCE);
    expect(wrapperDocument({ ...base, preview: false, capsRelay: true })).not.toContain(PREVIEW_CAP_RELAY_SOURCE);
  });
});
