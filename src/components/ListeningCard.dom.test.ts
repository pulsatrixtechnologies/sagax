// @vitest-environment happy-dom
// #4100 lot "listening-live-card": the card that floats over the chat while
// listening (the bot's avatar, the red dot, "Listening to Conversation", the
// newest line, the chat control and the red stop; the live transcript under
// it, each line under its speaker, the spoken line in grey), the same card
// followed from another device (newest line and Stop from the row), the row
// drawing nothing while live (the card says it once), its settled form with
// Transcript, and the sidebar badge.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { ListeningLive } from "@/lib/listening/listening-session";
import type { Bot, Message } from "@/state/store";

let live: ListeningLive | null = null;
const stopListening = vi.fn(async () => {});
vi.mock("@/lib/listening/listening-session", () => ({
  useListening: () => live,
  stopListening: () => stopListening(),
}));
vi.mock("./Avatar", () => ({ BotAvatar: () => createElement("span", { "data-avatar": "" }) }));
vi.mock("@/state/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/state/store")>();
  return { ...actual, api: vi.fn(async () => ({})) };
});

import { api } from "@/state/store";
import { ListeningBadge, ListeningCard, ListeningRowLine, listenedLine } from "./ListeningCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
beforeEach(() => {
  setLocale("en");
  live = null;
  stopListening.mockClear();
  vi.mocked(api).mockReset();
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function mount(element: ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(element));
  return host;
}

const bot = { id: "bot-a", name: "Rocket", color: "blue", threadId: "t-1", tasks: [] } as unknown as Bot;

function listening(): ListeningLive {
  return {
    botId: "bot-a", threadId: "t-1", sessionId: "ls_aaaaaaaaaaaaaaaaaaaa", phase: "listening", startedAt: 1, sources: { microphone: true, computer: false },
    view: {
      lines: [{ seq: 1, at: 1, speaker: "s1", text: "Can we ship it on Friday?" }],
      partial: { microphone: "Okay, I'll put that in the brief" },
      speakers: [{ key: "s1", label: "Speaker 1" }],
    },
    liveSpeaker: { microphone: "Speaker 2" },
    error: null,
  };
}

describe("the listening card (#4100)", () => {
  it("floats with the avatar, the red dot, the title, the newest line and the live transcript", () => {
    live = listening();
    const host = mount(createElement(ListeningCard, { bot, messages: [] }));
    const card = host.querySelector("[data-listening-card='here']")!;
    expect(card.querySelector("[data-avatar]")).not.toBeNull();
    expect(card.querySelector("[data-listening-dot]")?.className).toContain("bg-danger");
    // the short title fits a 390px phone; the region keeps the full name
    expect(card.textContent).toMatch(/^Listening(?! to)/);
    expect(card.querySelector('[role="region"]')?.getAttribute("aria-label")).toBe("Listening to Conversation");
    expect(card.querySelector("[data-listening-sources]")?.textContent).toBe("Microphone");
    expect(card.querySelector("[data-listening-newest]")?.textContent).toBe("Speaker 2 Okay, I'll put that in the brief");
    const lines = Array.from(card.querySelectorAll("[data-listening-line]"));
    expect(lines.map((line) => [line.getAttribute("data-listening-line"), line.textContent])).toEqual([
      ["final", "Speaker 1Can we ship it on Friday?"],
      ["live", "Speaker 2Okay, I'll put that in the brief"],
    ]);
    // the spoken line is grey until it is final
    expect(lines[1]!.querySelector("p")!.className).toContain("text-ink-secondary");
    expect(lines[0]!.querySelector("p")!.className).toContain("text-ink");
    expect(card.querySelector("[data-listening-stop]")?.className).toContain("bg-danger");
  });

  it("switches between the live transcript and the conversation, the card staying on top", () => {
    live = listening();
    const host = mount(createElement(ListeningCard, { bot, messages: [] }));
    const chat = host.querySelector<HTMLButtonElement>("[data-listening-chat]")!;
    expect(chat.getAttribute("aria-label")).toBe("Show the conversation");
    act(() => chat.click());
    expect(host.querySelector("[data-listening-transcript]")).toBeNull();
    expect(host.querySelector("[data-listening-card]")).not.toBeNull();
    expect(chat.getAttribute("aria-label")).toBe("Show the live transcript");
    act(() => chat.click());
    expect(host.querySelector("[data-listening-transcript]")).not.toBeNull();
  });

  it("stops this window's session from its red button", async () => {
    live = listening();
    const host = mount(createElement(ListeningCard, { bot, messages: [] }));
    await act(async () => host.querySelector<HTMLButtonElement>("[data-listening-stop]")!.click());
    expect(stopListening).toHaveBeenCalledOnce();
  });

  it("follows a session of another device from its row, and stops it on the server", async () => {
    const row = { id: "m1", role: "bot", kind: "text", text: "Listening to a conversation", at: 1,
      listening: { sessionId: "ls_bbbbbbbbbbbbbbbbbbbb", state: "listening", startedAt: 1, lineCount: 3, speakers: [], last: { speaker: "Speaker 2", text: "Friday then." } } } as unknown as Message;
    const host = mount(createElement(ListeningCard, { bot, messages: [row] }));
    expect(host.querySelector("[data-listening-card='elsewhere']")).not.toBeNull();
    expect(host.querySelector("[data-listening-newest]")?.textContent).toBe("Speaker 2 Friday then.");
    expect(host.querySelector("[data-listening-chat]")).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>("[data-listening-stop]")!.click());
    expect(api).toHaveBeenCalledWith("/api/listening/ls_bbbbbbbbbbbbbbbbbbbb/stop", { method: "POST" });
  });

  it("shows nothing once no session is on", () => {
    const row = { id: "m1", role: "bot", kind: "text", at: 1, listening: { sessionId: "ls_bbbbbbbbbbbbbbbbbbbb", state: "ended", startedAt: 1, endedAt: 2, lineCount: 0, speakers: [] } } as unknown as Message;
    const host = mount(createElement(ListeningCard, { bot, messages: [row] }));
    expect(host.querySelector("[data-listening-card]")).toBeNull();
  });
});

