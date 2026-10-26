import { describe, expect, it } from "vitest";
import { recipientKeysForSendCard } from "./send-card-recipients.ts";

describe("Always allow on a send card", () => {
  it("names every address of an email draft", () => {
    expect(recipientKeysForSendCard({
      emailSendRequest: { draft: { to: ["Ana@Example.com"], cc: ["bob@example.com"], bcc: [] } },
    })).toEqual(["email:ana@example.com", "email:bob@example.com"]);
  });

  it("reads a plain message send and a bot the card is asking", () => {
    expect(recipientKeysForSendCard({
      tool: "mcp__mail__send_email",
      toolInput: JSON.stringify({ to: "514 555 1234" }),
    })).toEqual(["phone:+15145551234"]);
    expect(recipientKeysForSendCard({ tool: "ask_bot", allowKey: "ask_bot:helper" })).toEqual(["bot:helper"]);
  });

  it("leaves a channel or a shell card alone", () => {
    expect(recipientKeysForSendCard({
      tool: "mcp__slack__send_message",
      toolInput: JSON.stringify({ channel: "C1", to: "ana@example.com" }),
    })).toBeNull();
    expect(recipientKeysForSendCard({ tool: "Bash", allowKey: "ask_bot:helper", toolInput: "{}" })).toBeNull();
  });
});
