// The chat app's capability broker. A message that is not from the frame's
// opaque origin is ignored. A click is the browser's user activation, never
// the page's own gesture flag. The api here is a fake.
import { describe, expect, it, vi } from "vitest";

import { CAP_HELLO_MESSAGE, CAP_MESSAGE, CAP_READY_MESSAGE, CAP_RESULT_MESSAGE } from "../../shared/page-capabilities";
import { appCapMessageIgnored, createAppConnectorBroker, type AppConnectorBrokerDeps } from "./app-connector-broker";

const CAPS = { data: [], viewer: false, open: false, files: [], connectors: { GitHub: ["search_issues", "create_issue"] } };

function frame() {
  const posted: unknown[] = [];
  const win = { postMessage: (data: unknown) => { posted.push(data); } } as unknown as Window;
  return { win, posted };
}

type Api = AppConnectorBrokerDeps["api"];
type ApiCall = (path: string, init?: { method: "POST"; body?: unknown }) => Promise<unknown>;

function broker(own: { win: Window; posted: unknown[] }, impl?: ApiCall) {
  let now = 1_000;
  const api = vi.fn(impl ?? (async () => ({ ok: true, text: "done" })));
  const made = createAppConnectorBroker({
    frame: () => own.win,
    api: api as Api,
    botId: "bot-a",
    threadId: "thread-a",
    messageId: "m1",
    caps: CAPS,
    lang: "en",
    signedIn: true,
    now: () => now,
  });
  return { broker: made, api, posted: own.posted, setNow: (value: number) => { now = value; } };
}

function call(win: Window, data: unknown, active = false) {
  return { source: win, origin: "null", data, userActivation: { isActive: active } };
}

describe("app connector broker", () => {
  it("ignores a frame that is not its own, and any origin other than the sandbox", async () => {
    const own = frame();
    const other = frame();
    const { broker: made, api, posted } = broker(own);
    expect(appCapMessageIgnored({ source: null, origin: "null" }, own.win)).toBe(true);
    expect(appCapMessageIgnored({ source: other.win, origin: "null" }, own.win)).toBe(true);
    expect(appCapMessageIgnored({ source: own.win, origin: "https://evil.test" }, own.win)).toBe(true);
    expect(await made.onMessage({ source: null, origin: "null", data: { type: CAP_MESSAGE, v: 1, id: 1, cap: "connector.call", args: { connector: "GitHub", tool: "search_issues" } } })).toBe(false);
    expect(await made.onMessage({ source: other.win, origin: "null", data: { type: CAP_HELLO_MESSAGE, v: 1 } })).toBe(false);
    expect(await made.onMessage({ source: own.win, origin: "https://evil.test", data: { type: CAP_HELLO_MESSAGE, v: 1 } })).toBe(false);
    expect(posted).toEqual([]);
    expect(api).not.toHaveBeenCalled();
  });

  it("answers hello with ready, and refuses an undeclared tool without a request", async () => {
    const own = frame();
    const { broker: made, api, posted } = broker(own);
    made.start();
    expect(posted[0]).toMatchObject({ type: CAP_READY_MESSAGE, taken: true });
    expect(await made.onMessage(call(own.win, { type: CAP_HELLO_MESSAGE, v: 1 }))).toBe(true);
    expect(await made.onMessage(call(own.win, { type: CAP_MESSAGE, v: 1, id: 4, cap: "connector.call", args: { connector: "GitHub", tool: "delete_repo" } }))).toBe(true);
    expect(api).not.toHaveBeenCalled();
    expect(posted.at(-1)).toMatchObject({ type: CAP_RESULT_MESSAGE, id: 4, ok: false, error: "not_declared" });
  });

  it("sends click from user activation only, even when the page says gesture", async () => {
    const own = frame();
    const { broker: made, api } = broker(own, async () => ({ ok: true }));
    const body = { type: CAP_MESSAGE, v: 1, id: 2, cap: "connector.call", gesture: true, args: { connector: "GitHub", tool: "create_issue", arguments: { title: "x" } } };
    await made.onMessage(call(own.win, body, false));
    expect(JSON.parse(JSON.stringify(api.mock.calls[0]![1]))).toMatchObject({ body: { threadId: "thread-a", connector: "GitHub", tool: "create_issue", click: false } });
    await made.onMessage(call(own.win, { ...body, id: 3 }, true));
    expect(api.mock.calls[1]![1]).toMatchObject({ body: { click: true } });
  });

  it("shows the ask-first card, ignores a click that lands too soon, then retries once", async () => {
    const own = frame();
    let connectorCalls = 0;
    const { broker: made, api, posted, setNow } = broker(own, async (path: string) => {
      if (String(path).includes("/approvals/")) return { ok: true };
      connectorCalls += 1;
      if (connectorCalls === 1) {
        throw Object.assign(new Error("ask"), { status: 409, body: { code: "ask_first", approvalId: "ap1", label: "GitHub: create_issue", by: "org", always: true } });
      }
      return { ok: true, text: "made" };
    });
    const pending = made.onMessage(call(own.win, { type: CAP_MESSAGE, v: 1, id: 7, cap: "connector.call", args: { connector: "GitHub", tool: "create_issue" } }, true));
    await vi.waitFor(() => expect(made.getCards()).toHaveLength(1));
    const card = made.getCards()[0]!;
    expect(card.by).toBe("org");
    expect(made.resolveApproval(card.id, "once")).toBe(false);
    setNow(1_700);
    expect(made.resolveApproval(card.id, "once")).toBe(true);
    await pending;
    expect(api.mock.calls.map((entry) => String(entry[0]))).toEqual([
      "/api/bots/bot-a/apps/m1/connector?lang=en",
      "/api/bots/bot-a/apps/m1/approvals/ap1?lang=en",
      "/api/bots/bot-a/apps/m1/connector?lang=en",
    ]);
    expect(posted.at(-1)).toMatchObject({ type: CAP_RESULT_MESSAGE, id: 7, ok: true });
  });

  it("answers sign_in and does not call the server when the viewer is signed out", async () => {
    const own = frame();
    const api = vi.fn(async () => ({ ok: true }));
    const made = createAppConnectorBroker({ frame: () => own.win, api: api as Api, botId: "bot-a", threadId: "thread-a", messageId: "m1", caps: CAPS, lang: "en", signedIn: false });
    await made.onMessage(call(own.win, { type: CAP_MESSAGE, v: 1, id: 1, cap: "connector.call", args: { connector: "GitHub", tool: "search_issues" } }));
    expect(api).not.toHaveBeenCalled();
    expect(own.posted.at(-1)).toMatchObject({ ok: false, error: "sign_in" });
  });
});
