import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { OrgDirectoryPerson } from "@/lib/perspicax-org";
import type { Bot, ConfigStatus, Group, Message } from "@/state/store";
import { formatTime } from "@/state/store";

const fixture = vi.hoisted(() => ({ config: null as ConfigStatus | null }));
// Thread mode on: these cases cover the Go to conversation chip, which the
// unified chat (the default) never draws (the owner 2026-11-06, unified-chat.guard.test.ts).
vi.mock("@/lib/thread-preferences", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/thread-preferences")>()),
  useShowThreads: () => true,
}));
vi.mock("@/state/store", async (original) => ({
  ...await original<typeof import("@/state/store")>(),
  useStore: () => ({ state: { config: fixture.config }, dispatch: vi.fn() }),
}));
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({}) }));

import { Transcript } from "./GroupView";

const Owner = "pr_owner";
const SAM = "pr_sam";
const members = [
  { id: "maya", name: "Maya", color: "green" },
  { id: "theo", name: "Theo", color: "blue" },
] as Bot[];
const people = new Map<string, OrgDirectoryPerson>([
  [SAM, { principalId: SAM, name: "Sam Taylor", login: "staylor", role: "member", disabled: false, avatarUrl: "/api/people/pr_sam/avatar?v=1" }],
  ["pr_marie", { principalId: "pr_marie", name: "Marie Roy", login: "mroy", role: "member", disabled: false }],
]);
const t0 = new Date(2026, 9, 1, 9, 0).getTime();
const min = 60_000;
const person = (id: string, sender: Message["sender"], text: string, at: number): Message =>
  ({ id, role: "user", kind: "text", text, at, ...(sender ? { sender } : {}) });
const bot = (id: string, botId: string, text: string, at: number): Message =>
  ({ id, role: "bot", kind: "text", text, at, from: { botId, name: botId === "maya" ? "Maya" : "Theo", color: "green" } });

function render(messages: Message[], config: ConfigStatus | null) {
  fixture.config = config;
  return renderToStaticMarkup(createElement(Transcript, {
    group: { id: "room", threadId: "thread", messages, memberIds: ["maya", "theo"] } as unknown as Group,
    members, locale: "en", messages, transcript: messages, onReply: () => undefined, people,
  }));
}

/** Each text row: its author side and the classes of its outer box. */
function rows(markup: string) {
  return [...markup.matchAll(/<div data-author="(\w+)" class="([^"]*)"/g)].map((match) => ({ author: match[1], cls: match[2] }));
}

/** The classes of the bubble that holds `text`. Anchored on data-chat-bubble
 * (not rounded-[18px]) so it finds a flat bot line, which has no bubble shape. */
function bubble(markup: string, text: string): string {
  const end = markup.indexOf(`>${text}<`);
  const marker = markup.lastIndexOf('data-chat-bubble="true"', end);
  const start = markup.indexOf('class="', marker) + 'class="'.length;
  return markup.slice(start, markup.indexOf('"', start));
}

const memberConfig = { viewer: { operator: false, principalId: Owner, email: "owner@example.com", name: "Owner", role: "member", canCreateBots: true, operatorName: "Owner" } } as ConfigStatus;

beforeAll(() => vi.stubGlobal("window", {}));
afterAll(() => vi.unstubAllGlobals());

