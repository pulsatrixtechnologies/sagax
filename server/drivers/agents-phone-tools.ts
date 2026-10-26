// phone_tool, the agents tool that asks the person's own iPhone
// (shared/phone-tools.ts, server/routes/phone-tools.ts). Shown only when the
// harness says a phone of the person speaking is around and offers at least
// one tool (SAGAX_PHONE_TOOLS, the tools it offers), and its `tool` enum
// lists exactly those. The route re-checks the turn, the person and the
// phone on every call. Definition and call live here so agents-catalog.ts
// and agents-call.ts each gain one line.
import { PHONE_TOOLS, isPhoneTool, type PhoneToolId } from "../../shared/phone-tools.ts";

import type { ToolCallContext, ToolCallResult } from "./agents-call.ts";
import type { Json } from "./agents-client.ts";

export const PHONE_TOOL_NAME = "phone_tool";

/** The tools a spawned proxy was told the phone offers (comma separated). */
export function phoneToolsFromEnv(value: string | undefined): PhoneToolId[] {
  return (value ?? "").split(",").map((entry) => entry.trim()).filter(isPhoneTool);
}

const WHAT: Record<PhoneToolId, string> = {
  location: "location: the phone's current position, once (precise true only when street level matters; otherwise it is rounded to about 100 m).",
  contacts: "contacts: search the address book by name (query), returning only the fields you ask for (phone, email, address, birthday, organization), at most limit (default 5, max 10).",
  reminders: "reminders: action list (incomplete reminders, optionally of one list) or create (title, due ISO date, notes, list).",
  calendar: "calendar: action list (from and to as ISO dates, at most 31 days) or create (title, start, end, location, notes).",
  photos: "photos: the person picks up to max photos (default 1, max 3) on the phone; you receive them as images.",
  shortcut: "shortcut: run one of the person's Shortcuts by its exact name, with optional text input. You only learn that it started.",
  clipboard: "clipboard: the text on the phone's clipboard. Ask only when the person told you to read it.",
  status: "status: battery, Low Power Mode, network and whether a Focus is on.",
};

export function phoneToolDefinition(tools: readonly PhoneToolId[]) {
  const offered = PHONE_TOOLS.filter((tool) => tools.includes(tool));
  return {
    name: PHONE_TOOL_NAME,
    description: [
      "Use a tool on the person's own iPhone. They approve every request on the phone itself (Refuser, Toujours permettre, Permettre une fois); nothing runs in the background. Ask only for what this request needs, and say why in reason (shown on the phone).",
      ...offered.map((tool) => WHAT[tool]),
      "When the phone has not answered yet you get a request_id: call again with only request_id to keep waiting. A refusal is final for that request: do not ask again unless the person asks.",
    ].join(" "),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        tool: { type: "string", enum: offered },
        reason: { type: "string", description: "One short sentence the phone shows: why you need it." },
        precise: { type: "boolean" },
        query: { type: "string" },
        fields: { type: "array", items: { type: "string", enum: ["phone", "email", "address", "birthday", "organization"] } },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        action: { type: "string", enum: ["list", "create"] },
        list: { type: "string" },
        title: { type: "string" },
        due: { type: "string" },
        notes: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
        start: { type: "string" },
        end: { type: "string" },
        location: { type: "string" },
        max: { type: "integer", minimum: 1, maximum: 3 },
        name: { type: "string" },
        input: { type: "string" },
        request_id: { type: "string", description: "Keep waiting on an earlier request (its other fields are ignored)." },
      },
      required: ["tool"],
    },
  };
}

const ARG_KEYS: Record<PhoneToolId, readonly string[]> = {
  location: ["reason", "precise"],
  contacts: ["reason", "query", "fields", "limit"],
  reminders: ["reason", "action", "list", "title", "due", "notes", "limit"],
  calendar: ["reason", "action", "from", "to", "title", "start", "end", "location", "notes", "limit"],
  photos: ["reason", "max"],
  shortcut: ["reason", "name", "input"],
  clipboard: ["reason"],
  status: ["reason"],
};

type Outcome = { status?: unknown; tool?: unknown; result?: unknown; error?: unknown; requestId?: unknown };

/** What the bot reads back. Photos come as images beside the text. */
export function phoneOutcomeText(outcome: Outcome): ToolCallResult {
  switch (outcome.status) {
    case "done": {
      const result = (outcome.result ?? {}) as Record<string, unknown>;
      if (outcome.tool === "photos" && Array.isArray(result.images)) {
        const images = (result.images as Array<{ data?: unknown; mimeType?: unknown }>).filter((image) => typeof image.data === "string");
        const text = images.length ? `The person picked ${images.length} photo${images.length > 1 ? "s" : ""} on their phone.` : "The person picked no photo.";
        return { text, passthrough: { content: [{ type: "text", text }, ...images.map((image) => ({ type: "image", data: String(image.data), mimeType: "image/jpeg" }))] } };
      }
      if (outcome.tool === "shortcut") return { text: "The shortcut started on the person's phone. You do not get its output." };
      return { text: JSON.stringify(result) };
    }
    case "denied":
      return { text: "The person refused this on their phone. Do not ask again unless they ask you to.", isError: true };
    case "failed":
      return { text: `The phone could not do it: ${String(outcome.error ?? "unknown error")}`, isError: true };
    case "expired":
      return { text: "The phone did not answer in time. Tell the person; they can open Sagax on their iPhone and ask again.", isError: true };
    case "pending":
      return { text: `Still waiting for the person to approve on their phone. Call ${PHONE_TOOL_NAME} again with request_id "${String(outcome.requestId)}" to keep waiting, or end your turn and say what you are waiting for.` };
    default:
      return { text: "The phone tool gave no answer.", isError: true };
  }
}

export async function callPhoneTool(args: Json, context: ToolCallContext): Promise<ToolCallResult> {
  const { apiResponse } = context.client;
  let body: Json;
  if (typeof args.request_id === "string" && args.request_id.trim()) {
    body = { request_id: args.request_id.trim() };
  } else {
    if (!isPhoneTool(args.tool)) return { text: `tool is one of: ${PHONE_TOOLS.join(", ")}.`, isError: true };
    const keys = ARG_KEYS[args.tool];
    body = { tool: args.tool, args: Object.fromEntries(Object.entries(args).filter(([key, value]) => keys.includes(key) && value !== undefined && value !== null)) };
  }
  const { ok, body: answer } = await apiResponse("/api/internal/phone-tools", { method: "POST", body: JSON.stringify(body) });
  if (!ok) return { text: String(answer.error ?? "The phone tool is not available in this turn."), isError: true };
  return phoneOutcomeText(answer);
}
