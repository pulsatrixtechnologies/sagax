import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { nudgeLineText } from "@/lib/nudge-line";
import { StoreProvider, type Group, type Message } from "@/state/store";

// Replaced whole: its context default reads window.ogb at import time. An
// empty caption chrome is the non-Windows layout.
vi.mock("./DesktopCapabilities", () => ({
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false } } }),
  useCaptionChrome: () => ({}),
  useMacInsetChrome: () => ({}),
}));

// Threads on: these cases check that an opened-thread receipt still renders
// its "Go to conversation" chip. ThreadChip now hides it when threads are
// off (that is covered in ThreadChip.test.ts).
vi.mock("@/lib/thread-preferences", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/thread-preferences")>(),
  useShowThreads: () => true,
}));

import { GroupView, RoomToolChip } from "./GroupView";

const chip = (patch: Partial<Message> = {}): Message => ({
  id: "chip",
  role: "bot",
  kind: "activity",
  at: 1,
  tool: { name: "Posted in Standup", ok: true },
  ...patch,
});

const render = (message: Message) =>
  renderToStaticMarkup(createElement(StoreProvider, null, createElement(RoomToolChip, { message })));

describe("RoomToolChip", () => {
  it("turns a linked receipt into a button that opens the room it names", () => {
    const markup = render(chip({
      comm: { groupId: "room-standup", withBotId: "scout", withName: "Standup", withColor: "green" },
    }));
    expect(markup).toContain("<button");
    expect(markup).toContain("Posted in Standup");
    expect(markup).toContain('title="Open Standup"');
  });

  it("turns an opened-thread receipt into a button that opens that thread", () => {
    const markup = render(chip({
      tool: { name: "Opened thread #QA PR 245 on Scout", ok: true },
      threadRef: { botId: "scout", threadId: "qa-245", title: "QA PR 245" },
    }));
    expect(markup).toContain("<button");
    expect(markup).toContain("Go to conversation");
    expect(markup).not.toContain("Opened thread #QA PR 245 on Scout");
    expect(markup).toContain('title="Open #QA PR 245"');
  });

  it("draws no opened-thread chip when the server marked its thread gone", () => {
    const base = chip({
      tool: { name: "Opened thread #QA PR 245 on Scout", ok: true },
      threadRef: { botId: "scout", threadId: "qa-245", title: "QA PR 245", gone: true },
    });
    expect(render(base)).toBe("");
    expect(render({ ...base, threadRef: { ...base.threadRef!, gone: false } })).toContain("Go to conversation");
  });

  it("leaves an ordinary step as a quiet step row that goes nowhere", () => {
    const markup = render(chip());
    expect(markup).toContain("data-step-row");
    expect(markup).not.toContain('title="Open');
    expect(markup).toContain("Posted in Standup");
  });

  it("shows a same-room teammate avatar without adding a navigation button", () => {
    const message = chip({
      tool: { name: "Sent to Eli", ok: true },
      comm: { groupId: "here", withBotId: "eli", withName: "Eli", withColor: "green" },
    });
    const markup = renderToStaticMarkup(createElement(StoreProvider, null,
      createElement(RoomToolChip, { message, roomId: "here" })));
    expect(markup).toContain("Sent to Eli");
    expect(markup).toContain('aria-label="Eli"');
    expect(markup).not.toContain("<button");
  });
});

