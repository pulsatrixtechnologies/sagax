// Agents tool family: end_call and join_meeting.
// Definitions and handlers. Assembled in order by agents-catalog.ts;
// dispatched by agents-call.ts. Never import server/index.ts.

import type { ToolCallContext, ToolCallResult } from "../agents-call-types.ts";
import type { Json } from "../agents-client.ts";

export const DEF_END_CALL = {
    name: "end_call",
    description:
      "Hang up the live phone call on this conversation. Say one short goodbye first if you have not already. The call ends when this turn finishes, so the goodbye is spoken. Then stop: do not start new work. There is no live call unless this tool is in your list.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  };

export const DEF_JOIN_MEETING = {
    name: "join_meeting",
    description: "Join a Google Meet as a notetaker (link from the person or a calendar event). Posts a consent card; nothing joins until they approve. You get the transcript after, to post notes.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        url: { type: "string", description: "The https meeting link." },
        reason: { type: "string", description: "Shown on the card." },
      },
      required: ["url", "reason"],
    },
  };

export const PHONE_TOOL_NAMES: ReadonlySet<string> = new Set(['end_call', 'join_meeting'] as const);

/** Handle a tool of this family, or return null when the name is not ours. */
export async function callPhoneFamilyTool(name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult | null> {
  const { botId: BOT_ID, threadId: THREAD_ID, externalRuntime: EXTERNAL_RUNTIME } = context;
  const { api } = context.client;
  if (!PHONE_TOOL_NAMES.has(name)) return null;
  if (name === "join_meeting") {
    const url = typeof args.url === "string" ? args.url.trim() : "";
    const reason = typeof args.reason === "string" ? args.reason.trim().slice(0, 500) : "";
    if (!url) return { text: "join_meeting needs url: the meeting's https link.", isError: true };
    const r = await api("/api/internal/meetings/join", { method: "POST", body: JSON.stringify({ url, reason }) });
    if (r.error) return { text: String(r.error), isError: true };
    if (r.supported === false) {
      return { text: "This meeting platform is not supported yet (Google Meet is). A card in the chat says so; tell the person and end this turn." };
    }
    return { text: "A consent card is in the chat. End this turn: nothing joins until the person approves it, and they should tell the other participants first. You will get the transcript after the meeting to post a summary and action items." };
  }
  if (name === "end_call") {
    const none = "There is no live phone call on this conversation. Do not call end_call.";
    if (EXTERNAL_RUNTIME) return { text: none, isError: true };
    try {
      await api("/api/internal/voice-call/end", {
        method: "POST",
        body: JSON.stringify({ fromBotId: BOT_ID, fromThreadId: THREAD_ID }),
      });
      return { text: "The call will end when you finish this turn. Say one short goodbye if you have not already, then stop. Do not start new work." };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { text: message.includes("no live phone call") ? none : message, isError: true };
    }
  }
  return null;
}

