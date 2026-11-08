// @vitest-environment happy-dom
// the owner 2026-11-06: "<Bot> is finishing another conversation" is never a bot
// message in the transcript (no avatar, name or chevron). The room says it
// with the same working line as "Thinking it over", just above the composer,
// and the bot's reply replaces it. Tool details are on here: that is when
// the chip used to draw as a bot row.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Group, Message } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), bots: [] as unknown[] }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, bots: fixture.bots as Bot[], config: { features: { showToolCalls: true } } },
    dispatch: fixture.dispatch,
  }) };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false, reasonCode: "x", message: "" } }, ready: true }),
  useCaptionChrome: () => ({}),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const { GroupView } = await import("./GroupView");

const orla = { id: "mel", name: "Orla", color: "blue", threadId: "mel-thread", messages: [] } as unknown as Bot;
fixture.bots = [orla];
const ask: Message = { id: "ask", role: "user", kind: "text", at: 1_000, text: "Can you check the board?" };
const wait = (ok?: boolean): Message => ({
  id: "wait", role: "bot", kind: "activity", at: 2_000,
  from: { botId: "mel", name: "Orla", color: "blue" },
  tool: {
    name: "Orla is finishing another conversation — will reply here when free",
    spoken: "Orla is finishing another conversation",
    ...(ok === undefined ? {} : { ok }),
  },
});
const room = (messages: Message[], working: boolean): Group => ({
  id: "room", threadId: "room-thread", name: "Ops", memberIds: ["mel"],
  defaultResponder: { kind: "member", botId: "mel" }, bulletin: "", unread: false,
  createdAt: 1, messages, working,
} as Group);

let host: HTMLDivElement;
let root: Root;
const render = (group: Group) => flushSync(() => root.render(createElement(GroupView, { group })));

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

describe("a member busy in another conversation", () => {
  it("says so on the working line above the composer, never as a message", () => {
    render(room([ask, wait()], true));
    const log = host.querySelector("[role=log]")!;
    expect(log).not.toBeNull();
    expect(log.textContent).toContain("Can you check the board?");
    expect(log.textContent).not.toContain("finishing another conversation");
    expect(log.querySelector("[data-bot-color]")).toBeNull();
    const presence = host.querySelectorAll(".turn-presence");
    expect(presence).toHaveLength(1);
    expect(log.contains(presence[0])).toBe(false);
    const slot = presence[0].closest("[data-turn-presence-slot]")!;
    expect(slot.closest("[data-composer-dock]")).not.toBeNull();
    expect(slot.textContent).toContain("Orla is finishing another conversation");
    expect(slot.textContent).not.toContain("will reply here when free");
  });

  it("goes away once the turn starts, with no row left behind", () => {
    render(room([ask, wait(true), { id: "r", role: "bot", kind: "text", at: 3_000, text: "Board looks clear.", from: { botId: "mel", name: "Orla", color: "blue" } }], false));
    expect(host.textContent).toContain("Board looks clear.");
    expect(host.textContent).not.toContain("finishing another conversation");
  });
});
