import { describe, expect, it, vi } from "vitest";
import { callCoreTool, DEF_SEND_TO_BOT, DEF_SET_REPLY_NOTIFY } from "./core.ts";
import { callRoomsTool, DEF_MESSAGE_PERSON, DEF_MESSAGE_USER, DEF_POST_TO_ROOM } from "./rooms.ts";
import type { ToolCallContext } from "../agents-call-types.ts";

// A bot can write into the chat without alerting anyone: every tool through
// which it writes takes notify (default true), and set_reply_notify does the
// same for the reply it is writing now.
describe("notify on the tools a bot writes with", () => {
  it("every writing tool exposes notify as a boolean, never required except on set_reply_notify", () => {
    for (const def of [DEF_POST_TO_ROOM, DEF_MESSAGE_USER, DEF_MESSAGE_PERSON, DEF_SEND_TO_BOT]) {
      const props = def.inputSchema.properties as Record<string, { type?: string; description?: string }>;
      expect(props.notify?.type, def.name).toBe("boolean");
      expect(props.notify?.description, def.name).toMatch(/Default true/);
      expect((def.inputSchema as { required?: string[] }).required ?? [], def.name).not.toContain("notify");
    }
    expect(DEF_SET_REPLY_NOTIFY.name).not.toContain("__");
    expect(DEF_SET_REPLY_NOTIFY.inputSchema.required).toEqual(["notify"]);
  });

  it("post_to_room, message_user and message_person pass notify false, and true when left out", async () => {
    const api = vi.fn(async (_path: string, _options?: { body?: string }) => ({ ok: true }));
    const context = { botId: "bot", threadId: "t1", client: { api } } as unknown as ToolCallContext;
    await callRoomsTool("post_to_room", { group_id: "g1", message: "progress", notify: false }, context);
    await callRoomsTool("message_user", { user: "me", text: "log", notify: false }, context);
    await callRoomsTool("message_person", { principal_id: "p1", message: "fyi", notify: false }, context);
    await callRoomsTool("post_to_room", { group_id: "g1", message: "done" }, context);
    const bodies = api.mock.calls.map((call) => JSON.parse(String(call[1]?.body ?? "{}")) as { notify?: boolean });
    expect(bodies.map((body) => body.notify)).toEqual([false, false, false, true]);
  });

  it("send_to_bot passes notify, and set_reply_notify sets this turn's reply", async () => {
    const api = vi.fn(async (path: string, _options?: { body?: string }) =>
      path === "/api/internal/reply-notify" ? { ok: true, notify: false } : { threadId: "t2", state: "running", botName: "Bo", title: "x" });
    const context = { botId: "bot", threadId: "t1", client: { api } } as unknown as ToolCallContext;
    await callCoreTool("send_to_bot", { bot_id: "bo", title: "x", message: "do it", notify: false }, context);
    expect(JSON.parse(String(api.mock.calls[0]![1]!.body)).notify).toBe(false);
    const result = await callCoreTool("set_reply_notify", { notify: false }, context);
    expect(api.mock.calls[1]![0]).toBe("/api/internal/reply-notify");
    expect(JSON.parse(String(api.mock.calls[1]![1]!.body))).toEqual({ fromBotId: "bot", fromThreadId: "t1", notify: false });
    expect(result?.isError).toBeUndefined();
  });
});