describe("room header", () => {
  const room: Group = {
    id: "room", threadId: "room-thread", name: "Launch planning", memberIds: [],
    defaultResponder: { kind: "member", botId: "atlas" }, bulletin: "", unread: false,
    createdAt: 1, setupCompletedAt: 1, messages: [],
  };

  it("names the room in the centred header pill", () => {
    // Sagax keeps its centred room header (the bot panel shell); upstream's
    // wrapping two-line header is not used.
    vi.stubGlobal("window", { ogb: undefined });
    let markup: string;
    try {
      markup = renderToStaticMarkup(createElement(StoreProvider, null, createElement(GroupView, { group: room })));
    } finally {
      vi.unstubAllGlobals();
    }
    expect(markup).toContain("@container/chathead");
    expect(markup).toMatch(/<span class="truncate[^"]*">Launch planning<\/span>/);
    expect(markup).not.toContain("data-nudge");
  });

  it("offers a nudge on a group chat that names someone else", () => {
    vi.stubGlobal("window", { ogb: undefined });
    const roomWithPeople: Group = {
      ...room,
      name: "Launch planning",
      humanIds: ["local-owner", "pr_ada"],
    };
    let markup: string;
    try {
      markup = renderToStaticMarkup(createElement(StoreProvider, null, createElement(GroupView, { group: roomWithPeople })));
    } finally {
      vi.unstubAllGlobals();
    }
    const actionsAt = markup.indexOf("data-composer-actions");
    const actionsEnd = markup.indexOf("pointer-events-auto", actionsAt);
    const actions = markup.slice(actionsAt, actionsEnd);
    const buttons = [...actions.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]);
    expect(buttons.at(-1)).toContain('data-nudge="room"');
    expect(actions).toContain('aria-label="Nudge Launch planning"');
  });

  it("hides the group nudge when the viewer is the only person listed", () => {
    vi.stubGlobal("window", { ogb: undefined });
    const alone: Group = { ...room, humanIds: ["local-owner", "user:local-owner"] };
    let markup: string;
    try {
      markup = renderToStaticMarkup(createElement(StoreProvider, null, createElement(GroupView, { group: alone })));
    } finally {
      vi.unstubAllGlobals();
    }
    expect(markup).not.toContain("data-nudge");
  });

  it("offers a nudge only on a conversation with a person, last in the composer", () => {
    vi.stubGlobal("window", { ogb: undefined });
    const dm: Group = {
      ...room,
      id: "dm",
      name: "Ada",
      peopleDm: true,
      humanIds: ["local-owner", "pr_ada"],
    };
    let markup: string;
    try {
      markup = renderToStaticMarkup(createElement(StoreProvider, null, createElement(GroupView, { group: dm })));
    } finally {
      vi.unstubAllGlobals();
    }
    const actionsAt = markup.indexOf("data-composer-actions");
    expect(actionsAt).toBeGreaterThan(0);
    expect(markup.slice(0, actionsAt)).not.toContain("data-nudge");
    const actions = markup.slice(actionsAt).match(/data-composer-actions[\s\S]*?<\/div>/)?.[0] ?? "";
    const buttons = [...actions.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]);
    expect(buttons.at(-1)).toContain('data-nudge="pr_ada"');
    expect(actions).toContain('aria-label="Nudge Ada"');
    expect(markup).not.toContain("Nudge sent");
    expect(markup).not.toContain("Secousse envoyée");
  });

  it("draws an accepted nudge as its own line, for the sender and the other person", () => {
    const note = { fromId: "pr_jean", fromName: "Jean-Christophe", toId: "pr_ada", toName: "Ada" };
    expect(nudgeLineText(note, "pr_jean")).toBe("You sent a nudge to Ada.");
    expect(nudgeLineText(note, "pr_ada")).toBe("Jean-Christophe sent you a nudge.");
    const groupNote = { ...note, toId: "room", toName: "Launch planning", groupId: "room" };
    expect(nudgeLineText(groupNote, "pr_jean")).toBe("You sent a nudge in Launch planning.");
    expect(nudgeLineText(groupNote, "pr_ada")).toBe("Jean-Christophe sent a nudge in this chat.");
    setLocale("fr");
    try {
      expect(nudgeLineText(note, "pr_jean")).toBe("Vous avez envoyé une secousse à Ada.");
      expect(nudgeLineText(note, "PR_ADA")).toBe("Jean-Christophe vous a envoyé une secousse.");
      expect(nudgeLineText(groupNote, "pr_jean")).toBe("Vous avez envoyé une secousse dans Launch planning.");
      expect(nudgeLineText(groupNote, "pr_ada")).toBe("Jean-Christophe a envoyé une secousse dans cette conversation.");
    } finally {
      setLocale("en");
    }

    vi.stubGlobal("window", { ogb: undefined });
    const dm: Group = {
      ...room,
      id: "dm",
      name: "Ada",
      peopleDm: true,
      humanIds: ["local-owner", "pr_ada"],
      messages: [{
        id: "nudge-1",
        role: "bot",
        kind: "nudge",
        at: 2,
        nudge: { fromId: "local-owner", fromName: "Jean-Christophe", toId: "pr_ada", toName: "Ada" },
      }],
    };
    let markup: string;
    try {
      markup = renderToStaticMarkup(createElement(StoreProvider, null, createElement(GroupView, { group: dm })));
    } finally {
      vi.unstubAllGlobals();
    }
    expect(markup).toContain('data-nudge-line');
    expect(markup).toContain("You sent a nudge to Ada.");
    expect(markup).not.toContain("data-chat-bubble");
  });
});
