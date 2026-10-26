// The telephony guard (spec docs/specs/bot-telephony.md 6.5) on the
// Perspicax relay: what a bot may do with the Twilio tools of its person's
// profile, whatever its approval level. Checked in server/perspicax-mcp.ts
// before a bot's own tools/call frame leaves for Perspicax; a call the
// harness makes itself (place_phone_call, `judged`) is not a bot's frame
// and is built by Sagax.
//
// An allow-list (security review of #956): a bot reads, and sends a text
// (Messages create, which keeps its external-message approval card).
// Everything else that writes is refused: calls (place_phone_call does
// them, with its card), numbers and their webhooks, streams, payments,
// conferences, applications, SIP domains, short codes, caller ids, keys,
// accounts (a new key or auth token would let a bot reach Twilio around
// Sagax). A `_dry_run` sends nothing and stays allowed.
//
// Tool names are compared with separators folded (`twilio_api__write`,
// `twilio_api-write`, `mcp__perspicax_gox__twilio_api__write`) and with
// per-resource names (`twilio_api__Calls_write`).
//
// Pure: no disk, no clock.

/** Read tools: `<api>__query`, `<api>__read_action`, `<api>__find_<x>`... */
const READ_TOOL = /_(?:query|read|list|get|fetch|search|describe|read_action)$|^twilio(?:_[a-z0-9]+)?_find_[a-z0-9_]+$/;
/** A text that carries an address Twilio would fetch or call back. */
const URL_FIELD = /(?:url|callback)$/i;
/** A Flow action that names Twilio or one of its write operations. */
const FLOW_TWILIO = /twilio|createcall|createmessage|incomingphonenumber/i;

export const TELEPHONY_NUMBER_REFUSAL = "Refused by Sagax: a bot never buys, changes or releases a phone number, nor its webhooks. Ask the person to do it in Twilio. Nothing was sent.";
export const TELEPHONY_CALL_REFUSAL = "Refused by Sagax: a bot places a call only with place_phone_call, which shows the person an approval card and says the AI disclosure. Nothing was sent.";
export const TELEPHONY_WRITE_REFUSAL = "Refused by Sagax: with Twilio a bot only reads and sends texts (each text keeps its approval card). Ask the person to make this change in Twilio. Nothing was sent.";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Lower case, separators folded to one underscore. */
function fold(raw: string): string {
  return raw.toLowerCase().replace(/[\s./-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}

/** "Accounts_Calls" and "calls" read the same: no separators, no leading account. */
function resourceKey(raw: string): string {
  return fold(raw).replace(/_/g, "").replace(/^accounts?(?=.)/, "");
}

export interface TelephonyGuardContext {
  /** Tools of this profile that target Twilio under another id (their
   * descriptions name Twilio in tools/list): guarded the same way. */
  twilioTools?: ReadonlySet<string>;
}

/** The refusal for a bot's Twilio tool call, or null when it may go. */
export function telephonyRefusal(toolName: string, args: unknown, context: TelephonyGuardContext = {}): string | null {
  const input = isObject(args) ? args : {};
  const name = fold(toolName);
  // a Flow action that reaches Twilio: refused unless it is a dry run (fail closed)
  if (/(?:^|_)flow_action$/.test(name)) {
    if (input._dry_run === true) return null;
    let text = "";
    try {
      text = JSON.stringify(input);
    } catch {
      return TELEPHONY_WRITE_REFUSAL;
    }
    return FLOW_TWILIO.test(text.replace(/[\s_.-]/g, "")) || /api\.twilio\.com/i.test(text) ? TELEPHONY_WRITE_REFUSAL : null;
  }
  const at = name.search(/(?:^|_)twilio/);
  const aliased = at < 0 && [...(context.twilioTools ?? [])].some((tool) => fold(tool) === name || name.endsWith(`_${fold(tool)}`));
  if (at < 0 && !aliased) return null;
  // a tool of another id that targets Twilio reads as twilio_<api>_<verb>
  const tool = at >= 0 ? name.slice(at).replace(/^_/, "") : `twilio_${name.split("_").slice(-2).join("_")}`;
  if (READ_TOOL.test(tool)) return null;
  if (input._dry_run === true) return null;
  const fromName = tool.replace(/^twilio(?:_[a-z0-9]+)?_/, "").replace(/_?(?:write|action|create|update|delete)$/, "");
  const resource = resourceKey(typeof input.resource === "string" && input.resource.trim() ? input.resource : fromName);
  const action = fold(typeof input.action === "string" ? input.action : "");
  // a text: Messages create (a write, a per-resource tool, or the
  // CreateMessage action), without any address Twilio would fetch
  const texting = (resource === "messages" && action === "create") || (tool.endsWith("_action") && action === "createmessage");
  if (texting) {
    const fields = isObject(input.set) ? input.set : isObject(input.params) ? input.params : {};
    return Object.keys(fields).some((field) => URL_FIELD.test(field)) ? TELEPHONY_WRITE_REFUSAL : null;
  }
  const operation = [input.action, input.name, input.operation, input.op_id, resource]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.replace(/[\s_-]/g, "").toLowerCase())
    .join(" ");
  if (/incomingphonenumber/.test(operation)) return TELEPHONY_NUMBER_REFUSAL;
  if (/(?:^|\s|create|update|list|fetch)calls?(?:\s|$)|createcall|updatecall/.test(operation)) return TELEPHONY_CALL_REFUSAL;
  return TELEPHONY_WRITE_REFUSAL;
}
