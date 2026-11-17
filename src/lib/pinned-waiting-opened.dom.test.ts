// @vitest-environment happy-dom
// #4438: the bots re-check their waiting cards when the person opens the
// chat, its pinned card or Today, never on a screen's poll. Only the first
// read of a chat's list (and of Today) says `opened=1`; the polls and the
// reloads that follow never do, so an unchanged card starts no model turn.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const asked: string[] = [];
vi.mock("@/state/store/api", () => ({
  api: vi.fn(async (path: string) => {
    asked.push(path);
    return { pending: [], history: [], scopes: { org: false, team: false }, waiting: [] };
  }),
}));

const { useServerWaitingItems } = await import("./pinned-waiting");
const { useInbox } = await import("./approvals-inbox");

let root: Root;
let host: HTMLDivElement;
const flush = () => act(async () => { await Promise.resolve(); });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  asked.length = 0;
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe("opening the list, not polling it, re-checks the cards (#4438)", () => {
  it("the chat's pinned list: opened once per chat, never on its polls or a new stamp", async () => {
    function Probe({ botId, stamp }: { botId: string; stamp: string }) {
      useServerWaitingItems(botId, [], stamp);
      return null;
    }
    await act(async () => root.render(createElement(Probe, { botId: "b1", stamp: "s1" })));
    await flush();
    for (let poll = 0; poll < 5; poll += 1) await act(async () => { vi.advanceTimersByTime(10 * 60_000); });
    // the bot's activity moved: read again, not an opening
    await act(async () => root.render(createElement(Probe, { botId: "b1", stamp: "s2" })));
    await flush();
    const ofB1 = asked.filter((path) => path.includes("botId=b1"));
    expect(ofB1.length).toBeGreaterThan(5);
    expect(ofB1.filter((path) => path.includes("opened=1"))).toHaveLength(1);
    expect(ofB1[0]).toContain("opened=1");
    // another chat opened: its first read says so
    await act(async () => root.render(createElement(Probe, { botId: "b2", stamp: "s2" })));
    await flush();
    expect(asked.filter((path) => path.includes("botId=b2"))[0]).toContain("opened=1");
  });

  it("Today: its first read opens it, its 6 s polls do not", async () => {
    function Probe() {
      useInbox(false, "x");
      return null;
    }
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    await act(async () => root.render(createElement(Probe)));
    await flush();
    for (let poll = 0; poll < 5; poll += 1) await act(async () => { vi.advanceTimersByTime(6_000); });
    await flush();
    expect(asked.length).toBeGreaterThan(3);
    expect(asked[0]).toBe("/api/approvals?opened=1");
    expect(asked.slice(1).every((path) => !path.includes("opened=1"))).toBe(true);
  });
});
