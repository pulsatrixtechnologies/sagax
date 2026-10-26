// ChatView as the single stream (Show threads off, the default): earlier
// topics above the live one under their dividers, New topic in the header,
// nothing of it with threads on or in a thread outside the stream.
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo } from "@/state/store";
import type { ApprovalModeSelector } from "./ApprovalModeSelector";
import type { ModelPicker } from "./ModelPicker";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  const stored = { threads: null as string | null };
  vi.stubGlobal("localStorage", { getItem: (key: string) => (key === "omb-show-threads" ? stored.threads : null), setItem: () => {} });
  return { stored, focus: null as unknown, fresh: {} as Record<string, { threadId: string; auto: boolean }>, dispatch: vi.fn(), canWrite: null as boolean | null, showToolCalls: false, platform: "other", localReasonCode: "cua-driver-unavailable", localMessage: "", model: null as ComponentProps<typeof ModelPicker> | null,
    approval: null as ComponentProps<typeof ApprovalModeSelector> | null };
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, focusMessage: fixture.focus as typeof original.initialState.focusMessage, freshTopic: fixture.fresh, config: fixture.showToolCalls ? { features: { showToolCalls: true } } : null,
      instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test" } as InstanceInfo] },
    dispatch: fixture.dispatch,
  }) };
});
// The real useCaptionChrome rides along: it only asks this module for the
// window chrome, and these tests render the desktop-neutral layout.
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: fixture.platform }, localComputer: { available: false, reasonCode: fixture.localReasonCode, message: fixture.localMessage } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/cloud-guest", () => ({ useCanWriteIn: () => fixture.canWrite }));
vi.mock("./CitationUI", async (importOriginal) => ({
  ...await importOriginal<typeof import("./CitationUI")>(),
  CitationSelectionToolbar: () => createElement("span", { "data-testid": "citation-toolbar" }),
}));
vi.mock("./ModelPicker", () => ({ ModelPicker: (props: ComponentProps<typeof ModelPicker>) => {
  fixture.model = props;
  return createElement("span", { "data-test-model-control": true });
} }));
vi.mock("./ApprovalModeSelector", () => ({ ApprovalModeSelector: (props: ComponentProps<typeof ApprovalModeSelector>) => {
  fixture.approval = props;
  return createElement("span", { "data-test-approval-control": true });
} }));

// The + menu opens on a click; rendered statically here with its items and
// rows laid out, so the rows it holds (approval level, workspace) are seen.
vi.mock("./ComposerControls", async (importOriginal) => {
  const original = await importOriginal<typeof import("./ComposerControls")>();
  return { ...original, ComposerPlusMenu: (props: ComponentProps<typeof original.ComposerPlusMenu>) => createElement("div", { "data-test-plus-menu": true },
    ...props.items.map((item) => createElement("button", { key: item.id, "data-composer-plus-item": item.id }, item.label)),
    props.rows?.(() => {})) };
});

// A static render reads a store's server snapshot: the choice comes from here.
vi.mock("@/lib/thread-preferences", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/thread-preferences")>();
  return { ...original, useShowThreads: () => fixture.stored.threads === null ? original.SHOW_THREADS_DEFAULT : fixture.stored.threads === "1",
    useShowThreadsChoice: () => fixture.stored.threads === null ? original.SHOW_THREADS_DEFAULT : fixture.stored.threads === "1",
    setShowThreads: (on: boolean) => { fixture.stored.threads = on ? "1" : "0"; } };
});
const { ChatView, STREAM_ANCHOR_BAND } = await import("./ChatView");
const { offscreenAnchorShift } = await import("@/hooks/use-offscreen-row-anchor");
const { mergeStreamHits, STREAM_FIND_TOPICS } = await import("./ChatFindBar");
const preferences = await import("@/lib/thread-preferences");
afterAll(() => vi.unstubAllGlobals());

const bot: Bot = {
  id: "bot", threadId: "now", name: "Pepper", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, hasMore: false,
  messages: [{ id: "m1", role: "bot", kind: "text", text: "Live answer", at: 3 } as Bot["messages"][number]],
  modelSelection: { instanceId: "test", model: "profile-default" },
  tasks: [
    { threadId: "first", title: "Invoices", createdAt: 1 },
    { threadId: "conf", title: "Private", createdAt: 2, confidential: true },
    { threadId: "now", title: "Backups", createdAt: 3 },
  ],
};

