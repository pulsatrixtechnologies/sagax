// 2026-11-09: what a bot that reads "Waiting for you" waits on, named, and
// where its card is drawn (server/approvals/waiting-on.ts).
import { describe, expect, it } from "vitest";

import { liveCardKind } from "../../shared/live-approval.ts";
import type { OptionCardData, WireMessage } from "../../shared/wire.ts";
import { WAITING_ON_TEXT_MAX, teammateNames, waitingOnCard, waitingOnText } from "./waiting-on.ts";

const card = (over: Partial<OptionCardData> = {}): OptionCardData => ({ title: "Which repo should I file it in?", subtitle: "", options: ["sagax", "perspicax"], requestId: "q1", ...over });
const row = (id: string, c?: OptionCardData): WireMessage => ({ id, role: "bot", kind: c ? "options" : "text", text: c ? undefined : "hi", ...(c ? { card: c } : {}) } as WireMessage);

describe("waitingOnText", () => {
  it("reads a question by its own words", () => {
    expect(waitingOnText(card())).toBe("Which repo should I file it in?");
  });

  it("reads an approval by its plain sentence, else its summary", () => {
    expect(waitingOnText(card({ title: "Approval needed", subtitle: "rm -rf build", tool: "Bash", plain: { title: "Allow Ember to run a command?", line: "" } }))).toBe("Allow Ember to run a command?");
    expect(waitingOnText(card({ title: "Approval needed", subtitle: "rm -rf build", tool: "Bash" }))).toBe("rm -rf build");
  });

  it("keeps one short line", () => {
    const text = waitingOnText(card({ title: `Log  the\ntime ${"x".repeat(300)}` }));
    expect(text.startsWith("Log the time x")).toBe(true);
    expect(text.length).toBe(WAITING_ON_TEXT_MAX);
    expect(text.endsWith("…")).toBe(true);
  });
});

describe("waitingOnCard", () => {
  const threads: Record<string, WireMessage[]> = {
    main: [row("m1"), row("m2", card({ requestId: "old", answered: "sagax" }))],
    older: [row("o1", card({ title: "Log 2 h on ticket 42?" })), row("o2")],
    mirrored: [row("s1", card({ approvalDestination: { threadId: "main", messageId: "m9" } }))],
    expired: [row("e1", card({ expired: true }))],
  };
  const messagesFor = (id: string) => threads[id] ?? [];

  it("finds the open card in an older thread when the selected one has none", () => {
    expect(waitingOnCard(["main", "older"], messagesFor, liveCardKind)).toEqual({ threadId: "older", messageId: "o1", text: "Log 2 h on ticket 42?" });
  });

  it("points at the copy the chat draws when the card was mirrored", () => {
    expect(waitingOnCard(["mirrored"], messagesFor, liveCardKind)).toMatchObject({ threadId: "main", messageId: "m9" });
  });

  it("waits on nothing once every card is answered or expired", () => {
    expect(waitingOnCard(["main", "expired", "main"], messagesFor, liveCardKind)).toBeUndefined();
  });
});

describe("teammateNames", () => {
  it("names each awaited teammate once, skipping unknown bots", () => {
    const names: Record<string, string> = { a: "Marc", b: "Ember" };
    expect(teammateNames(["a", "b", "a", "gone"], (id) => names[id])).toEqual(["Marc", "Ember"]);
  });
});