describe("the listening row (#4100)", () => {
  it("draws nothing while listening: the floating card is the one place that says it", () => {
    const row = { id: "m1", role: "bot", kind: "text", text: "Listening to a conversation", at: 1, listening: { sessionId: "ls_bbbbbbbbbbbbbbbbbbbb", state: "listening", startedAt: 1, lineCount: 0, speakers: [] } } as unknown as Message;
    const host = mount(createElement(ListeningRowLine, { message: row }));
    expect(host.querySelector("[data-listening-row]")).toBeNull();
    expect(host.textContent).toBe("");
  });

  it("with the card on screen, the live session is said once", () => {
    const row = { id: "m1", role: "bot", kind: "text", text: "Listening to a conversation", at: 1,
      listening: { sessionId: "ls_bbbbbbbbbbbbbbbbbbbb", state: "listening", startedAt: 1, lineCount: 1, speakers: [], last: { speaker: "Speaker 1", text: "Friday then." } } } as unknown as Message;
    const host = mount(createElement("div", null, createElement(ListeningCard, { bot, messages: [row] }), createElement(ListeningRowLine, { message: row })));
    expect(host.querySelectorAll('[role="region"][aria-label="Listening to Conversation"]').length).toBe(1);
    expect(host.textContent).not.toContain("Listening to a conversation");
    expect(host.querySelectorAll("[data-listening-row]").length).toBe(0);
  });

  it("settles into one line with the transcript, read-only, behind Transcript", async () => {
    vi.mocked(api).mockResolvedValue({
      session: { sessionId: "ls_bbbbbbbbbbbbbbbbbbbb", speakers: [{ key: "s1", label: "Speaker 1" }, { key: "s2", label: "Ada" }] },
      lines: [{ seq: 1, at: 1, speaker: "s1", text: "We ship Friday." }, { seq: 2, at: 2, speaker: "s2", text: "I'll put that in the brief." }],
    });
    const listeningCard = { sessionId: "ls_bbbbbbbbbbbbbbbbbbbb", state: "ended", startedAt: 0, endedAt: 24 * 60_000, lineCount: 2, speakers: [{ key: "s1", label: "Speaker 1" }, { key: "s2", label: "Ada" }, { key: "s3", label: "Speaker 2" }] };
    const row = { id: "m1", role: "bot", kind: "text", at: 1, listening: listeningCard } as unknown as Message;
    const host = mount(createElement(ListeningRowLine, { message: row }));
    expect(host.textContent).toContain("Listened 24 min, 3 speakers");
    await act(async () => host.querySelector<HTMLButtonElement>("[data-listening-open-transcript]")!.click());
    expect(api).toHaveBeenCalledWith("/api/listening/ls_bbbbbbbbbbbbbbbbbbbb");
    expect(host.querySelector("[data-listening-full-transcript]")?.textContent).toBe("Speaker 1We ship Friday.AdaI'll put that in the brief.");
    expect(listenedLine({ startedAt: 0, endedAt: 60_000, speakers: [{ key: "s1", label: "Speaker 1" }] })).toBe("Listened 1 min, 1 speaker");
  });

  it("says the transcript cannot be read when the answer carries no lines, instead of breaking", async () => {
    vi.mocked(api).mockResolvedValue({});
    const row = { id: "m1", role: "bot", kind: "text", at: 1, listening: { sessionId: "ls_bbbbbbbbbbbbbbbbbbbb", state: "ended", startedAt: 0, endedAt: 60_000, lineCount: 2, speakers: [] } } as unknown as Message;
    const host = mount(createElement(ListeningRowLine, { message: row }));
    await act(async () => host.querySelector<HTMLButtonElement>("[data-listening-open-transcript]")!.click());
    expect(host.querySelector("[data-listening-row='ended'] [role='alert']")?.textContent).toBe("This transcript could not be read here.");
  });
});

