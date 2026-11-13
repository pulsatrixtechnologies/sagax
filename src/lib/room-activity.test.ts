import { describe, expect, it } from "vitest";

import { roomActivityVisible } from "./room-activity";
import type { Message } from "@/state/store";

const chip = (partial: Partial<Message>): Message => ({
  id: "m",
  role: "bot",
  kind: "activity",
  at: 1,
  tool: { name: "Read a file", ok: true },
  ...partial,
});

describe("roomActivityVisible", () => {
  it("hides an ordinary finished step unless tool calls are on", () => {
    expect(roomActivityVisible(chip({}), false)).toBe(false);
    expect(roomActivityVisible(chip({}), true)).toBe(true);
  });

  // a stopped turn's status line stays; a technical notice or recovery line
  // is a hidden status line the chat and the room both leave out (#4171)
  it("always shows a stopped turn and leaves hidden status lines out, as the chat does", () => {
    expect(roomActivityVisible(chip({ tool: { name: "stopped: Stopped", ok: true } }), false)).toBe(true);
    expect(roomActivityVisible(chip({ tool: { name: "notice: OpenCode no longer offers a, so this conversation uses b.", ok: true } }), false)).toBe(false);
    expect(roomActivityVisible(chip({ tool: { name: "recovery: Automatic recovery: trying a backup once.", ok: true } }), false)).toBe(false);
  });

  // #4171: one rule with the chat (activityRowShown): a failed turn stays,
  // a plain failed step goes with the other steps when tool calls are off
  it("always shows a failed turn and hides a plain failed step with tool calls off", () => {
    expect(roomActivityVisible(chip({ tool: { name: "error: engine missing" } }), false)).toBe(true);
    expect(roomActivityVisible(chip({ tool: { name: "Ran a command", ok: false } }), false)).toBe(false);
    expect(roomActivityVisible(chip({ tool: { name: "Ran a command", ok: false } }), true)).toBe(true);
  });

  it("leaves a stopped turn out of the chat", () => {
    const stopped = chip({ tool: { name: "error: turn stopped", ok: false } });
    expect(roomActivityVisible(stopped, false)).toBe(false);
    expect(roomActivityVisible(stopped, true)).toBe(false);
  });

  // the trace that a teammate was consulted must not depend on a developer
  // flag that is off for everyone
  it("always shows an opened-thread chip, the only trace a bot started a thread", () => {
    const opened = chip({
      tool: { name: "Opened thread #QA PR 245 on Scout", ok: true },
      threadRef: { botId: "scout", threadId: "qa-245", title: "QA PR 245" },
    });
    expect(roomActivityVisible(opened, false)).toBe(true);
  });

  // Owner 2026-10-22: a bot-to-bot comm chip is verbose detail, not a trace the
  // clean chat keeps. With tool calls (the details toggle) off it goes with
  // the other steps; a failed send still shows as a failure.
  it("shows a bot-to-bot comm chip only when tool calls are on", () => {
    const comm = chip({
      tool: { name: "Messaged @Ada" },
      comm: { groupId: "g1", withBotId: "ada", withName: "Ada", withColor: "teal" },
    });
    expect(roomActivityVisible(comm, false)).toBe(false);
    expect(roomActivityVisible(comm, true)).toBe(true);
  });

  it("still shows a failed comm chip with tool calls off", () => {
    const failed = chip({
      tool: { name: "Messaged @Ada", ok: false },
      comm: { groupId: "g1", withBotId: "ada", withName: "Ada", withColor: "teal" },
    });
    expect(roomActivityVisible(failed, false)).toBe(true);
  });

  it("is not for text or cards", () => {
    expect(roomActivityVisible(chip({ kind: "text", text: "hi", tool: undefined }), true)).toBe(false);
  });

  // iPhone / iPad web reads tool calls as off (showToolCallRows)
  it("hides every tool receipt on iOS, including Error badges, and keeps the rest", () => {
    const ios = true;
    expect(roomActivityVisible(chip({ tool: { name: "Read", ok: true } }), false, ios)).toBe(false);
    expect(roomActivityVisible(chip({ tool: { name: "Bash" } }), false, ios)).toBe(false);
    expect(roomActivityVisible(chip({ tool: { name: "Write", ok: false } }), false, ios)).toBe(false);
    expect(roomActivityVisible(chip({ tool: { name: "stopped: Stopped", ok: true } }), false, ios)).toBe(true);
    expect(roomActivityVisible(chip({ tool: { name: "error: boom", ok: false } }), false, ios)).toBe(true);
    expect(roomActivityVisible(chip({
      tool: { name: "Parallel task" },
      parallelTask: { threadId: "p", title: "T", requestMessageId: "r", role: "card" },
    }), false, ios)).toBe(true);
    expect(roomActivityVisible(chip({
      tool: { name: "Messaged @Ada" },
      comm: { groupId: "g", withBotId: "ada", withName: "Ada", withColor: "teal" },
    }), false, ios)).toBe(true);
    expect(roomActivityVisible(chip({
      tool: { name: "Opened thread" },
      threadRef: { botId: "b", threadId: "t", title: "Opened" },
    }), false, ios)).toBe(true);
  });
});
