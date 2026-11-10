import { describe, expect, it } from "vitest";
import { failedTurnTool } from "../../shared/failed-turn.ts";
import { chatFacts, requestIdsIn, type ChatMessageLike } from "./chat-facts.ts";

describe("what the chat says about the problem (#3299)", () => {
  it("reads the last requests, the error, the turn, the model, the request ids and the failed tools", () => {
    const messages: ChatMessageLike[] = [
      { role: "user", kind: "text", text: "first" },
      { role: "bot", kind: "text", text: "answer" },
      { role: "user", kind: "text", text: "second" },
      { role: "user", kind: "text", text: "/feedback earlier report" },
      { role: "user", kind: "text", text: "third" },
      { role: "user", kind: "text", text: "fourth" },
      { role: "bot", kind: "activity", tool: { name: "mail_send", ok: false }, turnId: "turn-9" },
      { role: "bot", kind: "activity", tool: { name: "calendar_read", ok: true }, turnId: "turn-9" },
      { role: "bot", kind: "activity", tool: failedTurnTool("529 overloaded (request_id: req_011CVa7bQx9KmZ3)"), turnId: "turn-9", turnRun: { instanceId: "claude", model: "claude-test-model" } },
    ];
    expect(chatFacts(messages)).toEqual({
      asks: ["second", "third", "fourth"],
      error: "529 overloaded (request_id: req_011CVa7bQx9KmZ3)",
      turnId: "turn-9",
      model: "claude-test-model",
      requestIds: ["req_011CVa7bQx9KmZ3"],
      failedTools: ["mail_send"],
    });
  });

  it("skips the answers to the flow's own question and has no error when the last turn answered", () => {
    const messages: ChatMessageLike[] = [
      { role: "user", kind: "text", text: "real request" },
      { role: "bot", kind: "text", text: "fine" },
      { role: "bot", kind: "text", text: "What happened?", feedback: { step: "detail", reportId: "r" } },
      { role: "user", kind: "text", text: "my answer" },
    ];
    expect(chatFacts(messages)).toMatchObject({ asks: ["real request"], requestIds: [], failedTools: [] });
    expect(chatFacts(messages).error).toBeUndefined();
  });

  it("keeps only plain request ids, never a secret", () => {
    expect(requestIdsIn("x-request-id: 7f3a-91bc-22 and trace_id=abc123def")).toEqual(["7f3a-91bc-22", "abc123def"]);
    expect(requestIdsIn("request id: ghp_abcdefghijklmnopqrstuvwxyz0123456789AB")).toEqual([]);
  });
});
