// The wrapper's broker for a page's capabilities (src/page-reader/capabilities.ts).
import { describe, expect, it, vi } from "vitest";

import { CAP_EVENT_MESSAGE, CAP_HELLO_MESSAGE, CAP_MESSAGE, CAP_READY_MESSAGE, CAP_RESULT_MESSAGE } from "../../shared/page-capabilities";
import { PAGE_OPEN_MESSAGE } from "../../shared/published-pages";
import { capFailure, createCapabilityBroker, fromPageFrame, parseDataEvent, type BrokerDeps } from "./capabilities";

const CAPS = { capabilities: { data: ["team-board"], viewer: true, open: true }, reads: [{ name: "team-board", label: "The work of your coding teams" }] };
const BOARD = { name: "team-board", value: { lanes: [] }, at: 1, links: ["https://github.com/o/r/pull/1"], refs: ["thread:bot1:th1"] };

class Refusal extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly body?: Record<string, unknown>) { super(message); }
}

function setup(over: Partial<BrokerDeps> = {}, routes: Record<string, unknown | (() => unknown)> = {}) {
  const sent: Record<string, unknown>[] = [];
  const frame = { postMessage: vi.fn((message: Record<string, unknown>) => { sent.push(message); }) } as unknown as Window;
  const calls: string[] = [];
  const posts: { path: string; body: unknown }[] = [];
  const api = vi.fn(async (path: string, init?: { method: string; body: unknown }) => {
    calls.push(path);
    if (init) posts.push({ path, body: init.body });
    const key = Object.keys(routes).filter((route) => path.startsWith(route)).sort((a, b) => b.length - a.length)[0];
    if (!key) throw new Refusal("nope", 404, "not_found");
    const value = routes[key];
    const out = typeof value === "function" ? (value as () => unknown)() : value;
    if (out instanceof Error) throw out;
    return out;
  });
  const openUrl = vi.fn();
  const openRef = vi.fn(() => true);
  const broker = createCapabilityBroker({
    frame: () => frame,
    api: api as unknown as BrokerDeps["api"],
    pageId: "page_12345678",
    signedIn: true,
    lang: "en",
    openUrl,
    openRef,
    ...over,
  });
  const call = (cap: string, args: Record<string, unknown> = {}, id = 1, event: { source?: unknown; origin?: string } = {}) =>
    broker.onMessage({ source: frame, origin: "null", ...event, data: { type: CAP_MESSAGE, v: 1, id, cap, args } });
  const result = (id = 1) => sent.find((message) => message.type === CAP_RESULT_MESSAGE && message.id === id);
  return { broker, frame, sent, calls, posts, api, openUrl, openRef, call, result };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const ROUTES = { "/api/pages/page_12345678/capabilities": CAPS, "/api/pages/page_12345678/data/team-board": BOARD, "/api/pages/page_12345678/viewer": { name: "Ada", handle: "h1", role: "owner", lang: "en" } };

describe("the page's frame is the only one heard", () => {
  it("needs the very frame window and the sandbox's opaque origin", () => {
    const frame = {} as Window;
    expect(fromPageFrame({ source: frame, origin: "null" }, frame)).toBe(true);
    expect(fromPageFrame({ source: {}, origin: "null" }, frame)).toBe(false);
    expect(fromPageFrame({ source: frame, origin: "https://evil.example" }, frame)).toBe(false);
    expect(fromPageFrame({ source: frame, origin: "null" }, null)).toBe(false);
  });

  it("ignores a message of another frame or origin: no answer, no request", async () => {
    const { call, sent, api } = setup({}, ROUTES);
    expect(await call("data.read", { name: "team-board" }, 1, { source: {} })).toBe(false);
    expect(await call("data.read", { name: "team-board" }, 2, { origin: "https://app.example" })).toBe(false);
    expect(sent).toEqual([]);
    expect(api).not.toHaveBeenCalled();
  });

  it("ignores a message that is not a well-formed call", async () => {
    const { broker, frame, sent } = setup({}, ROUTES);
    for (const data of [null, "x", { type: CAP_MESSAGE, v: 2, id: 1, cap: "data.read" }, { type: CAP_MESSAGE, v: 1, id: -1, cap: "data.read" }, { type: CAP_MESSAGE, v: 1, id: 1, cap: "model.ask" }]) {
      expect(await broker.onMessage({ source: frame, origin: "null", data })).toBe(false);
    }
    expect(sent).toEqual([]);
  });
});

describe("a reader who is not signed in", () => {
  it("gets sign_in for every call and nothing leaves for the server", async () => {
    const { call, result, api } = setup({ pageId: undefined, signedIn: false }, ROUTES);
    for (const [index, cap] of (["data.read", "viewer.get", "open"] as const).entries()) {
      await call(cap, { name: "team-board", ref: "bot:b1" }, index + 1);
      expect(result(index + 1)).toMatchObject({ v: 1, ok: false, error: "sign_in" });
    }
    expect(api).not.toHaveBeenCalled();
  });

  it("signed in with no right on the page: not found, still no request", async () => {
    const { call, result, api } = setup({ pageId: undefined, signedIn: true }, ROUTES);
    await call("viewer.get");
    expect(result()).toMatchObject({ ok: false, error: "not_found" });
    expect(api).not.toHaveBeenCalled();
  });
});

describe("data and viewer", () => {
  it("reads with the reader's own session and hands the page the value only", async () => {
    const { call, result, calls } = setup({}, ROUTES);
    await call("data.read", { name: "team-board", params: {} });
    expect(result()).toEqual({ v: 1, type: CAP_RESULT_MESSAGE, id: 1, ok: true, value: { lanes: [] } });
    expect(calls).toEqual(["/api/pages/page_12345678/capabilities?lang=en", "/api/pages/page_12345678/data/team-board?lang=en"]);
    await call("viewer.get", {}, 2);
    expect(result(2)).toMatchObject({ ok: true, value: { name: "Ada", role: "owner" } });
    expect(calls.at(-1)).toBe("/api/pages/page_12345678/viewer?lang=en");
  });

  it("asks fresh only when the page's own Refresh does", async () => {
    const { call, calls } = setup({}, ROUTES);
    await call("data.read", { name: "team-board", params: { fresh: true } });
    expect(calls.at(-1)).toBe("/api/pages/page_12345678/data/team-board?fresh=1&lang=en");
  });

  it("refuses a source the server did not grant, without a request", async () => {
    const { call, result, calls } = setup({}, ROUTES);
    await call("data.read", { name: "other" });
    expect(result()).toMatchObject({ ok: false, error: "not_declared" });
    expect(calls.some((path) => path.includes("/data/"))).toBe(false);
  });

  it("refuses a name that is not a name", async () => {
    const { call, result } = setup({}, ROUTES);
    await call("data.read", { name: "../../state" });
    expect(result()).toMatchObject({ ok: false, error: "bad_request" });
  });

  it("a page with no declaration is refused for everything", async () => {
    const { call, result } = setup({}, { ...ROUTES, "/api/pages/page_12345678/capabilities": { capabilities: { data: [], viewer: false, open: false }, reads: [] } });
    await call("viewer.get");
    expect(result()).toMatchObject({ ok: false, error: "not_declared" });
  });

  it("passes the server's refusals to the page by their contract code", async () => {
    const { call, result } = setup({}, { ...ROUTES, "/api/pages/page_12345678/data/team-board": () => new Refusal("Too often.", 429, "rate_limited") });
    await call("data.read", { name: "team-board" });
    expect(result()).toMatchObject({ ok: false, error: "rate_limited", message: "Too often." });
  });

  it("a server that cannot be reached is `unavailable`, with no message of ours", () => {
    expect(capFailure(new TypeError("Failed to fetch"))).toEqual({ error: "unavailable" });
    expect(capFailure({ status: 401 })).toEqual({ error: "sign_in" });
    expect(capFailure({ status: 500, code: "weird", message: "x".repeat(300) }).message).toHaveLength(200);
  });
});

describe("Ask first", () => {
  /** The server: 409 with a card to answer until the reader's answer was posted. */
  function asking() {
    let answered = false;
    return {
      ...ROUTES,
      "/api/pages/page_12345678/data/team-board": () => answered ? BOARD : new Refusal("Ask.", 409, "ask_first", { approvalId: "ap_1", source: "team-board", version: 1 }),
      "/api/pages/page_12345678/data-approvals/ap_1": () => { answered = true; return { ok: true }; },
    };
  }

  it("shows the card, posts the reader's answer to the server, then reads again", async () => {
    const { broker, call, result, calls, posts } = setup({}, asking());
    const pending = call("data.read", { name: "team-board" });
    await flush();
    expect(broker.getState().approvals).toHaveLength(1);
    expect(broker.getState().approvals[0]).toMatchObject({ name: "team-board", label: "The work of your coding teams" });
    expect(posts).toEqual([]);
    broker.resolveApproval(broker.getState().approvals[0]!.id, "once");
    await pending;
    expect(posts).toEqual([{ path: "/api/pages/page_12345678/data-approvals/ap_1?lang=en", body: { answer: "once" } }]);
    expect(calls.at(-1)).toBe("/api/pages/page_12345678/data/team-board?lang=en");
    expect(calls.some((path) => path.includes("approved"))).toBe(false);
    expect(result()).toMatchObject({ ok: true });
    expect(broker.getState().approvals).toEqual([]);
  });

  it("Always allow is sent to the server as `always`, nothing is kept in the browser", async () => {
    const { broker, call, posts, result } = setup({}, asking());
    const pending = call("data.read", { name: "team-board" });
    await flush();
    broker.resolveApproval(broker.getState().approvals[0]!.id, "always");
    await pending;
    expect(posts[0]!.body).toEqual({ answer: "always" });
    expect(result()).toMatchObject({ ok: true });
  });

  it("Decline posts `deny` and answers the page denied", async () => {
    const { broker, call, result, posts } = setup({}, asking());
    const pending = call("data.read", { name: "team-board" });
    await flush();
    broker.resolveApproval(broker.getState().approvals[0]!.id, "decline");
    await pending;
    expect(posts[0]!.body).toEqual({ answer: "deny" });
    expect(result()).toMatchObject({ ok: false, error: "denied" });
  });

  it("two reads of the same source share one card", async () => {
    const { broker, call } = setup({}, asking());
    const first = call("data.read", { name: "team-board" }, 1);
    const second = call("data.read", { name: "team-board" }, 2);
    await flush();
    expect(broker.getState().approvals).toHaveLength(1);
    broker.resolveApproval(broker.getState().approvals[0]!.id, "once");
    await Promise.all([first, second]);
  });

  it("Deny of the organization reaches the page as denied", async () => {
    const { call, result } = setup({}, { ...ROUTES, "/api/pages/page_12345678/data/team-board": () => new Refusal("No.", 403, "denied") });
    await call("data.read", { name: "team-board" });
    expect(result()).toMatchObject({ ok: false, error: "denied" });
  });

  it("a shared-state refusal reaches the page as the server wrote it", async () => {
    const { call, result } = setup({}, { ...ROUTES, "/api/pages/page_12345678/data/team-board": () => new Refusal("Lecture seule.", 409, "shared_write_after_data") });
    await call("data.read", { name: "team-board" });
    expect(result()).toMatchObject({ ok: false, error: "shared_write_after_data", message: "Lecture seule." });
  });
});

describe("ready handshake", () => {
  it("says ready at start and in answer to each hello, from the page's frame only", async () => {
    const { broker, sent, frame } = setup({}, ROUTES);
    await broker.start();
    expect(sent.filter((message) => message.type === CAP_READY_MESSAGE)).toHaveLength(1);
    expect(await broker.onMessage({ source: frame, origin: "null", data: { type: CAP_HELLO_MESSAGE, v: 1 } })).toBe(true);
    expect(sent.filter((message) => message.type === CAP_READY_MESSAGE)).toHaveLength(2);
    expect(await broker.onMessage({ source: {}, origin: "null", data: { type: CAP_HELLO_MESSAGE, v: 1 } })).toBe(false);
    expect(sent.filter((message) => message.type === CAP_READY_MESSAGE)).toHaveLength(2);
  });

  it("a reader not signed in still gets ready, so the page's calls get sign_in at once", async () => {
    const { broker, sent } = setup({ pageId: undefined, signedIn: false }, ROUTES);
    await broker.start();
    expect(sent[0]).toMatchObject({ type: CAP_READY_MESSAGE, v: 1 });
  });
});

describe("the app's preview", () => {
  it("hears the page through the preview wrapper's relay (its own origin), and asks for the version shown, in the reader's language", async () => {
    const wrapper = { postMessage: vi.fn() } as unknown as Window;
    const inner = {} as Window;
    const { broker, calls, sent } = setup({ frame: () => wrapper, openFrame: () => inner, frameOrigin: "http://127.0.0.1:3000", version: 4, lang: "fr" }, ROUTES);
    const send = (origin: string, source: unknown) => broker.onMessage({ source, origin, data: { type: CAP_MESSAGE, v: 1, id: 1, cap: "data.read", args: { name: "team-board" } } });
    // the sandbox's "null" is not this wrapper's origin, the page's own window is not the wrapper
    expect(await send("null", wrapper)).toBe(false);
    expect(await send("http://127.0.0.1:3000", inner)).toBe(false);
    expect(await send("http://127.0.0.1:3000", wrapper)).toBe(true);
    expect(calls).toEqual(["/api/pages/page_12345678/capabilities?version=4&lang=fr", "/api/pages/page_12345678/data/team-board?version=4&lang=fr"]);
    expect(sent).toEqual([]);
    expect((wrapper.postMessage as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]).toMatchObject({ type: CAP_RESULT_MESSAGE, id: 1, ok: true });
    // links the page opens come from its own frame
    expect(broker.guardOpen({ source: inner, data: { type: PAGE_OPEN_MESSAGE, url: "https://evil.example/" } })).toBe(true);
    expect(broker.guardOpen({ source: wrapper, data: { type: PAGE_OPEN_MESSAGE, url: "https://evil.example/" } })).toBe(false);
  });
});

describe("open", () => {
  it("opens a conversation only by a reference a data answer held", async () => {
    const { call, result, openRef } = setup({}, ROUTES);
    await call("open", { ref: "thread:bot1:th1" }, 1);
    expect(result(1)).toMatchObject({ ok: false, error: "not_found" });
    await call("data.read", { name: "team-board" }, 2);
    await call("open", { ref: "thread:bot1:th1" }, 3);
    expect(result(3)).toMatchObject({ ok: true, value: true });
    expect(openRef).toHaveBeenCalledWith({ botId: "bot1", threadId: "th1" });
  });

  it("before any data, a link opens as it always did", async () => {
    const { call, openUrl, broker } = setup({}, ROUTES);
    await call("open", { ref: "https://example.com/x" });
    expect(openUrl).toHaveBeenCalledWith("https://example.com/x");
    expect(broker.getState().links).toEqual([]);
  });

  it("after data, an address that was in the answer opens, any other waits for a click", async () => {
    const { call, openUrl, broker, result } = setup({}, ROUTES);
    await call("data.read", { name: "team-board" }, 1);
    await call("open", { ref: "https://github.com/o/r/pull/1" }, 2);
    expect(openUrl).toHaveBeenCalledWith("https://github.com/o/r/pull/1");
    await call("open", { ref: "https://evil.example/?q=secret" }, 3);
    expect(result(3)).toMatchObject({ ok: true, value: false });
    expect(openUrl).toHaveBeenCalledTimes(1);
    const [pending] = broker.getState().links;
    expect(pending).toMatchObject({ url: "https://evil.example/?q=secret", host: "evil.example" });
    broker.resolveLink(pending!.id, true);
    expect(openUrl).toHaveBeenLastCalledWith("https://evil.example/?q=secret");
    expect(broker.getState().links).toEqual([]);
  });

  it("a declined link is never opened", async () => {
    const { call, openUrl, broker } = setup({}, ROUTES);
    await call("data.read", { name: "team-board" }, 1);
    await call("open", { ref: "https://evil.example/" }, 2);
    broker.resolveLink(broker.getState().links[0]!.id, false);
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("the wrapper's own open-link bridge is stopped for a link not in the data, and only from the page's frame", async () => {
    const { call, broker, frame } = setup({}, ROUTES);
    const message = (url: string) => ({ type: PAGE_OPEN_MESSAGE, url });
    // no data yet: the bridge works as before
    expect(broker.guardOpen({ source: frame, data: message("https://evil.example/") })).toBe(false);
    await call("data.read", { name: "team-board" }, 1);
    expect(broker.guardOpen({ source: frame, data: message("https://github.com/o/r/pull/1") })).toBe(false);
    expect(broker.guardOpen({ source: {}, data: message("https://evil.example/") })).toBe(false);
    expect(broker.guardOpen({ source: frame, data: message("https://evil.example/") })).toBe(true);
    expect(broker.getState().links.map((entry) => entry.url)).toEqual(["https://evil.example/"]);
  });

  it("refuses an `open` the version did not declare", async () => {
    const { call, result } = setup({}, { ...ROUTES, "/api/pages/page_12345678/capabilities": { capabilities: { data: ["team-board"], viewer: false, open: false }, reads: [] } });
    await call("open", { ref: "https://example.com/" });
    expect(result()).toMatchObject({ ok: false, error: "not_declared" });
  });

  it("is `unavailable` where the app cannot open that conversation", async () => {
    const { call, result } = setup({ openRef: () => false }, ROUTES);
    await call("data.read", { name: "team-board" }, 1);
    await call("open", { ref: "thread:bot1:th1" }, 2);
    expect(result(2)).toMatchObject({ ok: false, error: "unavailable" });
  });
});

describe("refresh without polling", () => {
  it("a data event reaches the page only for a source it was granted", async () => {
    const { broker, sent, call } = setup({}, ROUTES);
    await call("viewer.get");
    sent.length = 0;
    broker.dataChanged("team-board");
    broker.dataChanged("other");
    expect(sent).toEqual([{ v: 1, type: CAP_EVENT_MESSAGE, cap: "data", name: "team-board" }]);
  });

  it("coming back to focus makes the page read again what it had read, at most once a second", async () => {
    let at = 10_000;
    const { broker, sent, call } = setup({ now: () => at }, ROUTES);
    broker.refocused();
    expect(sent).toEqual([]);
    await call("data.read", { name: "team-board" });
    sent.length = 0;
    broker.refocused();
    broker.refocused();
    expect(sent).toHaveLength(1);
    at += 2_000;
    broker.refocused();
    expect(sent).toHaveLength(2);
  });

  it("parses a live data event", () => {
    expect(parseDataEvent({ name: "team-board" })).toBe("team-board");
    expect(parseDataEvent({ name: "../x" })).toBeNull();
    expect(parseDataEvent(null)).toBeNull();
  });
});