describe("the listening badge (#4100)", () => {
  it("marks the bot this window listens to", () => {
    live = listening();
    const host = mount(createElement("div", null, createElement(ListeningBadge, { botId: "bot-a" }), createElement(ListeningBadge, { botId: "bot-b" })));
    expect(host.querySelectorAll("[data-listening-badge]")).toHaveLength(1);
  });
});

describe("the listening card when nothing is transcribed (#5377)", () => {
  it("says the reason once and never that nobody has spoken", () => {
    const reason = "xAI has no credits left for the organization's xAI key. Ask an admin, or add your own xAI key in Settings > Providers. The answers stay in the chat.";
    live = { ...listening(), view: { lines: [], partial: {}, speakers: [] }, liveSpeaker: {}, error: reason };
    const host = mount(createElement(ListeningCard, { bot, messages: [] }));
    const card = host.querySelector("[data-listening-card='here']")!;
    expect(card.querySelector('[role="alert"]')?.textContent).toBe(reason);
    expect(card.textContent).not.toContain("nobody has spoken yet");
    expect(card.textContent!.split(reason)).toHaveLength(2);
    // still listening: the person stops it from the same red button
    expect(card.querySelector("[data-listening-stop]")).not.toBeNull();
  });

  it("still says it is waiting while nothing is wrong", () => {
    live = { ...listening(), view: { lines: [], partial: {}, speakers: [] }, liveSpeaker: {} };
    const host = mount(createElement(ListeningCard, { bot, messages: [] }));
    expect(host.querySelector("[data-listening-newest]")?.textContent).toBe("Listening… nobody has spoken yet.");
  });
});
