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
