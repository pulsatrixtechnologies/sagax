// The side thread (the reference design's threads beside the main chat): one at a time,
// its own copy of the messages from the newest page and the live stream.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/state/store";
import {
  applySideFrame,
  applySidePage,
  closeSideThread,
  currentSideThread,
  EMPTY_SIDE_TRANSCRIPT,
  openSideThread,
  prependOlder,
  sideThreadRedundant,
  wantsSideThread,
} from "./side-thread";

const message = (id: string, parentId: string | null = null, text = id): Message =>
  ({ id, role: "bot", kind: "text", text, at: 1, parentId } as Message);

afterEach(() => closeSideThread());

describe("the open side thread", () => {
  it("holds one thread at a time and closes", () => {
    expect(currentSideThread()).toBeNull();
    openSideThread({ botId: "scout", threadId: "a" });
    openSideThread({ botId: "pepper", threadId: "b" });
    expect(currentSideThread()).toEqual({ botId: "pepper", threadId: "b" });
    closeSideThread();
    expect(currentSideThread()).toBeNull();
  });

  it("keeps the same object when the same thread is opened again", () => {
    openSideThread({ botId: "scout", threadId: "a" });
    const first = currentSideThread();
    openSideThread({ botId: "scout", threadId: "a" });
    expect(currentSideThread()).toBe(first);
  });

  it("closes itself when the main chat shows that thread or it is gone", () => {
    const side = { botId: "scout", threadId: "a" };
    const bots = [{ id: "scout", threadId: "main", tasks: [{ threadId: "main" }, { threadId: "a" }] }];
    expect(sideThreadRedundant(side, { selectedId: "scout", activeView: "chat", bots })).toBe(false);
    // the main chat moved onto it
    expect(sideThreadRedundant(side, { selectedId: "scout", activeView: "chat", bots: [{ ...bots[0]!, threadId: "a" }] })).toBe(true);
    // the same thread open on the bot but another page in front: still useful
    expect(sideThreadRedundant(side, { selectedId: "scout", activeView: "routines", bots: [{ ...bots[0]!, threadId: "a" }] })).toBe(false);
    // the thread or the bot was deleted
    expect(sideThreadRedundant(side, { selectedId: "scout", activeView: "chat", bots: [{ id: "scout", threadId: "main", tasks: [{ threadId: "main" }] }] })).toBe(true);
    expect(sideThreadRedundant(side, { selectedId: null, activeView: "chat", bots: [] })).toBe(true);
  });

  it("opens beside on Option-click (Alt-click) only, not with other modifiers", () => {
    expect(wantsSideThread({ altKey: true, metaKey: false, ctrlKey: false, shiftKey: false })).toBe(true);
    expect(wantsSideThread({ altKey: false, metaKey: false, ctrlKey: false, shiftKey: false })).toBe(false);
    expect(wantsSideThread({ altKey: true, metaKey: true, ctrlKey: false, shiftKey: false })).toBe(false);
    expect(wantsSideThread({ altKey: true, metaKey: false, ctrlKey: false, shiftKey: true })).toBe(false);
  });
});

