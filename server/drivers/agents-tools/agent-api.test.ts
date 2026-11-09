import { describe, expect, it } from "vitest";

import { AGENT_API_TOOL_NAMES, attachmentResult } from "./agent-api.ts";

// #3203: another bot of the same person sees an attached image as image
// content, not as a server path it cannot open.
describe("read_transcript_attachment", () => {
  it("is one of the agent tools", () => {
    expect(AGENT_API_TOOL_NAMES.has("read_transcript_attachment")).toBe(true);
  });

  it("hands the image to the model as image content, the rest as text", () => {
    const result = attachmentResult({ agent_id: "bot-a", attachment: "abc-1.png", mime: "image/png", bytes: 3, image_base64: "AAAA" });
    expect(result.text).not.toContain("AAAA");
    expect(JSON.parse(result.text)).toEqual({ agent_id: "bot-a", attachment: "abc-1.png", mime: "image/png", bytes: 3 });
    expect(result.passthrough).toEqual({ content: [{ type: "text", text: result.text }, { type: "image", data: "AAAA", mimeType: "image/png" }] });
  });

  it("answers text only when there is no image", () => {
    expect(attachmentResult({ agent_id: "bot-a" }).passthrough).toBeUndefined();
  });
});
