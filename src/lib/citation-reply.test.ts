import { describe, expect, it } from "vitest";
import { citationAttachment, splitTranscriptCitations } from "./citations";
import { citationReplyAction } from "./citation-reply";

const citation = citationAttachment(
  { ownerType: "bot", ownerId: "scout", threadId: "earlier", messageId: "reply" },
  { text: "The next bots will not receive this section.", start: 40, end: 84, prefix: "", suffix: "" },
  "Why?",
);

describe("reply to a selected passage", () => {
  it("sends the comment in the current conversation and preserves the exact earlier quote", () => {
    const action = citationReplyAction(citation, "bot", "scout", "current");
    expect(action).toMatchObject({ type: "send", botId: "scout", threadId: "current" });
    if (action.type !== "send") throw new Error("wrong action");
    const sent = splitTranscriptCitations(action.text);
    expect(sent.display.trim()).toBe("Why?");
    expect(sent.citations).toHaveLength(1);
    expect(sent.citations[0]).toMatchObject({ quote: citation.quote, source: citation.source });
    expect(sent.citations[0]?.comment).toBeUndefined();
  });

  it("uses the same send path in a group", () => {
    expect(citationReplyAction(citation, "group", "team", "room")).toMatchObject({
      type: "sendGroup", groupId: "team", threadId: "room", mode: "chat", onError: expect.any(Function),
    });
  });
});