const render = (value: Bot) => renderToStaticMarkup(createElement(ChatView, { bot: value }));

describe("the single stream in the main chat", () => {
  it("folds the earlier topics behind one Earlier topics line once the live one is read back", () => {
    preferences.setShowThreads(false);
    const markup = render(bot);
    expect(markup).toContain('data-new-topic="bot"');
    expect(markup).toContain('data-previous-topics="closed"');
    expect(markup).not.toContain("data-stream-segment");
    expect(markup).toContain("Live answer");
    // nothing earlier: no line
    expect(render({ ...bot, tasks: bot.tasks!.filter((task) => task.threadId !== "first") })).not.toContain("data-previous-topics");
  });

  it("lands on a fresh, empty topic over the live one: Earlier topics folded, nothing of the old topic drawn", () => {
    preferences.setShowThreads(false);
    fixture.fresh = { bot: { threadId: "now", auto: true } };
    try {
      const markup = render(bot);
      expect(markup).toContain('data-previous-topics="closed"');
      expect(markup).not.toContain("Live answer");
      expect(markup).not.toContain("data-stream-segment");
      expect(markup).toContain("Pepper");
      // a draft over another thread than the one on screen draws nothing
      fixture.fresh = { bot: { threadId: "first", auto: true } };
      expect(render(bot)).toContain("Live answer");
      // never over a confidential thread, shown alone
      fixture.fresh = { bot: { threadId: "conf", auto: true } };
      expect(render({ ...bot, threadId: "conf" })).not.toContain("data-previous-topics");
    } finally {
      fixture.fresh = {};
    }
  });

  // JC 2026-10-22: threads off = one unified conversation, so no cross-topic
  // "new activity" pill surfaces at the top; the topic is reached by reading
  // back (PreviousTopicsLine), never a banner.
  it("draws no earlier-topic activity pill for the topic under a fresh one", () => {
    preferences.setShowThreads(false);
    fixture.fresh = { bot: { threadId: "now", auto: false } };
    try {
      const markup = render({ ...bot, tasks: bot.tasks!.map((task) => task.threadId === "now" ? { ...task, unread: true } : task) });
      expect(markup).not.toContain("data-earlier-topic-activity");
    } finally {
      fixture.fresh = {};
    }
  });

  it("draws the earlier topic above the live one, under its divider, for a link into it", () => {
    preferences.setShowThreads(false);
    fixture.focus = { threadId: "first", messageId: "old", nonce: 1, consumed: false };
    let markup = "";
    try {
      markup = render(bot);
    } finally {
      fixture.focus = null;
    }
    expect(markup).toContain('data-previous-topics="open"');
    expect(markup).toContain('data-stream-segment="first"');
    expect(markup).toContain('data-topic-divider="now"');
    // the oldest topic opens the stream: no divider above it
    expect(markup).not.toContain('data-topic-divider="first"');
    // a confidential thread is never part of the stream
    expect(markup).not.toContain('data-stream-segment="conf"');
    expect(markup.indexOf('data-stream-segment="first"')).toBeLessThan(markup.indexOf('data-topic-divider="now"'));
    expect(markup.indexOf('data-topic-divider="now"')).toBeLessThan(markup.indexOf("Live answer"));
  });

  it("draws a bot answer flat like Grok Bot: no card, no bubble shape", () => {
    preferences.setShowThreads(false);
    const markup = render(bot);
    // the bubble wrapper that holds the bot's answer
    const end = markup.indexOf(">Live answer<");
    const marker = markup.lastIndexOf('data-chat-bubble="true"', end);
    const start = markup.indexOf('class="', marker) + 'class="'.length;
    const cls = markup.slice(start, markup.indexOf('"', start));
    expect(cls).toContain("text-ink");
    expect(cls).not.toContain("bg-card");
    expect(cls).not.toContain("rounded-[18px]");
    expect(cls).not.toContain("bg-bubble-user");
  });

  it("draws the topic divider as Grok Bot's quiet New topic marker, not the topic's title and time", () => {
    preferences.setShowThreads(false);
    fixture.focus = { threadId: "first", messageId: "old", nonce: 1, consumed: false };
    let markup = "";
    try {
      markup = render(bot);
    } finally {
      fixture.focus = null;
    }
    // one generic "New topic" label, the topic name only as the hover tooltip
    expect(markup).toContain('title="Backups">New topic<');
    // never the old titled, timestamped divider ("New topic: Backups · 00:00")
    expect(markup).not.toContain("New topic: Backups");
    expect(markup).not.toMatch(/New topic\b[^<]*·/);
  });

  it("waits for the live topic to be read back to its start", () => {
    preferences.setShowThreads(false);
    const markup = render({ ...bot, hasMore: true });
    expect(markup).not.toContain("data-stream-segment");
    expect(markup).not.toContain("data-topic-divider");
  });

  it("draws the earlier topic at once for a link or a search hit into it, before the live topic is read back", () => {
    preferences.setShowThreads(false);
    fixture.focus = { threadId: "first", messageId: "old", nonce: 1, consumed: false };
    try {
      const markup = render({ ...bot, hasMore: true });
      expect(markup).toContain('data-stream-segment="first"');
      expect(markup).toContain('data-topic-divider="now"');
    } finally {
      fixture.focus = null;
    }
  });

  it("shows a confidential thread alone, as before", () => {
    preferences.setShowThreads(false);
    const markup = render({ ...bot, threadId: "conf" });
    expect(markup).not.toContain("data-stream-segment");
    expect(markup).not.toContain("data-topic-divider");
  });

  it("is not there with threads on: the thread picker, no divider, no New topic", () => {
    preferences.setShowThreads(true);
    const markup = render(bot);
    expect(markup).not.toContain("data-new-topic");
    expect(markup).not.toContain("data-stream-segment");
    expect(markup).not.toContain("data-topic-divider");
    preferences.setShowThreads(false);
  });

  it("is the default for a person who never chose", () => {
    expect(preferences.SHOW_THREADS_DEFAULT).toBe(false);
    fixture.stored.threads = null;
    expect(render(bot)).toContain('data-new-topic="bot"');
  });

  it("loads one earlier topic at once and offers the one before it", () => {
    preferences.setShowThreads(false);
    fixture.focus = { threadId: "first", messageId: "old", nonce: 1, consumed: false };
    let markup = "";
    try {
      markup = render({ ...bot, tasks: [{ threadId: "zero", title: "Payroll", createdAt: 0 }, ...bot.tasks!] });
    } finally {
      fixture.focus = null;
    }
    expect(markup).toContain('data-stream-segment="first"');
    expect(markup).not.toContain('data-stream-segment="zero"');
    expect(markup).toContain('data-stream-earlier="zero"');
  });

  // The unified conversation never raises a pill for an earlier topic that
  // has something new (JC 2026-10-22): it is read back in place, not jumped to.
  it("draws no earlier-topic activity pill for an earlier topic that has something new", () => {
    preferences.setShowThreads(false);
    const markup = render({ ...bot, tasks: bot.tasks!.map((task) => task.threadId === "first" ? { ...task, unread: true } : task) });
    expect(markup).not.toContain("data-earlier-topic-activity");
    expect(render(bot)).not.toContain("data-earlier-topic-activity");
  });
});

describe("an earlier topic that grows above the reader", () => {
  it("moves the reader by its growth when the view starts near its end or below it", () => {
    const topic = { top: 0, previousHeight: 40, height: 640 };
    // the reader at the very top, on the live topic's first lines
    expect(offscreenAnchorShift([topic], 0 + STREAM_ANCHOR_BAND)).toBe(600);
    // the reader well inside that topic: what they read stays where it is
    expect(offscreenAnchorShift([{ top: 0, previousHeight: 2_000, height: 2_400 }], 300 + STREAM_ANCHOR_BAND)).toBe(0);
  });
});

describe("find in the single stream", () => {
  it("merges the topics' hits newest first, within the limit", () => {
    const hit = (threadId: string, at: number) => ({ threadId, at, messageId: `${threadId}-${at}` }) as Parameters<typeof mergeStreamHits>[0][number][number];
    const merged = mergeStreamHits([[hit("now", 5), hit("now", 1)], [hit("first", 3)]], 2);
    expect(merged.map((entry) => entry.at)).toEqual([5, 3]);
    expect(STREAM_FIND_TOPICS).toBeGreaterThan(1);
  });
});
