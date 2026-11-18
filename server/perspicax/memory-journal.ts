import { createHash } from "node:crypto";
import type { PerspicaxRelayAnswer } from "./perspicax-mcp.ts";

type Json = Record<string, unknown>;
const record = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);
const entryBytes = 4096;
const memoryWrite = (tool: unknown) => tool === "memory_save" || tool === "memory_write" || tool === "memory_propose";

/** Only the connector's individual entries have a byte limit. */
export function journalCatalog(body: unknown): unknown {
  if (!record(body) || !record(body.result) || !Array.isArray(body.result.tools)) return body;
  const tools = body.result.tools.map((tool: unknown) => {
    if (!record(tool) || !memoryWrite(tool.name) || !record(tool.inputSchema)) return tool;
    const properties = tool.inputSchema.properties;
    if (!record(properties) || !record(properties.body) || properties.body.maxLength === undefined) return tool;
    const field = { ...properties.body };
    delete field.maxLength;
    return { ...tool, inputSchema: { ...tool.inputSchema, properties: { ...properties, body: field } } };
  });
  return { ...body, result: { ...body.result, tools } };
}

export async function relayMemoryJournal(frame: Json, send: (frame: Json) => Promise<PerspicaxRelayAnswer>): Promise<PerspicaxRelayAnswer> {
  if (frame.method !== "tools/call" || !record(frame.params) || !memoryWrite(frame.params.name)) return send(frame);
  const params = frame.params;
  const args = params.arguments;
  if (!record(args) || typeof args.body !== "string" || Buffer.byteLength(args.body) <= entryBytes || !args.body.trim()) return send(frame);

  const source = Buffer.from(args.body);
  const journal = createHash("sha256").update(source).digest("hex");
  const footer = "\n[/journal]";
  // One part per byte is an upper bound for the two index widths.
  const heading = (part: number, total: number) => `[journal ${journal} ${part}/${total}]\n`;
  const room = entryBytes - heading(source.length, source.length).length - footer.length;
  const pieces: string[] = [];
  for (let start = 0; start < source.length;) {
    let end = Math.min(start + room, source.length);
    while (end < source.length && (source[end]! & 0xc0) === 0x80) end--;
    pieces.push(source.toString("utf8", start, end));
    start = end;
  }
  const receipts: unknown[] = [];
  for (const [i, piece] of pieces.entries()) {
    const body = heading(i + 1, pieces.length) + piece + footer;
    const answer = await send({ ...frame, params: { ...params, arguments: { ...args, body } } });
    const rpc = answer.body;
    if (answer.status !== 200 || !record(rpc) || !record(rpc.result) || rpc.result.isError === true) {
      if (!receipts.length) return answer;
      const text = `Journal ${journal}: ${i} of ${pieces.length} parts acknowledged. Part ${i + 1} was not confirmed. Later parts were not sent.`;
      if (record(rpc) && record(rpc.error)) return { ...answer, body: { ...rpc, error: { ...rpc.error, message: text + " " + String(rpc.error.message) } } };
      if (record(rpc) && record(rpc.result)) return { ...answer, body: { ...rpc, result: { ...rpc.result, content: [{ type: "text", text }, ...(Array.isArray(rpc.result.content) ? rpc.result.content : [])] } } };
      return { ...answer, body: { error: text } };
    }
    receipts.push(rpc.result.structuredContent ?? rpc.result.content);
  }
  const receipt = { journal, parts: receipts };
  return { status: 200, body: { jsonrpc: "2.0", id: frame.id, result: { structuredContent: receipt, content: [{ type: "text", text: JSON.stringify(receipt) }] } } };
}
