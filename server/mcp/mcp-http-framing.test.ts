// How the remote MCP client reads a streamable HTTP reply sent as an event
// stream: line endings split across chunks (upstream #5086), a last event
// without its closing blank line (upstream #5251) and an empty event type
// (upstream #5860).
import { describe, expect, it } from "vitest";

import { RemoteMcpClient } from "./mcp-http.ts";

function clientAnswering(text: string, split: boolean): RemoteMcpClient {
  const bytes = new TextEncoder().encode(text);
  const chunks = split ? Array.from(bytes, (byte) => Uint8Array.of(byte)) : [bytes];
  return new RemoteMcpClient({ type: "http", url: "https://fixture.example/mcp", headers: {} }, {
    fetch: async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }), { headers: { "content-type": "text/event-stream" } }),
  });
}

async function answer(text: string, split: boolean): Promise<unknown> {
  const client = clientAnswering(text, split);
  try {
    return await client.request("tools/call", { name: "read" }, new AbortController().signal);
  } finally {
    await client.close();
  }
}

describe("MCP event stream framing", () => {
  it.each([
    ["CRLF split across chunks", "\r\n", true],
    ["CRLF in one chunk", "\r\n", false],
    ["LF split across chunks", "\n", true],
    ["CR split across chunks", "\r", true],
  ] as const)("reads multiline data with %s", async (_label, newline, split) => {
    const text = ["event: message", 'data: {"jsonrpc":"2.0",', 'data: "id":1,"result":{"text":"日本語"}}', "", ""].join(newline);
    await expect(answer(text, split)).resolves.toEqual({ text: "日本語" });
  });
});

describe("the last event of a streamable HTTP reply", () => {
  // A stateless server (one reply, then it hangs up) may close the stream
  // without the blank line after its last event.
  it.each([
    ["LF", "\n", false],
    ["CRLF", "\r\n", false],
    ["LF split across chunks", "\n", true],
    ["no newline at all", "", false],
  ] as const)("is read when the server closed without a blank line (%s)", async (_label, newline, split) => {
    const text = ["event: message", 'data: {"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"get_quote"}]}}'].join(newline || "\n") + newline;
    await expect(answer(text, split)).resolves.toEqual({ tools: [{ name: "get_quote" }] });
  });

  it("is still refused when the stream was cut in the middle of it", async () => {
    await expect(answer('event: message\ndata: {"jsonrpc":"2.0","id":1,"res', false)).rejects.toMatchObject({ kind: "protocol" });
  });
});