describe("group chat bubbles", () => {
  const conversation = [
    person("a", { name: "Owner", id: Owner }, "Test", t0),
    person("b", { name: "Sam Taylor", id: SAM }, "Test sam", t0 + min),
    person("c", { name: "Sam Taylor", id: SAM }, "C'est sam", t0 + 2 * min),
    person("d", { name: "Owner", id: Owner }, "test", t0 + 3 * min),
    person("e", { name: "Owner", id: Owner }, "adawdawdawd", t0 + 4 * min),
    person("f", { name: "Marie Roy", id: "pr_marie" }, "Bonjour", t0 + 5 * min),
    bot("g", "maya", "Hello **team**", t0 + 6 * min),
    bot("h", "theo", "Hi", t0 + 7 * min),
  ];

  it("puts the viewer's lines on the end side and everyone else's on the start side", () => {
    const markup = render(conversation, memberConfig);
    expect(rows(markup).map((row) => row.author)).toEqual(["self", "person", "person", "self", "self", "person", "bot", "bot"]);
    for (const row of rows(markup)) {
      expect(row.cls).toContain(row.author === "self" ? "items-end" : "items-start");
    }
    // Your bubble is the accent; another person's and a bot's are the neutral grey.
    expect(bubble(markup, "adawdawdawd")).toContain("bg-bubble-user");
    expect(bubble(markup, "Test sam")).toContain("bg-bubble-bot");
    expect(bubble(markup, "Test sam")).not.toContain("bg-bubble-user");
    expect(bubble(markup, "adawdawdawd")).not.toContain("bg-bubble-bot");
    expect(bubble(markup, "Hi")).toContain("bg-bubble-bot");
    expect(bubble(markup, "Hi")).not.toContain("bg-bubble-user");
    expect(bubble(markup, "Hi")).not.toContain("bg-card");
    expect(bubble(markup, "Hi")).toContain("text-ink");
  });

  it("names each other person once per run, from the directory, with an avatar", () => {
    const markup = render(conversation, memberConfig);
    expect(markup.match(/data-testid="room-person"/g)).toHaveLength(2);
    expect(markup.match(/>Sam Taylor</g)).toHaveLength(1);
    expect(markup).toContain('src="/api/people/pr_sam/avatar?v=1"');
    expect(markup).toContain(">MR<");
    expect(markup.indexOf("Sam Taylor")).toBeLessThan(markup.indexOf("Test sam"));
    // Your own lines carry no name.
    expect(markup).not.toContain(">Owner<");
  });

  it("tightens a run and starts a new one after five minutes", () => {
    const markup = render([
      ...conversation.slice(1, 3),
      person("late", { name: "Sam Taylor", id: SAM }, "later", t0 + 30 * min),
    ], memberConfig);
    const [first, second, late] = rows(markup);
    expect(first!.cls).not.toContain("-mt-2");
    expect(second!.cls).toContain("-mt-2");
    expect(late!.cls).not.toContain("-mt-2");
    expect(markup.match(/data-testid="room-person"/g)).toHaveLength(2);
    expect(markup).toContain("rounded-es-[6px]");
    expect(markup).toContain("rounded-ss-[6px]");
  });

  it("keeps bots on the start side with their own label and markdown", () => {
    const markup = render(conversation, memberConfig);
    expect(markup).toContain("<strong>team</strong>");
    expect(markup).toContain(">Maya</span>");
    expect(markup).toContain(">Theo</span>");
  });

  it("flips sides for the other viewer", () => {
    const samConfig = { viewer: { ...memberConfig.viewer!, principalId: SAM, email: "sam@example.com", name: "Sam Taylor" } } as ConfigStatus;
    const markup = render(conversation.slice(0, 3), samConfig);
    expect(rows(markup).map((row) => row.author)).toEqual(["person", "self", "self"]);
    expect(markup).toContain(">Owner<");
  });

  it("solo server: the operator's lines are theirs and a paired guest is another person", () => {
    const operator = { viewer: { operator: true, principalId: "pr_local", email: "op@example.test", name: "Op", role: "owner", canCreateBots: true } } as ConfigStatus;
    const markup = render([
      person("o", undefined, "from the console", t0),
      person("g", { name: "guest@example.test", id: "guest-key" }, "from a phone", t0 + min),
    ], operator);
    expect(rows(markup).map((row) => row.author)).toEqual(["self", "person"]);
    expect(markup).toContain(">guest</span>");
  });

  it("an older server with no viewer keeps every person line on your side", () => {
    const markup = render(conversation.slice(0, 3), null);
    expect(rows(markup).map((row) => row.author)).toEqual(["self", "self", "self"]);
  });

  it("stamps the first cluster with the date and time, and again after 30 minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 1, 12, 0));
    try {
      const later = t0 + 40 * min;
      const markup = render([
        person("a", { name: "Owner", id: Owner }, "Test", t0),
        person("b", { name: "Owner", id: Owner }, "still going", t0 + min),
        person("c", { name: "Owner", id: Owner }, "after the pause", later),
      ], memberConfig);
      const stamps = [...markup.matchAll(/data-testid="transcript-date"[^>]*>([^<]+)</g)].map((match) => match[1]);
      expect(stamps).toEqual([`Today ${formatTime(t0)}`, `Today ${formatTime(later)}`]);
      expect(markup).toContain("self-end pb-1 text-[11px] tabular-nums");
    } finally {
      vi.useRealTimers();
    }
  });

  it("collapses a pair channel into one Go to conversation chip", () => {
    const ping = bot("a", "maya", "ping", t0);
    const pong = bot("b", "theo", "pong", t0 + min);
    const markup = renderToStaticMarkup(createElement(Transcript, {
      group: { id: "dm", threadId: "thread", dm: true, messages: [ping, pong], memberIds: ["maya", "theo"] } as unknown as Group,
      members, locale: "en", messages: [ping, pong], transcript: [ping, pong], onReply: () => undefined, people,
    }));
    expect(markup).toContain("Go to conversation");
    expect(markup).toContain('data-testid="bot-exchange-chip"');
    expect(markup).not.toContain(">ping<");
    expect(markup).not.toContain(">pong<");
  });
});