describe("the side thread's transcript", () => {
  it("prepends older pages without duplicating messages already held", () => {
    const held = { messages: [message("c"), message("d", "c")], activeLeafId: "d", loaded: true };
    const next = prependOlder(held, [message("a"), message("b", "a"), message("c")]);
    expect(next.messages.map((m) => m.id)).toEqual(["a", "b", "c", "d"]);
    expect(next.activeLeafId).toBe("d");
  });

  it("takes the newest page and keeps a live message that arrived before it", () => {
    const early = applySideFrame(EMPTY_SIDE_TRANSCRIPT, { kind: "message", threadId: "a", message: message("m3", "m2") }, "a");
    expect(early.loaded).toBe(false);
    const loaded = applySidePage(early, { messages: [message("m1"), message("m2", "m1")], activeLeafId: "m2" });
    expect(loaded.loaded).toBe(true);
    expect(loaded.messages.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    expect(loaded.activeLeafId).toBe("m3");
    // a page that already has it does not repeat it
    const again = applySidePage(loaded, { messages: [message("m1"), message("m2", "m1"), message("m3", "m2")], activeLeafId: "m3" });
    expect(again.messages.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("follows its own thread's frames and ignores every other thread's", () => {
    const start = applySidePage(EMPTY_SIDE_TRANSCRIPT, { messages: [message("m1")], activeLeafId: "m1" });
    expect(applySideFrame(start, { kind: "message", threadId: "other", message: message("x", "m1") }, "a")).toBe(start);
    expect(applySideFrame(start, { kind: "screen", threadId: "a" }, "a")).toBe(start);
    const appended = applySideFrame(start, { kind: "message", threadId: "a", message: message("m2", "m1") }, "a");
    expect(appended.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(appended.activeLeafId).toBe("m2");
    // the same message twice (the send answer and the stream) is folded
    expect(applySideFrame(appended, { kind: "message", threadId: "a", message: message("m2", "m1") }, "a")).toBe(appended);
  });

  // #4039: a row the server took back leaves the column at once
  it("drops a removed message, the only one included", () => {
    const alone = applySidePage(EMPTY_SIDE_TRANSCRIPT, { messages: [message("m1")], activeLeafId: "m1" });
    const empty = applySideFrame(alone, { kind: "message.removed", threadId: "a", messageId: "m1" }, "a");
    expect(empty.messages).toEqual([]);
    expect(empty.activeLeafId).toBeNull();
    const two = applySidePage(EMPTY_SIDE_TRANSCRIPT, { messages: [message("m1"), message("m2", "m1")], activeLeafId: "m2" });
    const one = applySideFrame(two, { kind: "message.removed", threadId: "a", messageId: "m2" }, "a");
    expect(one.messages.map((m) => m.id)).toEqual(["m1"]);
    expect(one.activeLeafId).toBe("m1");
    expect(applySideFrame(one, { kind: "message.removed", threadId: "a", messageId: "m2" }, "a")).toBe(one);
  });

  it("keeps the leaf on a late artifact parented elsewhere, like the store", () => {
    const start = applySidePage(EMPTY_SIDE_TRANSCRIPT, { messages: [message("m1"), message("m2", "m1")], activeLeafId: "m2" });
    const late = applySideFrame(start, { kind: "message", threadId: "a", message: message("shot", "m1") }, "a");
    expect(late.messages.map((m) => m.id)).toEqual(["m1", "m2", "shot"]);
    expect(late.activeLeafId).toBe("m2");
  });

  it("replaces a patched message and moves the leaf on a thread frame", () => {
    const start = applySidePage(EMPTY_SIDE_TRANSCRIPT, { messages: [message("m1"), message("m2", "m1", "old")], activeLeafId: "m2" });
    const patched = applySideFrame(start, { kind: "message.patch", threadId: "a", message: message("m2", "m1", "new") }, "a");
    expect(patched.messages[1]?.text).toBe("new");
    expect(applySideFrame(start, { kind: "message.patch", threadId: "a", message: message("missing") }, "a")).toBe(start);
    const rewound = applySideFrame(patched, { kind: "thread", threadId: "a", activeLeafId: "m1" }, "a");
    expect(rewound.activeLeafId).toBe("m1");
    expect(applySideFrame(rewound, { kind: "thread", threadId: "a", activeLeafId: "m1" }, "a")).toBe(rewound);
  });
});

describe("the side thread's width", () => {
  it("is stored under its own key and bounds, apart from the docked panels", async () => {
    const stored = new Map<string, string>([["omb-settings-panel-width", "400"], ["sagax.sideThread.width.v1", "820"]]);
    vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
    try {
      const { readDockedPanelWidth, DOCKED_PANEL_DEFAULT_WIDTH } = await import("@/components/DockedPanelResize");
      const { SIDE_THREAD_WIDTH_KEY, SIDE_THREAD_MIN_WIDTH, SIDE_THREAD_MAX_WIDTH, SIDE_THREAD_DEFAULT_WIDTH } = await import("./side-thread");
      const bounds = { key: SIDE_THREAD_WIDTH_KEY, min: SIDE_THREAD_MIN_WIDTH, max: SIDE_THREAD_MAX_WIDTH, fallback: SIDE_THREAD_DEFAULT_WIDTH };
      expect(readDockedPanelWidth()).toBe(400);
      // 820 is past the docked panels' 720 but inside the side thread's bounds
      expect(readDockedPanelWidth(bounds)).toBe(820);
      stored.set(SIDE_THREAD_WIDTH_KEY, "2000");
      expect(readDockedPanelWidth(bounds)).toBe(SIDE_THREAD_DEFAULT_WIDTH);
      stored.delete("omb-settings-panel-width");
      expect(readDockedPanelWidth()).toBe(DOCKED_PANEL_DEFAULT_WIDTH);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
