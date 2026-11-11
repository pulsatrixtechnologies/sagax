// The wrapper's broker for a page's capabilities (src/page-reader/capabilities.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CAP_EVENT_MESSAGE, CAP_HELLO_MESSAGE, CAP_MESSAGE, CAP_READY_MESSAGE, CAP_RESULT_MESSAGE, PAGE_CAP_LIMITS } from "../../shared/page-capabilities";
import { PAGE_OPEN_MESSAGE } from "../../shared/published-pages";
import { capFailure, CARD_GUARD_MS, createCapabilityBroker, fromPageFrame, parseDataEvent, splitAddress, type BrokerDeps } from "./capabilities";

const CAPS = { capabilities: { data: ["team-board"], viewer: true, open: true }, reads: [{ name: "team-board", label: "The work of your coding teams" }] };
const BOARD = { name: "team-board", value: { lanes: [] }, at: 1, links: ["https://github.com/o/r/pull/1"], refs: ["thread:bot1:th1"] };

class Refusal extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly body?: Record<string, unknown>) { super(message); }
}

const clock = { t: 1_000_000 };
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
  clock.t = 1_000_000;
  const broker = createCapabilityBroker({
    now: () => clock.t,
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
    clock.t += 700;
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
    clock.t += 700;
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

  it("tells the page the reader declined (#3449): code denied, reason declined", async () => {
    const { broker, call, result } = setup({}, asking());
    const pending = call("data.read", { name: "team-board" });
    await flush();
    broker.resolveApproval(broker.getState().approvals[0]!.id, "decline");
    await pending;
    expect(result()).toMatchObject({ ok: false, error: "denied", reason: "declined" });
  });

  it("passes the organization's reason to the page (#3449)", async () => {
    const { call, result } = setup({}, { ...ROUTES, "/api/pages/page_12345678/data/team-board": new Refusal("Your organization refuses this read.", 403, "denied", { code: "denied", reason: "org_rule" }) });
    await call("data.read", { name: "team-board" });
    expect(result()).toMatchObject({ ok: false, error: "denied", reason: "org_rule" });
  });

  it("forwards the page's filter to the server, nothing else (#3449)", async () => {
    const { call, calls } = setup({}, ROUTES);
    await call("data.read", { name: "team-board", params: { fresh: true, team: "t 1", column: "todo", version: "9", lang: "xx", deep: { a: 1 } } });
    expect(calls.at(-1)).toBe("/api/pages/page_12345678/data/team-board?fresh=1&team=t+1&column=todo&lang=en");
  });

  it("two reads of the same source share one card", async () => {
    const { broker, call } = setup({}, asking());
    const first = call("data.read", { name: "team-board" }, 1);
    const second = call("data.read", { name: "team-board" }, 2);
    await flush();
    expect(broker.getState().approvals).toHaveLength(1);
    clock.t += 700;
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
    expect(broker.resolveLink(pending!.id, "open")).toBe(false);
    expect(openUrl).toHaveBeenCalledTimes(1);
    clock.t += 700;
    expect(broker.resolveLink(pending!.id, "open")).toBe(true);
    expect(openUrl).toHaveBeenLastCalledWith("https://evil.example/?q=secret");
    expect(broker.getState().links).toEqual([]);
  });

  it("a declined link is never opened", async () => {
    const { call, openUrl, broker } = setup({}, ROUTES);
    await call("data.read", { name: "team-board" }, 1);
    await call("open", { ref: "https://evil.example/" }, 2);
    broker.resolveLink(broker.getState().links[0]!.id, "cancel");
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
    await flush();
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

describe("a card cannot be clicked at once (a page could time a decoy under the cursor)", () => {
  const asking = () => ({
    ...ROUTES,
    "/api/pages/page_12345678/data/team-board": () => new Refusal("Ask.", 409, "ask_first", { approvalId: "ap_1", source: "team-board", version: 1 }),
  });

  it("Ask first: Allow and Always allow wait, Decline never does", async () => {
    const { broker, call, posts } = setup({}, asking());
    void call("data.read", { name: "team-board" });
    await flush();
    const id = broker.getState().approvals[0]!.id;
    clock.t += CARD_GUARD_MS - 1;
    expect(broker.resolveApproval(id, "once")).toBe(false);
    expect(broker.resolveApproval(id, "always")).toBe(false);
    expect(broker.getState().approvals).toHaveLength(1);
    expect(posts).toEqual([]);
    clock.t += 1;
    expect(broker.resolveApproval(id, "decline")).toBe(true);
  });

  it("Ask first: Decline is answered at once", async () => {
    const { broker, call } = setup({}, asking());
    void call("data.read", { name: "team-board" });
    await flush();
    expect(broker.resolveApproval(broker.getState().approvals[0]!.id, "decline")).toBe(true);
  });

  it("a link card: Open and Always allow this site wait, Cancel never does", async () => {
    const { broker, call, openUrl } = setup({}, ROUTES);
    await call("data.read", { name: "team-board" }, 1);
    await call("open", { ref: "https://evil.example/" }, 2);
    const id = broker.getState().links[0]!.id;
    clock.t += CARD_GUARD_MS - 1;
    expect(broker.resolveLink(id, "open")).toBe(false);
    expect(broker.resolveLink(id, "always")).toBe(false);
    expect(openUrl).not.toHaveBeenCalled();
    expect(broker.resolveLink(id, "cancel")).toBe(true);
    expect(broker.getState().links).toEqual([]);
  });
});

describe("Always allow this site (kept on the server, per reader, page and origin)", () => {
  const LINK = "/api/pages/page_12345678/link-approvals";
  const ask = (origin: string) => `${LINK}?${new URLSearchParams({ origin })}`;
  it("an allowed site opens at once, no card", async () => {
    const { call, openUrl, broker, result, calls } = setup({}, { ...ROUTES, [LINK]: { allowed: true } });
    await call("data.read", { name: "team-board" }, 1);
    await call("open", { ref: "https://example.org/a?b=1" }, 2);
    expect(calls.at(-1)).toBe(ask("https://example.org"));
    expect(openUrl).toHaveBeenCalledWith("https://example.org/a?b=1");
    expect(result(2)).toMatchObject({ ok: true, value: true });
    expect(broker.getState().links).toEqual([]);
  });

  it("the card offers it; the click is sent to the server and the link opens", async () => {
    const { call, openUrl, broker, posts } = setup({}, { ...ROUTES, [LINK]: () => ({ allowed: false, ok: true }) });
    await call("data.read", { name: "team-board" }, 1);
    await call("open", { ref: "https://example.org/a?b=1" }, 2);
    const card = broker.getState().links[0]!;
    expect(card.always).toBe(true);
    clock.t += 700;
    expect(broker.resolveLink(card.id, "always")).toBe(true);
    expect(posts).toEqual([{ path: LINK, body: { origin: "https://example.org", answer: "always" } }]);
    expect(openUrl).toHaveBeenCalledWith("https://example.org/a?b=1");
  });

  it("asks for the link's own origin: its scheme and port count, never just its host", async () => {
    const { call, broker, calls, posts } = setup({}, { ...ROUTES, [LINK]: () => ({ allowed: false, ok: true }) });
    await call("data.read", { name: "team-board" }, 1);
    await call("open", { ref: "http://Example.org:8080/x?d=1" }, 2);
    expect(calls.at(-1)).toBe(ask("http://example.org:8080"));
    const card = broker.getState().links[0]!;
    clock.t += 700;
    broker.resolveLink(card.id, "always");
    expect(posts).toEqual([{ path: LINK, body: { origin: "http://example.org:8080", answer: "always" } }]);
  });

  it("a server without the route still asks with the card", async () => {
    const { call, broker } = setup({}, ROUTES);
    await call("data.read", { name: "team-board" }, 1);
    await call("open", { ref: "https://example.org/" }, 2);
    // the option would do nothing: it is not offered
    expect(broker.getState().links).toHaveLength(1);
    expect(broker.getState().links[0]!.always).toBe(false);
  });

  it("a failing route (a 500, a network error) offers no button either", async () => {
    const { call, broker } = setup({}, { ...ROUTES, [LINK]: () => new Refusal("down", 500) });
    await call("data.read", { name: "team-board" }, 1);
    await call("open", { ref: "https://example.org/" }, 2);
    expect(broker.getState().links[0]!.always).toBe(false);
  });

  it("an answer that is not `allowed: false` offers no button", async () => {
    const { call, broker } = setup({}, { ...ROUTES, [LINK]: { ok: true } });
    await call("data.read", { name: "team-board" }, 1);
    await call("open", { ref: "https://example.org/" }, 2);
    expect(broker.getState().links[0]!.always).toBe(false);
  });

  it("an e-mail address is never offered Always allow", async () => {
    const { call, broker } = setup({}, ROUTES);
    await call("data.read", { name: "team-board" }, 1);
    await call("open", { ref: "mailto:a@example.org?subject=x" }, 2);
    expect(broker.getState().links[0]).toMatchObject({ always: false, host: "a@example.org" });
  });
});

describe("the reader's name is data too", () => {
  it("viewer.get marks the frame: a link outside the data waits for a click before any data read", async () => {
    const { call, broker, openUrl } = setup({}, ROUTES);
    await call("viewer.get", {}, 1);
    await call("open", { ref: "https://example.org/?n=Ada" }, 2);
    expect(openUrl).not.toHaveBeenCalled();
    expect(broker.getState().links).toHaveLength(1);
  });
});

describe("splitAddress", () => {
  it("puts the host apart and keeps the query and fragment as written", () => {
    expect(splitAddress("https://example.org/a/b?d=1&e=2#frag")).toMatchObject({ host: "example.org", rest: "/a/b?d=1&e=2#frag", cut: false });
    expect(splitAddress("https://example.org/").rest).toBe("");
  });

  it("cuts a long rest in the middle only, the whole is still there", () => {
    const long = `https://example.org/?d=${"x".repeat(400)}END`;
    const parts = splitAddress(long);
    expect(parts.cut).toBe(true);
    expect(parts.short.length).toBeLessThan(130);
    expect(parts.short).toContain("…");
    expect(parts.short.startsWith("/?d=")).toBe(true);
    expect(parts.short.endsWith("END")).toBe(true);
    expect(parts.rest).toBe(long.slice("https://example.org".length));
  });
});

interface DownloadAnchor {
  tag: string;
  download: string;
  href: string;
  clicked: number;
  click(): void;
  setAttribute(name: string, value: string): void;
}

function installDocument(): { made: DownloadAnchor[]; restore(): void } {
  const made: DownloadAnchor[] = [];
  const host = globalThis as { document?: unknown; URL: { createObjectURL?: (value: unknown) => string; revokeObjectURL?: (value: string) => void } };
  const previous = host.document;
  host.document = {
    createElement(tag: string): DownloadAnchor {
      const node: DownloadAnchor = {
        tag,
        download: "",
        href: "",
        clicked: 0,
        click() { node.clicked += 1; },
        setAttribute(name: string, value: string) {
          if (name === "download") node.download = value;
          if (name === "href") node.href = value;
        },
      };
      made.push(node);
      return node;
    },
    body: { appendChild() { return undefined; }, removeChild() { return undefined; } },
  };
  const url = host.URL;
  const previousCreate = url.createObjectURL;
  const previousRevoke = url.revokeObjectURL;
  if (typeof previousCreate !== "function") url.createObjectURL = () => "blob:cap-test";
  if (typeof previousRevoke !== "function") url.revokeObjectURL = () => undefined;
  return {
    made,
    restore() {
      try {
        if (previous === undefined) delete host.document;
        else host.document = previous;
      } catch { /* the host kept its own document */ }
      try {
        if (typeof previousCreate !== "function") delete url.createObjectURL;
        else url.createObjectURL = previousCreate;
        if (typeof previousRevoke !== "function") delete url.revokeObjectURL;
        else url.revokeObjectURL = previousRevoke;
      } catch { /* the host kept its own URL helpers */ }
    },
  };
}

const TEXT = "aGVsbG8=";

describe("files.download", () => {
  let made: DownloadAnchor[] = [];
  let restoreDocument = () => {};
  beforeEach(() => {
    const installed = installDocument();
    made = installed.made;
    restoreDocument = installed.restore;
  });
  afterEach(() => restoreDocument());

  function withFiles(capabilities: Record<string, unknown> = { data: [], viewer: false, open: false, files: ["download"] }) {
    made.length = 0;
    const saveFile = vi.fn();
    const ctx = setup({ saveFile } as Partial<BrokerDeps>, {
      ...ROUTES,
      "/api/pages/page_12345678/capabilities": {
        capabilities,
        reads: [{ name: "team-board", label: "The work of your coding teams" }],
      },
    });
    const ask = (args: Record<string, unknown>, options: { gesture?: boolean; id?: number; omitGesture?: boolean } = {}) => {
      const data: Record<string, unknown> = { type: CAP_MESSAGE, v: 1, id: options.id ?? 1, cap: "files.download", args };
      if (!options.omitGesture) data.gesture = options.gesture ?? true;
      return ctx.broker.onMessage({ source: ctx.frame, origin: "null", data });
    };
    return { ...ctx, saveFile, ask };
  }

  function saved(saveFile: ReturnType<typeof vi.fn>): { name?: string; mime?: string } | undefined {
    const call = saveFile.mock.calls[0] as unknown[] | undefined;
    if (call) {
      const first = call[0];
      if (typeof first === "string") return { name: first, mime: typeof call[1] === "string" ? call[1] : undefined };
      if (first && typeof first === "object") {
        const record = first as { name?: unknown; mime?: unknown };
        return {
          name: typeof record.name === "string" ? record.name : undefined,
          mime: typeof record.mime === "string" ? record.mime : undefined,
        };
      }
    }
    const anchor = made.find((node) => node.tag === "a" && (node.clicked > 0 || node.download !== ""));
    return anchor ? { name: anchor.download } : undefined;
  }

  function noSave(saveFile: ReturnType<typeof vi.fn>) {
    expect(saveFile).not.toHaveBeenCalled();
    expect(made.filter((node) => node.tag === "a")).toEqual([]);
  }

  it("is not_declared when download is not in the declaration", async () => {
    const saveFile = vi.fn();
    const ctx = setup({ saveFile } as Partial<BrokerDeps>, ROUTES);
    await ctx.broker.onMessage({
      source: ctx.frame,
      origin: "null",
      data: { type: CAP_MESSAGE, v: 1, id: 1, cap: "files.download", gesture: true, args: { name: "note.txt", mime: "text/plain", data: TEXT } },
    });
    expect(ctx.result()).toMatchObject({ ok: false, error: "not_declared" });
    noSave(saveFile);
  });

  it("refuses a download when gesture is not true, and saves nothing", async () => {
    for (const options of [{ gesture: false }, { omitGesture: true }]) {
      const { ask, result, saveFile } = withFiles();
      await ask({ name: "note.txt", mime: "text/plain", data: TEXT }, options);
      expect(result()).toMatchObject({ ok: false, error: "bad_request" });
      noSave(saveFile);
    }
  });

  it("saves a file of each allowed mime", async () => {
    const allowed = ["text/plain", "text/csv", "text/markdown", "application/json", "application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"];
    for (const mime of allowed) {
      const { ask, result, saveFile } = withFiles();
      await ask({ name: "note.txt", mime, data: TEXT });
      expect(result(), mime).toMatchObject({ ok: true });
      expect(saved(saveFile)?.name, mime).toBe("note.txt");
      expect(saved(saveFile)?.mime ?? mime, mime).toBe(mime);
    }
  });

  it("refuses a mime outside the closed list, including parameters", async () => {
    const refused = ["text/html", "image/svg+xml", "application/javascript", "text/csv;charset=utf-8", "Text/Plain"];
    for (const mime of refused) {
      const { ask, result, saveFile } = withFiles();
      await ask({ name: "note.txt", mime, data: TEXT });
      expect(result(), mime).toMatchObject({ ok: false, error: "bad_request" });
      noSave(saveFile);
    }
  });

  it("keeps only the last segment of a name", async () => {
    const cases = ["folder/note.txt", "folder\\note.txt", "a/b\\c/note.txt", "a".repeat(200)];
    for (const name of cases) {
      const { ask, result, saveFile } = withFiles();
      await ask({ name, mime: "text/plain", data: TEXT });
      const kept = name.split(/[/\\]/).at(-1);
      expect(result(), name).toMatchObject({ ok: true });
      expect(saved(saveFile)?.name, name).toBe(kept);
    }
  });

  it("refuses an empty, dot, control, or overlong name", async () => {
    const refused = ["", ".", "..", "dir/..", "dir/.", "dir/", "bad\nname", "bad\u0000name", "a".repeat(201)];
    for (const name of refused) {
      const { ask, result, saveFile } = withFiles();
      await ask({ name, mime: "text/plain", data: TEXT });
      expect(result(), JSON.stringify(name)).toMatchObject({ ok: false, error: "bad_request" });
      noSave(saveFile);
    }
  });

  it("refuses bad base64", async () => {
    const bad = ["@@@@", "aGVs bG8=", "data:text/plain;base64,aGVsbG8="];
    for (const data of bad) {
      const { ask, result, saveFile } = withFiles();
      await ask({ name: "note.txt", mime: "text/plain", data });
      expect(result(), data).toMatchObject({ ok: false, error: "bad_request" });
      noSave(saveFile);
    }
  });

  it("refuses bytes over fileBytes, including a string whose length already implies it", async () => {
    const limit = PAGE_CAP_LIMITS.fileBytes;
    let implied = 4 * Math.ceil((limit + 3) / 3);
    while (Math.floor(implied / 4) * 3 - 2 <= limit) implied += 4;
    const { ask, result, saveFile } = withFiles();
    await ask({ name: "note.txt", mime: "text/plain", data: "A".repeat(implied) });
    expect(result(), "length").toMatchObject({ ok: false, error: "too_large" });
    noSave(saveFile);

    const over = withFiles();
    await over.ask({ name: "note.txt", mime: "text/plain", data: Buffer.alloc(limit + 1).toString("base64") });
    expect(over.result(), "decoded").toMatchObject({ ok: false, error: "too_large" });
    noSave(over.saveFile);

    const exact = withFiles();
    await exact.ask({ name: "note.txt", mime: "text/plain", data: Buffer.alloc(limit).toString("base64") });
    expect(exact.result(), "exact").toMatchObject({ ok: true });
    expect(saved(exact.saveFile)?.name).toBe("note.txt");
  });

  it("does not answer shared_write_after_data and does not mark received data", async () => {
    const { ask, result, call, openUrl, broker } = withFiles({ data: [], viewer: false, open: true, files: ["download"] });
    await ask({ name: "note.txt", mime: "text/plain", data: TEXT }, { id: 1 });
    expect(result(1)).toMatchObject({ ok: true });
    expect(result(1)).not.toMatchObject({ error: "shared_write_after_data" });
    await call("open", { ref: "https://example.com/after-file" }, 2);
    expect(result(2)).toMatchObject({ ok: true, value: true });
    expect(openUrl).toHaveBeenCalledWith("https://example.com/after-file");
    expect(broker.getState().links).toEqual([]);
  });
});
