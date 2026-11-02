// Agents tool family: Room list and post from a direct chat.
// Definitions and handlers. Assembled in order by agents-catalog.ts;
// dispatched by agents-call.ts. Never import server/index.ts.

import type { ToolCallContext, ToolCallResult } from "../agents-call-types.ts";
import type { Json } from "../agents-client.ts";
import { jsonRecord } from "./shared.ts";

export const DEF_LIST_ROOMS = {
    name: "list_rooms",
    description:
      "List the shared rooms (team channels) you belong to, with the other members of each. Call this before post_to_room. One-to-one bot channels are never listed; discover individual teammates with list_bots. A room you are in but cannot post into is named without an id, together with the reason, so you can tell the user why.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  };

export const DEF_POST_TO_ROOM = {
    name: "post_to_room",
    description:
      "Put one message into a shared room you belong to, for example when the user asks you to tell the team something. Get group_id from list_rooms. This posts and returns: no room member's turn starts, nobody replies, and nothing comes back except confirmation — so never use it to ask a question or hand out work (use ask_bot or delegate_bot for those). Post once, say it in full, and tell the user what you posted. Set attach_voice_note true to attach this turn's voice note. If a post is refused, do not retry it: say what you wanted to post in your reply instead.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        group_id: { type: "string", description: "The room's id, copied exactly from list_rooms." },
        message: { type: "string", description: "The complete message to post, written for the room to read as it stands." },
        attach_voice_note: { type: "boolean", description: "True to attach this turn's send_voice_note recording; the message is its caption. Call send_voice_note first." },
      },
      required: ["group_id", "message"],
    },
  };

export const ROOMS_TOOL_NAMES: ReadonlySet<string> = new Set(['list_rooms', 'post_to_room'] as const);

/** Handle a tool of this family, or return null when the name is not ours. */
export async function callRoomsTool(name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult | null> {
  const { botId: BOT_ID, threadId: THREAD_ID } = context;
  const { api } = context.client;
  if (!ROOMS_TOOL_NAMES.has(name)) return null;
  if (name === "list_rooms") {
    const query = new URLSearchParams({ fromBotId: BOT_ID, fromThreadId: THREAD_ID });
    const r = await api(`/api/internal/rooms?${query.toString()}`);
    const rooms = Array.isArray(r.rooms) ? r.rooms.filter(jsonRecord) : [];
    // A room the bot is in but may not post into comes back named, with the
    // refusal a post would meet, and without an id: the model gets the exact
    // reason to hand the user and nothing it could retry against.
    const unpostable = Array.isArray(r.unpostable) ? r.unpostable.filter(jsonRecord) : [];
    const blocked = unpostable.length
      ? `\n\nRooms you are in but cannot post into (no id — there is nothing to retry; give the user the reason instead):\n${
        unpostable.map((room) => `- ${String(room.name)}: ${String(room.reason)}`).join("\n")
      }`
      : "";
    if (!rooms.length) {
      return { text: `You are not in any room you can post into. Tell the user what you wanted to share and let them decide where it goes.${blocked}` };
    }
    const lines = rooms.map((room) => {
      const members = Array.isArray(room.members) ? room.members.map(String).join(", ") : "";
      return `- ${String(room.name)} [id: ${String(room.id)}]${members ? ` — members: ${members}` : ""}`;
    });
    return {
      text: `Rooms you can post into:\n${lines.join("\n")}\n\nUse post_to_room with one of these ids. A post adds one message to the room; it does not start anyone's turn, so nobody replies to it automatically.${blocked}`,
    };
  }
  if (name === "post_to_room") {
    const groupId = String(args.group_id ?? "").trim();
    const message = String(args.message ?? "").trim();
    const attachVoiceNote = args.attach_voice_note === true;
    if (!groupId || !message) {
      return { text: "post_to_room needs group_id (from list_rooms) and message.", isError: true };
    }
    const r = await api("/api/internal/post-to-room", {
      method: "POST",
      body: JSON.stringify({ fromBotId: BOT_ID, fromThreadId: THREAD_ID, groupId, message, attachVoiceNote }),
    });
    if (r.error) return { text: String(r.error), isError: true };
    return {
      text: `Posted in ${r.roomName ?? "the room"}${r.attachedVoiceNote ? " with the voice note attached" : ""}. Nobody's turn was started, so expect no reply — tell the user it is posted.`,
    };
  }
  return null;
}

