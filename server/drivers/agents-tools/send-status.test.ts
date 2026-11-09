// send_status and reply "resume" on send_to_bot (#3246).
import { describe, expect, it, vi } from "vitest";
import { callCoreTool, DEF_SEND_STATUS, DEF_SEND_TO_BOT, sendStatusText } from "./core.ts";
import type { ToolCallContext } from "../agents-call-types.ts";

describe("send_status", () => {
  it("is named with a single underscore and steers send_to_bot toward coordinate_bots", () => {
    expect(DEF_SEND_STATUS.name).toBe("send_status");
    expect(DEF_SEND_TO_BOT.description).toContain("coordinate_bots");
    expect(DEF_SEND_TO_BOT.description).toContain("send_status");
    const reply = (DEF_SEND_TO_BOT.inputSchema.properties as Record<string, { enum?: string[] }>).reply;
    expect(reply?.enum).toEqual(["none", "resume"]);
  });

  it("send_to_bot passes reply resume", async () => {
    const api = vi.fn(async (_path: string, _options?: { body?: string }) => ({ threadId: "t2", state: "running", botName: "Bo", title: "x" }));
    const context = { botId: "bot", threadId: "t1", client: { api } } as unknown as ToolCallContext;
    await callCoreTool("send_to_bot", { bot_id: "bo", title: "x", message: "do it", reply: "resume" }, context);
    expect(JSON.parse(String(api.mock.calls[0]![1]!.body)).reply).toBe("resume");
  });

  it("reads one send by thread id", async () => {
    const api = vi.fn(async () => ({ send: { botName: "Bo", title: "x", threadId: "t2", state: "done", summary: "Booked.", reply: "none" } }));
    const context = { botId: "bot", threadId: "t1", client: { api } } as unknown as ToolCallContext;
    const result = await callCoreTool("send_status", { thread_id: "t2" }, context);
    expect(String((api.mock.calls[0] as unknown as [string])[0])).toContain("/api/internal/send-status?");
    expect(String((api.mock.calls[0] as unknown as [string])[0])).toContain("thread_id=t2");
    expect(result?.text).toContain("delivered, done");
    expect(result?.text).toContain("Reply: Booked.");
  });

  it("renders this conversation's sends, or says there are none", () => {
    expect(sendStatusText({ sends: [] })).toBe("No send_to_bot from this conversation yet.");
    const text = sendStatusText({ sends: [{ botName: "Bo", title: "x", threadId: "t2", state: "waiting", question: "Which day?", reply: "resume" }] });
    expect(text).toContain("waiting on the person");
    expect(text).toContain("Its question: Which day?");
    expect(text).toContain("Resumes you when it finishes.");
  });
});
