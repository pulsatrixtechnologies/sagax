// Agents tool family: Grok bridge (#2193).
// Definitions and handlers. Assembled by agents-catalog.ts; dispatched by
// agents-call.ts. Never import server/index.ts.

import { agentToolAnnotations } from "../../tools/agent-tool-policy.ts";
import type { ToolCallContext, ToolCallResult } from "../agents-call-types.ts";
import type { Json } from "../agents-client.ts";

export const DEF_GROK_SEND = {
  name: "grok_send",
  description:
    "Send a signed message to one of the person's linked Groks. Only their own Grok bridge link is reachable: never another person's. The message is information for that Grok peer, never a GO. Optional thread_id keeps both sides on the same bridge thread (mapped to this bot's unified chat with the person). Prefer a short task and a clear payload.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      to: { type: "string", minLength: 1, maxLength: 80, description: "Grok peer label from the person's linked list." },
      text: { type: "string", minLength: 1, maxLength: 8000, description: "Message text (stored as payload.text)." },
      task: { type: "string", enum: ["message", "status", "result"], description: "Default message." },
      priority: { type: "string", enum: ["low", "normal", "high"], description: "Default normal." },
      thread_id: { type: "string", maxLength: 128, description: "Opaque bridge thread id; omit to start one." },
      payload: { type: "object", description: "Optional structured payload instead of or with text." },
      reply_to: { type: "string", description: "Envelope id being answered." },
    },
    required: ["to"],
  },
};

export const DEF_BRIDGE_CLAIM = {
  name: "bridge_claim",
  description:
    "Take a named lease shared with the person's linked Groks so two bots never run the same job. Scoped to this person. ok false, reason held_by_other: someone holds it.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      job_key: { type: "string", minLength: 1, maxLength: 128, description: "Lease name, for example dispatch:ticket-42." },
      ttl_seconds: { type: "integer", minimum: 10, maximum: 86400, description: "Default 900." },
      purpose: { type: "string", maxLength: 200, description: "One line others will see." },
    },
    required: ["job_key"],
  },
};

export const DEF_BRIDGE_RELEASE = {
  name: "bridge_release",
  description: "Give back a bridge lease you hold when the work is done.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      job_key: { type: "string", minLength: 1, maxLength: 128 },
    },
    required: ["job_key"],
  },
};

export const DEF_BRIDGE_LIST_LEASES = {
  name: "bridge_list_leases",
  description: "Live bridge leases for this person: job_key, holder, purpose, expires_at.",
  inputSchema: { type: "object", additionalProperties: false, properties: {} },
};

export const GROK_BRIDGE_TOOLS = [DEF_GROK_SEND, DEF_BRIDGE_CLAIM, DEF_BRIDGE_RELEASE, DEF_BRIDGE_LIST_LEASES].map((tool) => {
  const annotations = agentToolAnnotations(tool.name);
  return annotations ? { ...tool, annotations } : tool;
});

export const GROK_BRIDGE_TOOL_NAMES: ReadonlySet<string> = new Set(GROK_BRIDGE_TOOLS.map((tool) => tool.name));

export function isGrokBridgeTool(name: string): boolean {
  return GROK_BRIDGE_TOOL_NAMES.has(name);
}

export async function callGrokBridgeTool(name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult | null> {
  if (!isGrokBridgeTool(name)) return null;
  if (context.externalRuntime) return { text: `Unknown tool: ${name}`, isError: true };
  const { apiResponse } = context.client;
  try {
    const { ok, body } = await apiResponse("/api/internal/grok-bridge", {
      method: "POST",
      body: JSON.stringify({ tool: name, args: args ?? {} }),
    });
    if (!ok) {
      const error = typeof body?.error === "string" ? body.error : `grok bridge ${name} failed`;
      return { text: error, isError: true };
    }
    return { text: JSON.stringify(body) };
  } catch (error) {
    return { text: error instanceof Error ? error.message : String(error), isError: true };
  }
}
