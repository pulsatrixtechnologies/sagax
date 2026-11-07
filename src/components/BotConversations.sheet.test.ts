// @vitest-environment happy-dom
// #1502: a bot-to-bot conversation line opened a blank sheet when its thread
// had no message, or when its messages could not be read.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const reply = vi.hoisted(() => ({ next: [] as Array<() => Promise<unknown>> }));

vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: () => (reply.next.shift() ?? (async () => ({ messages: [] })))(),
}));

import { setLocale } from "@/lib/i18n";
import { setShowThreads } from "@/lib/thread-preferences";
import { BotConversationLine } from "./BotConversations";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// the bot-to-bot line and its sheet exist only with threads on: the unified
// chat (the default) draws none of it (#2291, unified-chat.guard.test.ts)
beforeAll(() => { setLocale("en"); setShowThreads(true); });
afterAll(() => setShowThreads(false));

const self = { id: "kat", name: "Ottoline", color: "green" as const };
const row = { threadId: "w1", otherBotId: "mel", otherName: "Wren", direction: "out" as const, updatedAt: 1 };

describe("bot-to-bot conversation sheet (#1502)", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    reply.next = [];
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  async function openLine() {
    await act(async () => { root.render(createElement(BotConversationLine, { self, row, bots: [] })); });
    await act(async () => {
      host.querySelector<HTMLButtonElement>("[data-testid=bot-exchange-chip]")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("says there is no message yet instead of a blank sheet", async () => {
    reply.next.push(async () => ({ messages: [], hasMore: false, activeLeafId: null }));
    await openLine();
    expect(host.querySelector("[data-testid=bot-exchange-sheet]")).not.toBeNull();
    expect(host.querySelector("[data-testid=bot-exchange-empty]")?.textContent).toContain("Wren");
    expect(host.querySelector("[data-testid=bot-exchange-error]")).toBeNull();
  });

  it("shows a failed read and reads again on Retry", async () => {
    reply.next.push(async () => { throw new Error("offline"); });
    await openLine();
    expect(host.querySelector("[data-testid=bot-exchange-error]")).not.toBeNull();
    expect(host.querySelector("[data-testid=bot-exchange-empty]")).toBeNull();
    reply.next.push(async () => ({ messages: [{ id: "m1", role: "user", kind: "text", text: "Which database?", at: Date.now() }] }));
    await act(async () => {
      host.querySelector<HTMLButtonElement>("[data-testid=bot-exchange-retry]")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.querySelector("[data-testid=bot-exchange-error]")).toBeNull();
    expect(host.textContent).toContain("Which database?");
  });

  it("draws an outside agent's conversation (2026-10-29) with a neutral icon: its lines are the agent's, the replies the bot's", async () => {
    const agentRow = { threadId: "g1", otherBotId: "agent:voice-assistant-phone", otherName: "Voice assistant (phone)", direction: "in" as const, kind: "agent" as const, updatedAt: 1 };
    await act(async () => { root.render(createElement(BotConversationLine, { self, row: agentRow, bots: [] })); });
    expect(host.querySelector("[data-testid=bot-exchange-chip] [data-agent-avatar]")).not.toBeNull();
    reply.next.push(async () => ({ messages: [
      { id: "m1", role: "user", kind: "text", text: "What is on my calendar?", at: Date.now() - 1000, aiClient: true },
      { id: "m2", role: "bot", kind: "text", text: "Two meetings.", at: Date.now() },
    ] }));
    await act(async () => {
      host.querySelector<HTMLButtonElement>("[data-testid=bot-exchange-chip]")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const sheet = host.querySelector("[data-testid=bot-exchange-sheet]")!;
    expect(sheet.textContent).toContain("Voice assistant (phone)");
    expect(sheet.textContent).toContain("Ottoline");
    // the header and the agent's run label carry the icon, never a mascot;
    // like a 1:1 chat the bot answers on the start side, the agent on the end
    expect(sheet.querySelectorAll("[data-agent-avatar]").length).toBe(2);
    expect(sheet.querySelector("[data-mid=m1]")!.getAttribute("data-side")).toBe("end");
    expect(sheet.querySelector("[data-mid=m2]")!.getAttribute("data-side")).toBe("start");
    const agentLabel = sheet.querySelector("[data-mid=m1]")!.previousElementSibling!;
    expect(agentLabel.textContent).toContain("Voice assistant (phone)");
    expect(agentLabel.querySelector("[data-agent-avatar]")).not.toBeNull();
    expect(sheet.querySelector("[data-mid=m2]")!.previousElementSibling!.querySelector("[data-agent-avatar]")).toBeNull();
  });
});
